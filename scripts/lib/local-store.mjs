import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, walk, hash, Fault, requireThat } from '../../core/util.mjs';
// Test-only encrypted object store. No network, credentials or product IPC route.
export class LocalStore {
  constructor(root) {
    this.root = root;
    this.putCount = 0;
  }
  file(key) {
    requireThat(/^[a-zA-Z0-9/_-]+$/.test(key) && !key.includes('..'), 'unsafe_path');
    return path.join(this.root, key);
  }
  async get(key) {
    try {
      const body = await fs.readFile(this.file(key));
      return { body, etag: hash(body) };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async put(key, body, etag) {
    const old = await this.get(key);
    if ((etag === null && old) || (etag && old?.etag !== etag))
      throw new Fault('concurrent_update');
    await atomic(this.file(key), body);
    this.putCount++;
    return hash(body);
  }
  async remove(key) {
    await fs.rm(this.file(key), { force: true });
  }
  async inventory(prefix) {
    return Promise.all(
      (await walk(this.root))
        .map((file) => ({ file, key: path.relative(this.root, file) }))
        .filter((x) => x.key.startsWith(prefix))
        .map(async (x) => ({ key: x.key, bytes: (await fs.stat(x.file)).size })),
    );
  }
  async list(prefix) {
    return (await this.inventory(prefix)).map((x) => x.key);
  }
}
