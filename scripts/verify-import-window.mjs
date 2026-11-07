// Packaged-window acceptance through the import dialog's three steps. Start the
// packaged app in test mode (SESSHUTTLE_TEST_ROOT from scripts/ui-fixture.mjs)
// with --remote-debugging-port, the loopback S3 from scripts/ui-storage.mjs and
// an exchange made by `scripts/cross-device.mjs source`. The "first" phase uses
// a Codex program that still needs the quick check.
// Usage: node scripts/verify-import-window.mjs <debug port> <S3 port> <exchange.json> <zh-CN|en> <first|reopen> <test root> <codex program>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeClient } from '../core/native.mjs';
const [debugPort, storagePort, exchange, language, phase = 'first', root, binary] =
  process.argv.slice(2);
const tempParents = [await fs.realpath(os.tmpdir()), await fs.realpath('/tmp')];
assert.ok(
  tempParents.includes(path.dirname(root)) &&
    path.basename(root).startsWith('sesshuttle-ui-') &&
    (await fs.realpath(root)) === root,
);
assert.equal(JSON.parse(await fs.readFile(path.join(root, '.sesshuttle-test.json'))).format, 1);
assert.ok(path.isAbsolute(binary) && ['first', 'reopen'].includes(phase));
const exchangeDir = await fs.realpath(path.dirname(exchange));
assert.ok(
  tempParents.includes(path.dirname(exchangeDir)) &&
    path.basename(exchangeDir).startsWith('sesshuttle-') &&
    path.basename(exchange) === 'exchange.json',
);
for (const p of [debugPort, storagePort])
  assert.ok(/^\d+$/.test(p) && Number(p) > 1023 && Number(p) <= 65535);
const exchangeData = JSON.parse(await fs.readFile(exchange));
const zh = language === 'zh-CN',
  tr = (a, b) => (zh ? a : b);
