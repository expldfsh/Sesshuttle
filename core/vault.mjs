import {attachmentReview,inheritedOmissions} from './attachment-policy.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
import {atomic,exists} from './util.mjs';
import {validateBundle,bundleIdentity,bundleBytes} from './bundle.mjs';
import { seal, unseal, parseKey } from './crypto.mjs';
import { hash, requireThat, Fault, id } from './util.mjs';
import { validatePayload, relation } from './codex.mjs';
export class Vault {
 constructor(store,space,key){requireThat(/^[0-9a-f-]{36}$/i.test(space),'invalid_space');parseKey(key);this.store=store;this.space=space;this.key=key;this.prefix='sesshuttle/v1/'+space+'/';}
 async put(key,body,etag){if(this.writeBudget){requireThat(body.length<=this.writeBudget.remaining,'upload_limit');this.writeBudget.remaining-=body.length;}return this.store.put(key,body,etag);}
 async stageChunk(digest,data,stage){const object='blobs/'+digest;const file=path.join(stage,digest);this.staged??=new Map();if(this.staged.has(digest)&&await exists(this.staged.get(digest)))return;
  const sealed=seal({data:data.toString('base64')},this.key,this.space,object);const disk=await fs.statfs(stage);requireThat(disk.bavail*disk.bsize>sealed.length+256*1024*1024,'disk_space');await atomic(file,sealed);this.staged.set(digest,file);
 }
 async readChunk(digest){requireThat(/^[0-9a-f]{64}$/.test(digest),'corrupt_data');const object='blobs/'+digest;const r=await this.store.get(this.prefix+object);requireThat(r,'missing_remote_object');const x=unseal(r.body,this.key,this.space,object);requireThat(typeof x.data==='string','corrupt_data');const b=Buffer.from(x.data,'base64');requireThat(b.length<=4*1024*1024&&hash(b)===digest,'corrupt_data');return b;}
 async inventory(){const objects=await this.store.inventory(this.prefix);return {objects:new Map(objects.map(x=>[x.key,x.bytes])),bytes:objects.reduce((n,x)=>n+x.bytes,0)};}
 async estimate(payloads,inventory){const unique=new Set();let bytes=0;for(const p of payloads)if(p.format===2)for(const f of p.files)for(const a of f.artifacts)for(const c of a.chunks){if(unique.has(c.hash)||inventory.objects.has(this.prefix+'blobs/'+c.hash))continue;unique.add(c.hash);const file=this.staged?.get(c.hash);requireThat(file,'stale_plan');bytes+=(await fs.stat(file)).size;}return {bytes,objects:unique.size};}
 async uploadChunks(payload){const inventory=await this.inventory();for(const f of payload.files)for(const a of f.artifacts)for(const c of a.chunks){const key=this.prefix+'blobs/'+c.hash;if(inventory.objects.has(key))continue;const file=this.staged?.get(c.hash);requireThat(file,'stale_plan');const body=await fs.readFile(file);const plain=Buffer.from(unseal(body,this.key,this.space,'blobs/'+c.hash).data,'base64');requireThat(hash(plain)===c.hash&&plain.length===c.bytes,'corrupt_data');try{await this.put(key,body,null);}catch(e){if(e.code!=='concurrent_update')throw e;}inventory.objects.set(key,body.length);}}
 async create(){await this.put(this.prefix+'space',seal({format:1,space:this.space,createdAt:new Date().toISOString()},this.key,this.space,'space'),null);return this.open();}
 async open(){const r=await this.store.get(this.prefix+'space');requireThat(r,'space_not_found');const x=unseal(r.body,this.key,this.space,'space');requireThat(x.format===1&&x.space===this.space,'invalid_space');return x;}
 async heads(){await this.open();const keys=await this.store.list(this.prefix+'heads/');const result=[];
  for(const key of keys){const logical=key.slice((this.prefix+'heads/').length);if(!/^[0-9a-f-]{36}$/i.test(logical))throw new Fault('corrupt_data');
   const h=await this.head(logical);if(h)result.push(h);}
  return result;
 }
 async head(logical){requireThat(/^[0-9a-f-]{36}$/i.test(logical),'corrupt_data');const key='heads/'+logical;const r=await this.store.get(this.prefix+key);if(!r)return null;
  const h=unseal(r.body,this.key,this.space,key);requireThat(h.logicalId===logical&&Array.isArray(h.tips)&&Array.isArray(h.versions),'corrupt_data');return {...h,etag:r.etag};}
 async version(version){requireThat(/^[0-9a-f]{64}$/.test(version),'corrupt_data');const key='versions/'+version;
  const r=await this.store.get(this.prefix+key);requireThat(r,'missing_remote_object');const payload=unseal(r.body,this.key,this.space,key);
  requireThat(hash(JSON.stringify(payload))===version,'corrupt_data');if(payload.format===2)validateBundle(payload);else validatePayload(payload);return payload;
 }
 async choose(logical,version,expectedEtag){
  const head=await this.head(logical);requireThat(head?.versions.some(x=>x.id===version),'invalid_selection');
  requireThat(head.etag===expectedEtag,'concurrent_update');const next={...head,tips:[version],resolvedAt:new Date().toISOString()};delete next.etag;
  await this.put(this.prefix+'heads/'+logical,seal(next,this.key,this.space,'heads/'+logical),head.etag);return next;
 }
 async publish(payload,device){if(payload.format===2)validateBundle(payload);else validatePayload(payload);
  for(let attempt=0;attempt<4;attempt++){
   const head=await this.head(payload.logicalId);const tips=head?.tips??[];const parents=[],remaining=[];
   for(const tip of tips){const old=await this.version(tip);const r=payload.format===2||old.format===2?(payload.format===old.format&&bundleIdentity(payload)===bundleIdentity(old)?'synced':payload.baseVersion===tip?'local_changes':'conflict'):relation(payload,old);
    if(r==='synced'||r==='remote_changes')return {version:tip,head,unchanged:true};
    if(r==='local_changes')parents.push(tip);else remaining.push(tip);
   }
   if(payload.format===2)await this.uploadChunks(payload);
   const versionPayload={...payload,parents,device,uploadedAt:new Date().toISOString()};
   const version=hash(JSON.stringify(versionPayload));const object='versions/'+version;
   try{await this.put(this.prefix+object,seal(versionPayload,this.key,this.space,object),null);}catch(e){if(e.code!=='concurrent_update')throw e;}
   const check=await this.version(version);requireThat(check.logicalId===payload.logicalId,'corrupt_data');
   const next={format:1,logicalId:payload.logicalId,title:payload.title,source:payload.source,project:payload.project,originProject:payload.originProject,projectId:payload.projectId,
    updatedAt:payload.updatedAt,device,tips:[...remaining,version],versions:[...(head?.versions??[]),{id:version,parents,device,at:versionPayload.uploadedAt}],
    omittedImageCount:attachmentReview(payload).optional.length+inheritedOmissions(payload).length,bytes:bundleBytes(payload),continuation:payload.continuation,messages:payload.messages,kind:payload.kind,parent:payload.parent,agent:payload.agent,archived:payload.archived,issues:payload.issues};
   try{const etag=await this.put(this.prefix+'heads/'+payload.logicalId,seal(next,this.key,this.space,'heads/'+payload.logicalId),head?.etag??null);return {version,head:{...next,etag},conflict:remaining.length>0};}
   catch(e){if(e.code!=='concurrent_update')throw e;}
  }
  throw new Fault('concurrent_update');
 }
}
