import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {relatedRows} from '../../core/bundle.mjs';import {projectFor} from '../../core/catalog.mjs';import {State} from '../../core/state.mjs';import {Engine} from '../../core/engine.mjs';import {Vault} from '../../core/vault.mjs';import {MemoryStore} from '../../core/storage.mjs';import {newKey} from '../../core/crypto.mjs';import {id} from '../../core/util.mjs';
test('scope includes required ancestors without silently adding siblings or descendants',()=>{
 const a={id:'a'},b={id:'b',parent:'a'},c={id:'c',parent:'a'},d={id:'d',parent:'b'},rows=[a,b,c,d];
 assert.deepEqual(relatedRows(a,rows).map(r=>r.id),['a']);assert.deepEqual(relatedRows(b,rows).map(r=>r.id),['a','b']);
 assert.deepEqual(relatedRows(b,rows,{includeDescendants:true}).map(r=>r.id),['a','b','d']);assert.deepEqual(relatedRows(a,rows,{includeDescendants:true}).map(r=>r.id),['a','b','c','d']);
 assert.throws(()=>relatedRows({id:'a',parent:'b'},[{id:'a',parent:'b'},{id:'b',parent:'a'}]),{code:'invalid_history'});
});
test('native projects prefer explicit identity, longest root and matching backing; ambiguity is visible',()=>{
 const catalog={projects:[{id:'old',name:'Old',roots:['/home/.chatgpt-projects/g-p-123']},{id:'new',name:'Current',backing:'g-p-123',roots:['/home/.chatgpt-projects/g-p-123']},{id:'nested',name:'Nested',roots:['/code/app']},{id:'root',name:'Code',roots:['/code']}]};
 assert.equal(projectFor(catalog,{},'/home/.chatgpt-projects/g-p-123').name,'Current');assert.equal(projectFor(catalog,{project_id:'old'},'/code').name,'Old');assert.equal(projectFor(catalog,{},'/code/app/src').name,'Nested');
 assert.equal(projectFor({projects:[{id:'a',name:'A',roots:['/code']},{id:'b',name:'B',roots:['/code']}]},{},'/code').match,'ambiguous');assert.equal(projectFor(catalog,{},'/unknown').match,'directory');
});
test('external image approval is exact, missing files are distinct and preview never uploads',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-scope-'));let state;try{
 const home=path.join(root,'home'),project=path.join(root,'project'),external=path.join(root,'screenshot.png');await fs.mkdir(path.join(home,'sessions'),{recursive:true});await fs.mkdir(project);
 await fs.writeFile(external,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 const tid=id(),file=path.join(home,'sessions',tid+'.jsonl');await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:tid,source:'cli',cli_version:'0.166.0',timestamp:'2026-11-01T00:00:00Z',cwd:project}})+'\n'+JSON.stringify({type:'event_msg',payload:{item:{type:'userMessage',content:[{type:'localImage',path:external}]}}})+'\n');
 state=new State(path.join(root,'state'));state.set('config',{sourceHomes:[home],targets:{},bindings:{}});const store=new MemoryStore(),vault=new Vault(store,id(),newKey());await vault.create();const engine=new Engine(state,{vault});await engine.refresh();const before=store.objects.size;
 let plan=await engine.preview({ids:[tid],direction:'upload',targets:[]});assert.equal(store.objects.size,before);assert.equal(plan.items[0].files[0].attachments[0].status,'approval_required');assert.deepEqual(plan.items[0].issues,['attachment_approval']);
 const key=plan.items[0].files[0].attachments[0].key;plan=await engine.preview({ids:[tid],direction:'upload',targets:[],approvedAttachments:[key]});assert.deepEqual(plan.items[0].issues,[]);assert.equal(plan.items[0].assetCount,1);assert.equal(store.objects.size,before);
 await fs.appendFile(external,'modified');const job=await engine.execute(plan.token);assert.equal(job.items[0].error.code,'stale_plan');assert.equal(store.objects.size,before);
 await fs.rename(external,external+'.kept');plan=await engine.preview({ids:[tid],direction:'upload',targets:[],approvedAttachments:[key]});assert.equal(plan.items[0].files[0].attachments[0].status,'missing');assert.deepEqual(plan.items[0].issues,['attachment_missing']);
 }finally{state?.close();await fs.rm(root,{recursive:true,force:true});}
});
