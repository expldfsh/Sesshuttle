import { seal, unseal } from './crypto.mjs';
import { Fault, requireThat, id, LIMIT } from './util.mjs';

export async function readSpace(vault) {
  const r = await vault.store.get(vault.prefix + 'space');
  requireThat(r, 'space_not_found');
  const value = unseal(r.body, vault.key, vault.space, 'space');
  requireThat([1, 2].includes(value.format) && value.space === vault.space, 'invalid_space');
  return { value, etag: r.etag };
}

// A clock timeout is not proof that a disconnected writer stopped. Only the same
// application installation, protected by Electron's instance lock, can reclaim its lock.
const active = new Set();
export async function withSpaceWriter(vault, work, { resume = null } = {}) {
  const token = id(),
    owner = vault.installation,
    identity = vault.space + '/' + owner;
  let record;
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await readSpace(vault);
    if (current.value.pending && current.value.pending.id !== resume)
      throw new Fault('cloud_cleanup_pending');
    const holder = current.value.writer;
    if (active.has(identity) || (holder && holder.owner !== owner)) {
      if (attempt === 15) throw new Fault('cloud_writer_busy', holder?.name ?? '');
    } else {
      const value = {
        ...current.value,
        writer: { owner, token, name: vault.deviceName ?? '', at: new Date().toISOString() },
      };
      try {
        const etag = await vault.store.put(
          vault.prefix + 'space',
          seal(value, vault.key, vault.space, 'space'),
          current.etag,
        );
        record = { value, etag };
        active.add(identity);
        break;
      } catch (e) {
        if (e.code !== 'concurrent_update') throw e;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 12));
  }
  requireThat(record, 'concurrent_update');
  const update = async (patch) => {
    const value = { ...record.value, ...patch };
    requireThat(Buffer.byteLength(JSON.stringify(value)) < LIMIT - 4096, 'space_too_large');
    const etag = await vault.store.put(
      vault.prefix + 'space',
      seal(value, vault.key, vault.space, 'space'),
      record.etag,
    );
    record = { value, etag };
  };
  try {
    return await work({ state: () => record.value, update });
  } finally {
    try {
      await update({ writer: null });
    } finally {
      active.delete(identity);
    }
  }
}
