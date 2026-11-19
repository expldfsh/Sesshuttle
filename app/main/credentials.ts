import path from 'node:path';
import { app, safeStorage } from 'electron';
import { Fault, hash, inside, requireThat, stableRead } from '../../core/util.mjs';
import { protectLegacySecrets } from '../../core/portable-credentials.mjs';
import { linuxCredential } from './linux-keyring';

async function macKeychain(account: string, action: 'read' | 'delete' | 'unlock', data = '') {
  const modulePath = path.join(
    app.isPackaged ? process.resourcesPath : __dirname,
    'macos-keychain.node',
  );
  try {
    return await require(modulePath)(action, account, data);
  } catch (e: any) {
    throw new Fault(e.code?.startsWith('credential_') ? e.code : 'credential_authorization_failed');
  }
}

async function legacyRaw(state: any, migration: any, method: string): Promise<string> {
  if (method === 'mac-keychain') return macKeychain(migration.device, 'read');
  if (method === 'secret-service') {
    requireThat(
      typeof migration.reference === 'string' && /^[a-f0-9-]{36}$/i.test(migration.reference),
      'migration_invalid',
    );
    return linuxCredential(migration.reference);
  }
  requireThat(method === 'system', 'migration_invalid');
  const file = await inside(state.root, path.join(state.root, 'connection-secret.bin'));
  const buffer = await stableRead(file, 256 * 1024);
  if (process.platform === 'darwin') await macKeychain(migration.device, 'unlock');
  return (await safeStorage.decryptStringAsync(buffer)).result;
}

export async function protectMigratedCredentials(state: any, password: string, testRoot?: string) {
  if (testRoot) throw new Fault('credential_test_memory');
  return protectLegacySecrets(state, password, (m: any, method: string) =>
    legacyRaw(state, m, method),
  );
}

export async function forgetMigratedCredentials(state: any, m: any, testRoot?: string) {
  for (const [method, expected] of Object.entries(m.fingerprints ?? {})) {
    if (method === 'system') continue; // Only the old per-profile ciphertext file is owned.
    if (testRoot) throw new Fault('credential_test_memory');
    try {
      const raw = await legacyRaw(state, m, method);
      requireThat(hash(raw) === expected, 'credential_changed');
      if (method === 'mac-keychain') await macKeychain(m.device, 'delete', raw);
      else if (method === 'secret-service') await linuxCredential(m.reference, undefined, raw);
    } catch (e: any) {
      if (e.code !== 'credential_item_missing') throw e;
    }
  }
}