// Whether this Codex program lists its model providers (some preview builds do not).
async function providerCatalog(program) {
  const probe = await fs.mkdtemp(path.join(root, 'provider-probe-'));
  const client = new NativeClient(program, probe, probe, {});
  try {
    await client.init(probe);
    return await client.rpc('modelProvider/list', {}).then(
      () => true,
      () => false,
    );
  } finally {
    await client.close();
  }
}
let ws, page;
for (let i = 0; i < 150; i++) {
  try {
    page = (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json()).find(
      (p) => p.url.startsWith('file:') && p.url.endsWith('index.html'),
    );
    if (page) break;
  } catch {}
  await delay(400);
}
assert.ok(page);
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const wait = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  wait.get(m.id)?.(m);
  wait.delete(m.id);
};
async function run(expression) {
  const id = ++seq;
  const promise = new Promise((r) => wait.set(id, r));
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  );
  const result = (await promise).result;
  if (result?.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description ?? 'page exception');
  return result?.result?.value;
}
async function until(expr) {
  for (let i = 0; i < 170; i++) {
    if (await run('Boolean(' + expr + ')')) return;
    await delay(160);
  }
  throw Error('Timed out: ' + expr + '\n' + (await run('document.body.innerText')).slice(-2600));
}
async function click(label, scope = 'document') {
  const expr =
    '[...' +
    scope +
    '.querySelectorAll("button")].find(b=>!b.disabled&&b.textContent.trim().startsWith(' +
    JSON.stringify(label) +
    '))';
  await until(expr);
  await run(expr + '.click()');
}
try {
  const version = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url)),
  ).version;
  await until(
    "document.querySelector('.sidebar-bottom')?.innerText.includes(" +
      JSON.stringify(version) +
      ')',
  );
  const init = await run("window.sesshuttle.invoke('init')");
  assert.ok(init.data.testMode);
  assert.ok(
    init.data.config.sourceHomes.every((p) => p.startsWith(root + path.sep)),
    'debug port must belong to the isolated fixture',
  );
  if (phase === 'first') {
    const dest = path.join(root, 'destination');
    const cfg = {
      ...init.data.config,
      language,
      sourceHomes: [dest],
      targets: {
        desktop: { binary, home: dest },
        cli: { binary, home: dest },
        ide: { binary: '', home: dest },
      },
      bindings: { [exchangeData.sourceProject]: path.join(root, 'demo-project 中文') },
      nativeBindings: {},
    };
    const saved = await run('window.sesshuttle.invoke("saveConfig",' + JSON.stringify(cfg) + ')');
    assert.ok(saved.ok);
  }
  const connect = {
    mode: 'join',
    remember: false,
    endpoint: 'http://127.0.0.1:' + storagePort,
    bucket: 'sesshuttle-ui',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture',
    key: exchangeData.key,
    space: exchangeData.space,
  };
  const connected = await run(
    'window.sesshuttle.invoke("connect",' + JSON.stringify(connect) + ')',
  );
  assert.ok(connected.ok, JSON.stringify(connected));
  await run('setTimeout(()=>location.reload(),50)');
  await delay(600);
  await until("document.querySelector('.connection-chip.on')");
  await click(tr('刷新', 'Refresh'));
  await until("document.querySelector('tr.conversation-row')");
  await run("document.querySelector('tr.conversation-row').click()");
  const dialog = "document.querySelector('dialog[open].flow')";
  // From the apps step to the review list: Next, history only on the projects step, Review.
  async function toReview() {
    for (let i = 0; i < 4; i++) {
      if (await run('Boolean(' + dialog + "?.querySelector('.scope-item'))")) return;
      if (
        await run(
          '[...' +
            dialog +
            '.querySelectorAll("button")].some(b=>b.textContent.includes(' +
            JSON.stringify(
              tr('仅导入历史（不指定原生项目）', 'Import history only (no native project)'),
            ) +
            ')&&!b.disabled)',
        )
      )
        await click(
          tr('仅导入历史（不指定原生项目）', 'Import history only (no native project)'),
          dialog,
        );
      await until(dialog + "?.querySelector('.modal-actions button.primary:not(:disabled)')");
      await run(dialog + ".querySelector('.modal-actions button.primary').click()");
      await delay(500);
    }
    await until(dialog + "?.querySelector('.scope-item')");
  }
  await click(tr('导入到这台电脑', 'Import to this computer'));
  await until(dialog + "?.querySelector('.entry-choices')");
  if (phase === 'first') {
    assert.equal(
      await run("Boolean(document.querySelector('dialog[open].detection-panel'))"),
      false,
    );
    await click(tr('检测本机 Codex 环境', 'Detect local Codex apps'), dialog);
    await until("document.querySelector('dialog[open].detection-panel')");
    await click(
      tr('使用当前路径，继续导入', 'Use current paths and continue'),
      "document.querySelector('dialog[open].detection-panel')",
    );
    await until("!document.querySelector('dialog[open].detection-panel')");
    // Next checks the chosen app; this program still needs the quick check.
    await run(dialog + ".querySelector('.modal-actions button.primary').click()");
    await until(dialog + "?.querySelector('.runtime-check')");
    await click(tr('快速验证此 Codex 程序', 'Run quick check'), dialog);
    await click(tr('取消本次验证', 'Cancel check'), dialog);
    await until(
      dialog +
        "?.querySelector('.runtime-check')?.innerText.includes(" +
        JSON.stringify(tr('已取消验证', 'Check cancelled')) +
        ')',
    );
    await click(tr('重新快速验证', 'Retry quick check'), dialog);
    await until(
      dialog +
        "?.querySelector('.runtime-ready')?.innerText.includes(" +
        JSON.stringify(tr('本机验证已通过', 'Verified on this computer')) +
        ')',
    );
  }
  await toReview();
  if (phase === 'first') {
    await click(tr('确认导入到', 'Confirm import to'), dialog);
    const target = path.join(root, 'destination');
    await until(
      "document.querySelector('.task-feedback.attention')?.innerText.includes('sesshuttle_fixture')",
    );
    assert.ok(
      (await run("document.querySelector('.task-feedback').innerText")).includes(
        tr('模型服务', 'model provider'),
      ),
    );
    // A program with a provider catalog is checked before any history is
    // written; without one, the native resume check reports it afterwards.
    if (await providerCatalog(binary)) {
      const histories = await fs
        .readdir(path.join(target, 'sessions'), { recursive: true })
        .catch(() => []);
      assert.ok(
        !histories.some((f) => f.endsWith('.jsonl')),
        'provider must be checked before writing the selected history: ' + histories.join(', '),
      );
      for (const file of (await fs.readdir(target)).filter((f) => /^state_.*sqlite$/.test(f))) {
        const db = new DatabaseSync(path.join(target, file), { readOnly: true });
        try {
          assert.equal(
            db.prepare('select count(*) as n from threads where id=?').get(exchangeData.tid).n,
            0,
          );
        } finally {
          db.close();
        }
      }
      await fs.writeFile(
        path.join(target, 'config.toml'),
        'model_provider = "sesshuttle_fixture"\nmodel = "gpt-6.1-sol"\n[model_providers.sesshuttle_fixture]\nname = "Local sample"\nbase_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n',
      );
      await click(tr('配置服务后重试导入', 'Retry after configuring the provider'));
      await until(dialog);
      await toReview();
      await click(tr('确认导入到', 'Confirm import to'), dialog);
      await until("document.querySelector('.task-feedback.success')");
      assert.ok(
        (await run("document.querySelector('.task-feedback').innerText")).includes(
          tr('GPT 桌面端', 'GPT desktop'),
        ),
      );
    } else
      console.log(
        'Note: this Codex program does not list its model providers, so the provider is reported after the history is written; the retry part needs a program that lists providers (the Linux build used for 0.6.0 did).',
      );
  }
  console.log('PASS packaged import (' + language + ', ' + phase + ')');
} finally {
  ws.close();
}
