import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importMatchesSettings } from '../../core/continue-rules.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sesshuttle-continue-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'codex'),
    project = path.join(root, 'project');
  await fs.mkdir(home);
  // What an import records: the resolved data folder, the runtime and the project as set.
  const record = { home, binary: path.join(root, 'codex-0.166'), project };
  return { root, home, project, record };
}

test('an import stays openable when its data folder is spelled another way', async (t) => {
  const { root, home, project, record } = await fixture(t);
  const target = { home, binary: record.binary };
  assert.equal(await importMatchesSettings('cli', record, target, project), true);
  for (const spelling of [
    home + path.sep,
    [root, 'codex', '..', 'codex'].join(path.sep),
    [root, '.', 'codex'].join(path.sep),
  ])
    assert.equal(
      await importMatchesSettings('cli', record, { ...target, home: spelling }, project),
      true,
      spelling,
    );
});

test('a moved runtime only stops the CLI, which Sesshuttle starts itself', async (t) => {
  const { root, project, record } = await fixture(t);
  // An update of a Store app installs its runtime in a folder named after the version.
  const target = { home: record.home, binary: path.join(root, 'codex-0.169') };
  assert.equal(await importMatchesSettings('desktop', record, target, project), true);
  assert.equal(await importMatchesSettings('ide', record, target, project), true);
  assert.equal(await importMatchesSettings('cli', record, target, project), false);
});

test('another data folder or project folder needs a new import', async (t) => {
  const { root, project, record } = await fixture(t);
  const target = { home: record.home, binary: record.binary };
  const other = path.join(root, 'other');
  await fs.mkdir(other);
  for (const entry of ['desktop', 'cli', 'ide']) {
    assert.equal(
      await importMatchesSettings(entry, record, { ...target, home: other }, project),
      false,
    );
    assert.equal(
      await importMatchesSettings(
        entry,
        record,
        { ...target, home: path.join(root, 'gone') },
        project,
      ),
      false,
    );
    assert.equal(
      await importMatchesSettings(entry, record, { ...target, home: '' }, project),
      false,
    );
    assert.equal(
      await importMatchesSettings(entry, record, { ...target, home: 'codex' }, project),
      false,
    );
    assert.equal(await importMatchesSettings(entry, record, target, other), false);
    assert.equal(await importMatchesSettings(entry, record, target, undefined), false);
    assert.equal(await importMatchesSettings(entry, record, undefined, project), false);
    assert.equal(await importMatchesSettings(entry, undefined, target, project), false);
  }
});
