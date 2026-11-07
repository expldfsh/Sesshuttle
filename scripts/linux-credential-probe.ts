// Harness for the private, offline Arch VM only. Uses dummy credentials across two Electron processes.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { State } from '../core/state.mjs';
import { credentialHealth, persistConnection, retrieveConnection } from '../app/main/credentials';
const marker = '/run/sesshuttle-isolated-vm';
assert.equal(process.platform, 'linux');
assert.equal(fs.statSync(marker).uid, 0);
assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'loopback-only-fixture');
const root = fs.realpathSync(process.env.SESSHUTTLE_PROBE_DIR!);
assert.ok(path.dirname(root) === '/tmp' && path.basename(root).startsWith('sesshuttle-probe-'));
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
  const state = new State(path.join(root, 'store'));
  try {
    const value = {
      credentials: { accessKeyId: 'fixture-id', secretAccessKey: 'fixture-secret' },
      key: 'fixture-recovery',
    };
    const mode = process.env.SESSHUTTLE_PROBE_MODE;
    if (mode === 'cancel') {
      await assert.rejects(retrieveConnection(state), { code: 'credential_cancelled' });
    } else if (mode === 'save') {
      state.set('connection', { space: 'isolated-fixture' });
      await persistConnection(state, value);
    } else assert.deepEqual(await retrieveConnection(state), value);
    const health = await credentialHealth();
    console.log(
      JSON.stringify({
        result: 'PASS',
        mode: process.env.SESSHUTTLE_PROBE_MODE,
        method: state.get('credentialMethod'),
        backend: health.backend,
        service: health.service,
      }),
    );
    app.exit(0);
  } catch (e: any) {
    console.error('FAIL', e.code ?? e.message);
    app.exit(1);
  } finally {
    state.close();
  }
});
