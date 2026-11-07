import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../core/state.mjs';
import { id } from '../core/util.mjs';
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-ui-')));
await fs.writeFile(path.join(root, '.sesshuttle-test.json'), JSON.stringify({ format: 1 }));
const home = path.join(root, 'codex');
await fs.mkdir(path.join(home, 'sessions/2026/11/01'), { recursive: true });
const project = path.join(root, 'demo-project 中文');
await fs.mkdir(project);
const target = path.join(root, 'destination');
await fs.mkdir(target);
const state = new State(path.join(root, 'app-data'));
const synthetic = process.argv[2] ? await fs.readFile(process.argv[2], 'utf8') : null;
if (synthetic && JSON.parse(synthetic.split('\n')[0]).payload.originator !== 'sesshuttle_lab')
  throw Error('Synthetic lab fixture required');
const records = [
  [
    'desktop',
    'codex_work_desktop',
    'vscode',
    '为项目增加多入口同步',
    '保留完整上下文，在另一台电脑接着做。',
  ],
  [
    'ide',
    'codex_vscode',
    'vscode',
    'Review the settings panel',
    'Check the Chinese and English interface.',
  ],
  ['cli', 'codex_cli_rs', 'cli', '检查导入备份与恢复', '这是独立的合成对话，不包含真实工作历史。'],
];
for (const [, originator, source, title, text] of records) {
  const tid = id();
  const data = [
    {
      type: 'session_meta',
      payload: {
        id: tid,
        cli_version: '0.164.0',
        timestamp: '2026-11-01T12:00:00Z',
        cwd: project,
        originator,
        source,
      },
    },
    { type: 'event_msg', payload: { type: 'user_message', message: title } },
    { type: 'event_msg', payload: { type: 'agent_message', message: text } },
  ];
  let content = data.map((x) => JSON.stringify(x)).join('\n') + '\n';
  if (synthetic) {
    const originalId = JSON.parse(synthetic.split('\n')[0]).payload.id;
    const lines = synthetic.replaceAll(originalId, tid).trim().split('\n').map(JSON.parse);
    Object.assign(lines[0].payload, { id: tid, source, originator, cwd: project });
    content = lines.map((x) => JSON.stringify(x)).join('\n') + '\n';
  }
  await fs.writeFile(
    path.join(home, 'sessions/2026/11/01', `rollout-2026-11-01T12-00-00-${tid}.jsonl`),
    content,
  );
}
state.set('config', {
  language: 'zh-CN',
  sourceHomes: [home],
  targets: Object.fromEntries(
    ['desktop', 'cli', 'ide'].map((x) => [
      x,
      { home: target, binary: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex' },
    ]),
  ),
  bindings: {},
});
state.set('device', { id: id(), name: 'Mac · 隔离测试', platform: 'darwin' });
state.close();
console.log(root);
