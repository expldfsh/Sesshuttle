// A fixed, versioned envelope. The password and derived key never enter the database.
import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { Fault, requireThat, hash } from './util.mjs';
const derive = promisify(scrypt);
const magic = Buffer.from('SSPC1');
async function passwordKey(password, salt) {
  requireThat(
    typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 1024,
    'folder_password_required',
  );
  return derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export async function sealCredentials(value, password) {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = await passwordKey(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally {
    key.fill(0);
  }
}
export async function openCredentials(sealed, password) {
  requireThat(
    Buffer.isBuffer(sealed) &&
      sealed.length > 49 &&
      sealed.length < 512 * 1024 &&
      sealed.subarray(0, 5).equals(magic),
    'credential_restore_failed',
  );
  const key = await passwordKey(password, sealed.subarray(5, 21));
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(21, 33));
    cipher.setAAD(magic);
    cipher.setAuthTag(sealed.subarray(33, 49));
    const plain = Buffer.concat([cipher.update(sealed.subarray(49)), cipher.final()]);
    try {
      return JSON.parse(plain.toString('utf8'));
    } finally {
      plain.fill(0);
    }
  } catch {
    throw new Fault('folder_password_wrong');
  } finally {
    key.fill(0);
  }
}

// Some older connections predate storing the public Access Key ID in settings.
function matches(value, connection) {
  if (
    !connection ||
    !value?.connection ||
    !value.key ||
    !value.credentials?.secretAccessKey ||
    !value.credentials?.accessKeyId
  )
    return false;
  const keys = new Set([...Object.keys(connection), ...Object.keys(value.connection)]);
  return [...keys].every((k) =>
    k === 'accessKeyId'
      ? [connection[k], value.connection[k]].every(
          (id) => !id || id === value.credentials.accessKeyId,
        )
      : connection[k] === value.connection[k],
  );
}
async function verifiedEnvelope(value, password) {
  const sealed = await sealCredentials(value, password);
  const reopened = await openCredentials(sealed, password);
  requireThat(JSON.stringify(reopened) === JSON.stringify(value), 'credential_write_failed');
  return sealed.toString('base64');
}

export async function persistConnection(state, value, password) {
  const sealed = await verifiedEnvelope(
    { ...value, connection: state.get('connection') },
    password,
  );
  state.db.exec('BEGIN IMMEDIATE');
  try {
    state.set('portableSecret', sealed);
    requireThat(state.get('portableSecret') === sealed, 'credential_write_failed');
    state.set('credentialMethod', 'password');
    state.set('credentialError', null);
    state.db.exec('COMMIT');
  } catch (e) {
    state.db.exec('ROLLBACK');
    throw e;
  }
}

export async function retrieveConnection(state, password) {
  const value = await openCredentials(
    Buffer.from(state.get('portableSecret') ?? '', 'base64'),
    password,
  );
  requireThat(matches(value, state.get('connection')), 'credential_restore_failed');
  return { credentials: value.credentials, key: value.key };
}

// Protect every discovered old item, including a remembered connection that was
// disconnected in 0.7.3. Compare the actual bytes again before removing that item.
export async function protectLegacySecrets(state, password, read) {
  const m = state.get('folderMigration');
  requireThat(
    m && !m.portable && !m.credentialsReady && m.device === state.get('device').id,
    'migration_invalid',
  );
  const records = {},
    fingerprints = {};
  for (const method of m.methods) {
    try {
      records[method] = await read(m, method);
    } catch (e) {
      if (
        (e.code === 'credential_item_missing' || e.code === 'ENOENT') &&
        (m.method !== method || !m.connection)
      )
        continue;
      throw e;
    }
    fingerprints[method] = hash(records[method]);
  }
  const method = m.method ?? (m.methods.includes('system') ? 'system' : null);
  let active = null;
  if (method && records[method]) {
    try {
      active = JSON.parse(records[method]);
    } catch {
      throw new Fault('credential_legacy_unreadable');
    }
  }
  if (m.connection && ['mac-keychain', 'secret-service', 'system'].includes(method))
    requireThat(matches(active, m.connection), 'credential_changed');
  const archive = await verifiedEnvelope(records, password);
  // A user may already have reconnected with a rotated secret while migration was pending.
  const current =
    active && m.method === state.get('credentialMethod') && matches(active, state.get('connection'))
      ? await verifiedEnvelope(active, password)
      : null;
  state.db.exec('BEGIN IMMEDIATE');
  try {
    state.set('migratedSecrets', archive);
    if (current) {
      state.set('portableSecret', current);
      state.set('credentialMethod', 'password');
      state.set('credentialError', null);
    }
    requireThat(
      state.get('migratedSecrets') === archive &&
        (!current || state.get('portableSecret') === current),
      'credential_write_failed',
    );
    state.set('folderMigration', {
      ...m,
      credentialsReady: true,
      protectedHash: hash(archive),
      fingerprints,
    });
    state.db.exec('COMMIT');
  } catch (e) {
    state.db.exec('ROLLBACK');
    throw e;
  }
}
