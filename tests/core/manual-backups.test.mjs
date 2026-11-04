import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {State} from '../../core/state.mjs';
import {Importer} from '../../core/importer.mjs';
import {assertCodexClosed} from '../../core/native.mjs';

test('an active writer invalidates a manual snapshot; no partial snapshot remains',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-changing-')));
 const home=path.join(root,'codex'),sessions=path.join(home,'sessions');
 await fs.mkdir(sessions,{recursive:true});await fs.writeFile(path.join(sessions,'a'),'before');
 const big=await fs.open(path.join(sessions,'z'),'w');await big.truncate(24*1024*1024);await big.close();
 const state=new State(path.join(root,'app'));t.after(async()=>{state.close();await fs.rm(root,{recursive:true,force:true});});
 const importer=new Importer(state,{testRoot:root,processGuard:async()=>assert.fail('read-only backup must not require Codex to quit')});
 const rootBackups=path.join(state.root,'backups');await fs.mkdir(rootBackups);
 const backup=importer.backup(home);
 while(!(await fs.readdir(rootBackups)).length)await new Promise(r=>setTimeout(r,1));
 await fs.appendFile(path.join(sessions,'a'),'after');
 await assert.rejects(backup,e=>['backup_changed','busy','stale_plan'].includes(e.code));
 assert.deepEqual(state.keys('backup/'),[]);assert.deepEqual(await fs.readdir(rootBackups),[]);
});

test('Linux checks the destination used by the running process',{skip:process.platform!=='linux'},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-proc-')));
 const bin=path.join(root,'codex'),other=path.join(root,'other');await fs.mkdir(other);await fs.copyFile('/bin/sleep',bin);
 const child=spawn(bin,['60'],{env:{CODEX_HOME:root}});
 await once(child,'spawn');t.after(async()=>{child.kill();await fs.rm(root,{recursive:true,force:true});});
 await assert.rejects(assertCodexClosed(root),{code:'codex_running'});
 await assertCodexClosed(other);
});
