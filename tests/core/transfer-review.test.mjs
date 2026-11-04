import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Engine} from '../../core/engine.mjs';
import {State} from '../../core/state.mjs';
import {Vault} from '../../core/vault.mjs';
import {MemoryStore} from '../../core/storage.mjs';
import {newKey} from '../../core/crypto.mjs';
import {hash,id} from '../../core/util.mjs';

test('mixed preview binds omissions to a chat and only executes the confirmed eligible subset',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-scope-'));
 const state=new State(path.join(root,'app'));
 t.after(async()=>{state.close();await fs.rm(root,{recursive:true,force:true});});
 const home=path.join(root,'codex'),dir=path.join(home,'sessions');
 await fs.mkdir(dir,{recursive:true});
 const ids=[id(),id(),id()];
 for(const [index,logical] of ids.entries()){
   const source=index===2?{subagent:{thread_spawn:{parent_thread_id:id()}}}:'cli';
   const lines=[{type:'session_meta',payload:{id:logical,source,cli_version:'0.166.0',timestamp:'2026-11-01T00:00:00Z',cwd:root}},
     {type:'event_msg',payload:{item:{type:'userMessage',content:['a','b'].map(name=>({type:'localImage',path:path.join(root,name+'.png')}))}}}];
   await fs.writeFile(path.join(dir,logical+'.jsonl'),lines.map(l=>JSON.stringify(l)).join('\n')+'\n');
 }
 state.set('config',{sourceHomes:[home],targets:{},bindings:{}});
 const store=new MemoryStore(),vault=new Vault(store,id(),newKey());
 await vault.create();const before=store.objects.size;
 const engine=new Engine(state,{vault});await engine.refresh();
 const plan=await engine.preview({ids,direction:'upload',targets:[]});
 const ready=plan.items.filter(i=>!i.excludedReason);
 assert.equal(ready.length,2);assert.equal(plan.items[2].excludedReason,'missing_dependency');
 const accept=item=>item.attachmentReview.optional.map(a=>a.key);
 assert.equal(accept(ready[0]).length,2);
 await assert.rejects(engine.execute(plan.token),{code:'partial_scope_confirmation'});
 await assert.rejects(engine.execute(plan.token,{onlyEligible:true,acceptedByItem:{[ids[1]]:{primary:accept(ready[0])}}}),{code:'invalid_selection'});
 assert.equal(store.objects.size,before);
 const acceptedByItem=Object.fromEntries(ready.map(item=>[item.id,{primary:accept(item)}]));
 const job=await engine.execute(plan.token,{onlyEligible:true,acceptedByItem});
 assert.deepEqual(job.items.map(i=>i.status),['uploaded','uploaded','excluded']);
 assert.equal(state.get('job/'+job.id).items[2].error.code,'missing_dependency');
 assert.equal(await vault.head(ids[2]),null);
});

test('retries reuse authenticated encrypted chunks and recover from a damaged local copy',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-retry-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new MemoryStore(),vault=new Vault(store,id(),newKey()),plain=Buffer.from('synthetic history');
 const digest=hash(plain),key=vault.prefix+'blobs/'+digest;
 await vault.stageChunk(digest,plain,root);
 await store.put(key,await fs.readFile(vault.staged.get(digest)),null);
 const cache=path.join(root,'cache');await fs.mkdir(cache);
 let reads=0;const get=store.get.bind(store);store.get=async key=>{reads++;return get(key);};
 assert.deepEqual(await vault.readChunk(digest,cache),plain);
 assert.deepEqual(await vault.readChunk(digest,cache),plain);
 assert.equal(reads,1);assert.ok(!(await fs.readFile(path.join(cache,digest))).includes(plain));
 await fs.writeFile(path.join(cache,digest),'broken');
 assert.deepEqual(await vault.readChunk(digest,cache),plain);assert.equal(reads,2);
});
