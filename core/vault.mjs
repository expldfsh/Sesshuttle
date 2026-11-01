import { seal, unseal, parseKey } from './crypto.mjs';
import { hash, requireThat, Fault, id } from './util.mjs';
import { validatePayload, relation } from './codex.mjs';
export class Vault {
 constructor(store,space,key){requireThat(/^[0-9a-f-]{36}$/i.test(space),'invalid_space');parseKey(key);this.store=store;this.space=space;this.key=key;this.prefix='sesshuttle/v1/'+space+'/';}
 async create(){await this.store.put(this.prefix+'space',seal({format:1,space:this.space,createdAt:new Date().toISOString()},this.key,this.space,'space'),null);return this.open();}
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
  requireThat(hash(JSON.stringify(payload))===version,'corrupt_data');validatePayload(payload);return payload;
 }
 async publish(payload,device){validatePayload(payload);
  for(let attempt=0;attempt<4;attempt++){
   const head=await this.head(payload.logicalId);const tips=head?.tips??[];const parents=[],remaining=[];
   for(const tip of tips){const old=await this.version(tip);const r=relation(payload,old);
    if(r==='synced')return {version:tip,head,unchanged:true};
    if(r==='local_changes')parents.push(tip);else remaining.push(tip);
   }
   const versionPayload={...payload,parents,device,uploadedAt:new Date().toISOString()};
   const version=hash(JSON.stringify(versionPayload));const object='versions/'+version;
   try{await this.store.put(this.prefix+object,seal(versionPayload,this.key,this.space,object),null);}catch(e){if(e.code!=='concurrent_update')throw e;}
   const check=await this.version(version);requireThat(check.logicalId===payload.logicalId,'corrupt_data');
   const next={format:1,logicalId:payload.logicalId,title:payload.title,source:payload.source,project:payload.project,projectId:payload.projectId,
    updatedAt:payload.updatedAt,device,tips:[...remaining,version],versions:[...(head?.versions??[]),{id:version,parents,device,at:versionPayload.uploadedAt}],
    bytes:payload.files.reduce((n,x)=>n+Buffer.byteLength(x.raw,'base64'),0),issues:payload.issues};
   try{const etag=await this.store.put(this.prefix+'heads/'+payload.logicalId,seal(next,this.key,this.space,'heads/'+payload.logicalId),head?.etag??null);return {version,head:{...next,etag},conflict:remaining.length>0};}
   catch(e){if(e.code!=='concurrent_update')throw e;}
  }
  throw new Fault('concurrent_update');
 }
}
