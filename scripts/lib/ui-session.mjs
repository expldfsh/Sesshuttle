/* global window */
// A test-mode app session connected to the loopback S3 server, for walkthroughs,
// screenshots and performance checks. Synthetic data only.
import fs from 'node:fs/promises';
import { invoke, launchApp, makeFixture, startStorage } from './test-app.mjs';

export async function openSession({
  fixtureArgs = [],
  language = 'zh-CN',
  connect = true,
  size,
} = {}) {
  const root = makeFixture(fixtureArgs);
  const storage = connect ? await startStorage(root) : null;
  const { app, page } = await launchApp(root);
  if (size) await setSize(app, page, size);
  const config = (await invoke(page, 'init')).data.config;
  if (config.language !== language) await invoke(page, 'saveConfig', { ...config, language });
  if (storage) {
    const r = await invoke(page, 'connect', {
      mode: 'create',
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    });
    if (!r.ok) throw Error('connect failed: ' + JSON.stringify(r.error));
  }
  await page.reload();
  await page.waitForSelector('.shell');
  return {
    root,
    app,
    page,
    storage,
    async close() {
      await app.close().catch(() => {});
      storage?.stop();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

// Resizes the Electron window's content area.
export async function setSize(app, page, [width, height]) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(w, h);
    },
    [width, height],
  );
  await page.waitForFunction(([w]) => window.innerWidth === w, [width]);
}
