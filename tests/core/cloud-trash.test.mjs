import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash,id} from '../../core/util.mjs';
import {newKey} from '../../core/crypto.mjs';
import {Vault} from '../../core/vault.mjs';
import {MemoryStore} from '../../core/storage.mjs';
import {changeCloud,cloudBins,cloudRemovalPlan} from '../../core/cloud-trash.mjs';

function payload(tid,text){
  const raw=Buffer.from(JSON.stringify({type:'session_meta',payload:{id:tid,cli_version:'0.164.0',source:'cli',cwd:'/sample'}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'user_message',message:text}})+'\n');
  return {format:1,logicalId:tid,title:text,source:'cli',project:'/sample',archived:false,issues:[],files:[{id:tid,raw:raw.toString('base64'),hash:hash(raw),version:'0.164.0',issues:[]}]};
}
async function apply(v,request,op=id()){
  const {preview}=await cloudRemovalPlan(v,request);await changeCloud(v,request,preview.signature,op,{upgrade:true});return {op,preview};
}
test('cloud bin survives reopening, keeps divergent edits and never restores to a device',async()=>{
  const store=new MemoryStore(),key=newKey(),v=new Vault(store,id(),key);await v.create();
  const t=id(),other=new Vault(store,v.space,key);const first=await v.publish(payload(t,'sample'),{name:'Fake Mac'});
  const op=id(),request={action:'trash',ids:[t]},snapshot=[...store.objects].map(([k,x])=>[k,x.etag]);
  const {preview}=await cloudRemovalPlan(v,request);assert.deepEqual(snapshot,[...store.objects].map(([k,x])=>[k,x.etag]));
  await changeCloud(v,request,preview.signature,op,{upgrade:true});assert.equal(await other.head(t),null);assert.equal((await cloudBins(other)).bins[0].id,op);
  const next=await other.publish(payload(t,'a different edit'),{name:'Fake Linux'});
  await apply(other,{action:'restore',ids:[t],binId:op});
  assert.deepEqual(new Set((await v.head(t)).tips),new Set([first.version,next.version]));assert.equal((await cloudBins(v)).bins.length,0);
});
test('hard deletion rejects stale previews and resumes partial object cleanup',async()=>{
  const s=new MemoryStore(),v=new Vault(s,id(),newKey());await v.create();const t=id(),outside=new Vault(s,id(),newKey());await outside.create();
  const first=await v.publish(payload(t,'old'),{id:'m'}),request={action:'purge',ids:[t]};
  const stale=await cloudRemovalPlan(v,request);await v.publish(payload(t,'another branch'),{id:'l'});
  await assert.rejects(changeCloud(v,request,stale.preview.signature,id(),{upgrade:true}),{code:'stale_plan'});
  const foreign=await outside.publish(payload(t,'other space'),{id:'m'});
  const {preview}=await cloudRemovalPlan(v,request),op=id();const remove=s.remove.bind(s);let fail=true;
  s.remove=async k=>{if(fail){fail=false;throw Error('injected transport loss');}return remove(k);};
  await assert.rejects(changeCloud(v,request,preview.signature,op,{upgrade:true}));
  assert.equal((await cloudBins(v)).pending.id,op);await assert.rejects(v.publish(payload(t,'new'),{}),{code:'cloud_cleanup_pending'});
  await changeCloud(v,null,null,op);await changeCloud(v,null,null,op);
  await assert.rejects(v.version(first.version),{code:'missing_remote_object'});assert.equal((await outside.version(foreign.version)).title,'other space');
});
test('partial version removal shows the surviving head and does not reactivate resolved branches',async()=>{
  const v=new Vault(new MemoryStore(),id(),newKey());await v.create();const t=id();
  const one=await v.publish(payload(t,'one'),{}),two=await v.publish(payload(t,'two'),{});
  await v.choose(t,two.version,two.head.etag);
  const {preview}=await apply(v,{ids:[t],action:'purge',versions:{[t]:[two.version]}});
  assert.deepEqual(preview.items[0].nextTips.map(x=>x.id),[one.version]);assert.equal((await v.head(t)).title,'one');
  const {op}=await apply(v,{ids:[t],action:'trash'});await apply(v,{ids:[t],binId:op,action:'purgeBin'});
  assert.equal((await cloudBins(v)).bins.length,0);await assert.rejects(v.version(one.version),{code:'missing_remote_object'});
});
