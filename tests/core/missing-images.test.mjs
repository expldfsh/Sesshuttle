import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {attachmentReview,assertAttachmentAcceptance,omittedImageText} from '../../core/attachment-policy.mjs';import {remapHistory} from '../../core/remap-history.mjs';import {referencesFor} from '../../core/attachments.mjs';import {State} from '../../core/state.mjs';import {Engine} from '../../core/engine.mjs';import {Vault} from '../../core/vault.mjs';import {MemoryStore} from '../../core/storage.mjs';import {newKey} from '../../core/crypto.mjs';import {Importer} from '../../core/importer.mjs';import {id,hash} from '../../core/util.mjs';import {materialize,bundleIdentity} from '../../core/bundle.mjs';
const report=(tid,p,status='missing')=>({key:hash(tid+'\0'+p),sessionId:tid,path:p,status});
test('only inventoried local images can be waived, and every file requires explicit confirmation',()=>{
 const a=report(id(),'/missing.png'),file={id:a.sessionId,artifacts:[],attachmentReport:[a],issues:['attachment_missing']},payload={format:2,files:[file],issues:['attachment_missing']};
 assert.deepEqual(attachmentReview(payload).blockingIssues,[]);assert.throws(()=>assertAttachmentAcceptance(payload),{code:'attachment_confirmation_required'});assert.equal(assertAttachmentAcceptance(payload,[a.key]).length,1);
 for(const issue of ['missing_dependency','invalid_history','external_image','attachment_unsafe','attachment_unreadable','remote_resource'])assert.throws(()=>assertAttachmentAcceptance({...payload,issues:[issue]},[a.key]),{code:'incomplete_history'});
 assert.throws(()=>assertAttachmentAcceptance({...payload,files:[file,{id:id(),issues:['attachment_missing']}]},[a.key]),{code:'incomplete_history'});
 assert.throws(()=>assertAttachmentAcceptance({...payload,files:[{...file,attachmentReport:[{...a,key:'forged'}]}]},['forged']),{code:'incomplete_history'});
 assert.throws(()=>assertAttachmentAcceptance({format:1,issues:['external_attachment'],files:[]},[]),{code:'incomplete_history'});
});
test('missing image confirmation protects upload and import; restored image invalidates preview',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-missing-'));let state;try{
 const home=path.join(root,'source'),target=path.join(root,'target'),project=path.join(root,'project');await fs.mkdir(path.join(home,'sessions'),{recursive:true});await fs.mkdir(target);await fs.mkdir(project);const tid=id(),image=path.join(root,'missing.png'),file=path.join(home,'sessions',tid+'.jsonl');
 const raw=[{type:'session_meta',payload:{id:tid,source:'cli',cli_version:'0.166.0',timestamp:'2026-11-01T00:00:00Z',cwd:project}},{type:'event_msg',payload:{item:{type:'userMessage',content:[{type:'text',text:'Keep every original word.'},{type:'localImage',path:image}]}}}].map(JSON.stringify).join('\n')+'\n';await fs.writeFile(file,raw);
 state=new State(path.join(root,'state'));state.set('config',{sourceHomes:[home],targets:{},bindings:{}});const store=new MemoryStore(),vault=new Vault(store,id(),newKey());await vault.create();const engine=new Engine(state,{vault});await engine.refresh();const input={ids:[tid],direction:'upload',targets:[]},before=store.objects.size;
 let p=await engine.preview(input),key=p.items[0].attachmentReview.optional[0].key;let j=await engine.execute(p.token);assert.equal(j.items[0].error.code,'attachment_confirmation_required');assert.equal(store.objects.size,before);
 p=await engine.preview(input);await fs.writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));j=await engine.execute(p.token,{acceptedMissingAttachments:[key]});assert.equal(j.items[0].error.code,'stale_plan');assert.equal(store.objects.size,before);await fs.rename(image,image+'.preserved');
 p=await engine.preview(input);await assert.rejects(engine.execute(p.token,{acceptedMissingAttachments:['not-in-this-preview']}),{code:'invalid_selection'});j=await engine.execute(p.token,{acceptedMissingAttachments:[key]});assert.equal(j.status,'completed');
 const payload=await vault.version((await vault.head(tid)).tips[0]);let guarded=0;const importer=new Importer(state,{testRoot:root,processGuard:async()=>{guarded++;throw Object.assign(Error(),{code:'test_guard'});}});
 await assert.rejects(importer.import(payload,{home:target,project},{vault}),{code:'attachment_confirmation_required'});assert.equal(guarded,0);
 await assert.rejects(importer.import({...payload,issues:[...payload.issues,'missing_dependency']},{home:target,project},{vault,acceptedMissingAttachments:[key]}),{code:'incomplete_history'});assert.equal(guarded,0);
 await assert.rejects(importer.import(payload,{home:target,project},{vault,acceptedMissingAttachments:[key]}),{code:'test_guard'});assert.equal(guarded,1);assert.deepEqual(await fs.readdir(target),[]);
 const staged=await materialize(payload,vault,path.join(root,'download'));await remapHistory(staged.files,target,{acceptedMissingAttachments:[key]});const mapped=staged.files[0].artifacts[0].file;const data=(await fs.readFile(mapped,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(data[1].payload.item.content[0].text,'Keep every original word.');assert.equal(data[1].payload.item.content[1].type,'text');assert.match(data[1].payload.item.content[1].text,/Image not included/);const refs=await referencesFor({id:tid,file:mapped});assert.deepEqual(refs.resources,[]);assert.equal(refs.omittedAttachments[0].path,image);assert.equal(await fs.readFile(file,'utf8'),raw);
 }finally{state?.close();await fs.rm(root,{recursive:true,force:true});}
});


test('attachment availability changes are versioned even if history bytes stay identical',()=>{
 const a=report(id(),'/image.png','approval_required'),file={id:a.sessionId,title:'test',artifacts:[],attachmentReport:[a],issues:['attachment_approval']},p={format:2,files:[file]};
 const q=structuredClone(p);q.files[0].attachmentReport[0].status='missing';q.files[0].issues=['attachment_missing'];assert.notEqual(bundleIdentity(p),bundleIdentity(q));
 const r=structuredClone(p);r.files[0].attachmentReport[0].stamp='later';assert.equal(bundleIdentity(p),bundleIdentity(r));
});
