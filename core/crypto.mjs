import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Fault, requireThat, LIMIT } from './util.mjs';
export function newKey() {
  return randomBytes(32).toString('base64url');
}
export function parseKey(value) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'invalid_key');
  return Buffer.from(value, 'base64url');
}
function derive(key, space) {
  return Buffer.from(
    hkdfSync('sha256', parseKey(key), Buffer.from(space), Buffer.from('sesshuttle-v1'), 32),
  );
}
export function seal(value, key, space, object) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', derive(key, space), iv);
  cipher.setAAD(Buffer.from(`sesshuttle/1/${space}/${object}`));
  const plain = Buffer.from(JSON.stringify(value));
  requireThat(plain.length <= LIMIT, 'file_too_large');
  const body = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([Buffer.from('SSH1'), iv, cipher.getAuthTag(), body]);
}
export function unseal(data, key, space, object) {
  try {
    requireThat(
      data.length >= 32 && data.length <= LIMIT && data.subarray(0, 4).toString() === 'SSH1',
      'corrupt_data',
    );
    const cipher = createDecipheriv('aes-256-gcm', derive(key, space), data.subarray(4, 16));
    cipher.setAAD(Buffer.from(`sesshuttle/1/${space}/${object}`));
    cipher.setAuthTag(data.subarray(16, 32));
    const plain = Buffer.concat([cipher.update(data.subarray(32)), cipher.final()]);
    return JSON.parse(gunzipSync(plain, { maxOutputLength: LIMIT }).toString());
  } catch {
    throw new Fault('decrypt_failed');
  }
}
