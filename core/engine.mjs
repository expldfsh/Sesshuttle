import {attachmentUnchanged} from './attachments.mjs';
import {captureBundle,relatedRows,bundleBytes,bundleIdentity} from './bundle.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { normalized } from './receipts.mjs';import { binaryVersion } from './native.mjs';
import { scan,capture,relation } from './codex.mjs';import { Importer } from './importer.mjs';
import { id,hash,requireThat,publicError,Fault,canonical } from './util.mjs';
export class Engine{
 constructor(state,{vault=null,importer=null,onProgress=()=>{}}={}){this.state=state;this.vault=vault;this.importer=importer??new Importer(state);this.onProgress=onProgress;this.plans=new Map();this.cancelled=false;this.running=false;this.local={rows:[],errors:[]};this.remote=[];this.cloudError=null;}
 config(){return this.state.get('config',{language:'zh-CN',sourceHomes:[path.join(os.homedir(),'.codex')],targets:{},bindings:{}});}
 scope(){return this.vault?.space??'offline';}
 association(row){const key='association/'+row.id;let x=this.state.get(key);if(!x){const pkey='project/'+hash(row.home+'\0'+(row.originProject?.nativeId??row.project));let projectId=this.state.get(pkey);if(!projectId)projectId=this.state.set(pkey,id());x=this.state.set(key,{projectId,source:row.source});}if(row.originProject?.nativeId||!x.originProject)x=this.state.set(key,{...x,originProject:row.originProject});return x;}
 signature(row,selection={}){return hash(JSON.stringify(relatedRows(row,this.local.rows,selection).map(r=>[r.id,r.hash,r.title,r.archived]).sort((a,b)=>a[0].localeCompare(b[0]))));}
 baselineKey(row){return 'baseline/'+this.scope()+'/'+hash(row.home)+'/'+row.id;}
 rememberBaseline(row,version,selection={}){this.state.set(this.baselineKey(row),{signature:this.signature(row,selection),version,selection});}
 async snapshot(row,stage,selection={}){const p=await captureBundle(row,this.local.rows,this.vault,stage,selection);const association=this.association(row);const base=this.state.get(this.baselineKey(row));return {...p,originProject:association.originProject??p.originProject,baseVersion:base?.version??null,projectId:association.projectId};}
 async refresh(){requireThat(!this.running,'task_running');this.local=await scan(this.config().sourceHomes);this.cloudError=null;
  if(this.vault){try{this.remote=await this.vault.heads();this.state.set('cache/'+this.scope(),{heads:this.remote,checkedAt:new Date().toISOString()});}catch(e){this.cloudError=publicError(e);this.remote=this.state.get('cache/'+this.scope(),{heads:[]}).heads;}}
  else this.remote=[];
  const rows=[];
  for(const logical of new Set([...this.local.rows.map(x=>x.id),...this.remote.map(x=>x.logicalId)])){
   const local=this.local.rows.find(x=>x.id===logical),head=this.remote.find(x=>x.logicalId===logical);let status=local?(head?'unchecked':'local_only'):'remote_only';
   if(local?.busy)status='busy';else if(head?.tips.length>1)status='conflict';else if(local&&head&&!this.cloudError){const base=this.state.get(this.baselineKey(local));status=base?(base.signature===this.signature(local,base.selection)?(head.tips.includes(base.version)?'synced':'remote_changes'):(head.tips.includes(base.version)?'local_changes':'conflict')):'conflict';}
   const association=local?this.association(local):{projectId:head?.projectId,originProject:head?.originProject};
   rows.push({id:logical,title:local?.title??head.title,source:local?local.source:head.source,project:local?.project??head.project,originProject:association.originProject??local?.originProject??head?.originProject,projectId:association.projectId,
    continuation:local?.continuation??head?.continuation??true,kind:local?.kind??head?.kind??(head?.source==='subagent'?'background':'main'),parent:local?.parent??head?.parent,parentTitle:local?.parentTitle,agent:local?.agent??head?.agent,compressed:local?.compressed,historyBytes:local?.historyBytes,fileBytes:local?.fileBytes,databaseBytes:local?.databaseBytes,updatedAt:local?.updatedAt,cloudUpdatedAt:head?.versions.at(-1)?.at,device:head?.device,bytes:local?.bytes??head.bytes,archived:local?.archived??head?.archived??false,
    issues:local?.issues??head?.issues??[],status,local:!!local,remote:!!head,version:local?.version,
    messages:local?.messages??head?.messages??[],totalMessages:local?.totalMessages??0,
    versions:head?.versions??[],tips:head?.tips??[],targets:Object.fromEntries(Object.entries(this.state.get('entries/'+this.scope()+'/'+logical,{})).map(([entry,value])=>[entry,{...value,syncStatus:head?.tips.includes(value.version)?'synced':'remote_changes'}]))});
  }
  this.rows=rows.sort((a,b)=>(b.updatedAt??b.cloudUpdatedAt??'').localeCompare(a.updatedAt??a.cloudUpdatedAt??''));
  return {rows:this.rows,errors:this.local.errors,cloudError:this.cloudError,checkedAt:this.local.checkedAt,remoteCheckedAt:this.state.get('cache/'+this.scope())?.checkedAt};
 }
 async preview({ids,direction,targets,allowIncomplete=false,chosenVersion=null,uploadLimitMiB=500,includeDescendants=false,approvedAttachments=[]}){
  requireThat(!this.running,'task_running');requireThat(this.vault,'storage_not_connected');requireThat(!this.cloudError,'cloud_check_failed');
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=2000&&ids.every(x=>this.rows.some(r=>r.id===x)),'invalid_selection');
  requireThat(['upload','download','both'].includes(direction),'invalid_selection');requireThat(Array.isArray(targets)&&targets.every(x=>['desktop','cli','ide'].includes(x)),'invalid_selection');
  requireThat(direction==='upload'||targets.length>0,'target_required');
  requireThat(typeof includeDescendants==='boolean'&&Array.isArray(approvedAttachments)&&approvedAttachments.length<=10000&&approvedAttachments.every(k=>/^[0-9a-f]{64}$/.test(k)),'invalid_selection');const selection={includeDescendants,approvedAttachments};
  requireThat(Number.isFinite(uploadLimitMiB)&&uploadLimitMiB>=1&&uploadLimitMiB<=1048576,'invalid_settings');
  for(const old of this.plans.values())if(old.stage)await fs.rm(old.stage,{recursive:true,force:true});this.plans.clear();this.vault.staged=new Map();const token=id(),stage=path.join(this.state.root,'staging',token);await fs.mkdir(stage,{recursive:true,mode:0o700});
  const targetSnapshots={};
  if(direction!=='upload'||chosenVersion)for(const entry of targets){const t=this.config().targets[entry];if(!t?.home)continue;try{const home=await canonical(t.home);if(!targetSnapshots[home]){const scanResult=await scan([home]);targetSnapshots[home]={hashes:Object.fromEntries(scanResult.rows.map(r=>[r.id,r.hash])),errors:scanResult.errors.length};}}catch{}}
  const items=[];
  for(const logical of [...new Set(ids)]){const row=this.rows.find(x=>x.id===logical),local=this.local.rows.find(x=>x.id===logical),head=this.remote.find(x=>x.logicalId===logical);let action='skip';
   if(row.status==='busy')action='busy';
   else if(chosenVersion){requireThat(head?.versions.some(x=>x.id===chosenVersion),'invalid_selection');action='resolve';}
   else if(direction==='upload'&&local)action='upload';
   else if(direction==='download'&&head)action=head.tips.length>1?'conflict':'download';
   else if(direction==='both'){if(['local_only','local_changes'].includes(row.status))action='upload_import';else if(['remote_only','remote_changes','synced'].includes(row.status))action='download';else if(row.status==='conflict')action='preserve_conflict';}
   let fileCount=1,assetCount=0,bytes=row.bytes,issues=row.issues,payload=null,preserve=null;
   try{payload=['download','resolve'].includes(action)?await this.vault.version(chosenVersion??head.tips[0]):!['skip','busy','conflict'].includes(action)&&local?await this.snapshot(local,stage,selection):null;
    if(action==='resolve'&&local)preserve=await this.snapshot(local,stage,selection);
    if(payload){fileCount=payload.files.length;assetCount=payload.format===2?payload.files.reduce((n,f)=>n+f.artifacts.filter(a=>a.kind==='asset').length,0):payload.assets?.length??0;bytes=bundleBytes(payload);issues=payload.issues;}
   }catch(e){issues=[...issues,e.code??'operation_failed'];action='blocked';}
   items.push({id:logical,title:row.title,action,bytes,fileCount,assetCount,expectedHash:local?.hash??null,expectedSignature:local?this.signature(local,selection):null,expectedHead:head?.etag??null,
     version:chosenVersion??head?.tips[0]??null,issues,continuation:payload?.continuation??row.continuation,targets:['download','resolve','upload_import'].includes(action)?targets:[],projectId:row.projectId,originProject:row.originProject,files:payload?.files.map(f=>({id:f.id,title:f.title,kind:f.kind??(f.source==='subagent'?'background':'main'),parent:f.parent,originProject:f.originProject??payload.originProject,bytes:f.artifacts?f.artifacts.reduce((n,a)=>n+a.bytes,0):Buffer.byteLength(f.raw,'base64'),reason:ids.includes(f.id)?'selectedChat':['download','resolve'].includes(action)?'backupMember':f.id===local?.parent||relatedRows(local,this.local.rows).some(r=>r.id===f.id)?'requiredParent':'selectedDescendant',attachments:f.attachmentReport??[],issues:f.issues??[]}))??[],payload,preserve});
  }
  const inventory=await this.vault.inventory();const uploads=items.flatMap(x=>[...(['upload','upload_import','preserve_conflict'].includes(x.action)&&x.payload?[x.payload]:[]),...(x.preserve?[x.preserve]:[])]);const estimated=await this.vault.estimate(uploads,inventory);
  // Reserve a conservative upper bound for encrypted manifests and replacement heads.
  // Chunks have their exact encrypted size; metadata reserve avoids a false exact quota promise.
  const metadataReserve=uploads.reduce((n,p)=>n+4*Buffer.byteLength(JSON.stringify(p))+4*Buffer.byteLength(JSON.stringify(this.remote.find(h=>h.logicalId===p.logicalId)??{}))+65536,0);
  const uploadBytes=estimated.bytes+metadataReserve,uploadLimitBytes=Math.floor(uploadLimitMiB*1024*1024);
  const plan={stage,targetSnapshots,token,ids:[...new Set(ids)],selection,space:this.scope(),configHash:hash(JSON.stringify(this.config())),direction,targets,allowIncomplete,items,createdAt:new Date().toISOString(),cloudBytes:inventory.bytes,chunkUploadBytes:estimated.bytes,metadataReserve,uploadBytes,uploadLimitBytes,overLimit:uploadBytes>uploadLimitBytes,largeUpload:uploadBytes>100*1024*1024||uploads.some(p=>bundleBytes(p)>100*1024*1024)};this.plans.set(token,plan);
  return {...plan,stage:undefined,items:items.map(({payload,preserve,...x})=>x)};

 }
 async discardPlan(token){const plan=this.plans.get(token);if(plan){this.plans.delete(token);await fs.rm(plan.stage,{recursive:true,force:true});}}
 cancel(){this.cancelled=true;}
 async execute(token,{confirmLarge=false}={}){const plan=this.plans.get(token);requireThat(plan&&plan.space===this.scope()&&plan.configHash===hash(JSON.stringify(this.config())),'stale_plan');requireThat(!this.running,'task_running');requireThat(!plan.overLimit,'upload_limit');requireThat(!plan.largeUpload||confirmLarge,'large_upload_confirmation');this.plans.delete(token);this.running=true;this.cancelled=false;this.vault.writeBudget={remaining:plan.uploadBytes};
  const job={id:id(),startedAt:new Date().toISOString(),status:'running',items:[]};this.state.set('job/'+job.id,job);
  try{for(const item of plan.items){if(this.cancelled){job.status='paused';break;}const result={id:item.id,title:item.title,action:item.action,status:'running',targets:{}};job.items.push(result);this.onProgress({...job});
   try{if(['skip','busy','conflict','blocked'].includes(item.action)){result.status=item.action;continue;}
    const current=await scan(this.config().sourceHomes);const local=current.rows.find(x=>x.id===item.id);requireThat((local?.hash??null)===item.expectedHash,'stale_plan');
    const head=await this.vault.head(item.id);requireThat((head?.etag??null)===item.expectedHead,'stale_plan');this.local=current;requireThat((local?this.signature(local,plan.selection):null)===item.expectedSignature,'stale_plan');
    let payload,importVersion=item.version,resolveEtag=head?.etag;
    if(['upload','upload_import','preserve_conflict'].includes(item.action)){
      requireThat(local,'stale_plan');payload=item.payload;for(const f of payload.files)for(const a of f.attachmentReport??[])if(a.status==='included')requireThat(await attachmentUnchanged(a),'stale_plan');requireThat(!payload.issues.length||plan.allowIncomplete,'incomplete_history');
      const published=await this.vault.publish(payload,this.state.get('device'));this.rememberBaseline(local,published.version,plan.selection);for(const f of payload.files){const r=this.local.rows.find(x=>x.id===f.id);if(r){const k='bundle-receipt/'+hash(r.home)+'/'+r.id;this.state.set(k,{hash:r.hash,identity:bundleIdentity(payload)});}}result.cloudStatus='uploaded';
      if(item.action!=='upload_import'||published.conflict){result.status=published.conflict?'conflict_preserved':'uploaded';continue;}
      importVersion=published.version;payload=await this.vault.version(importVersion);
    }else payload=await this.vault.version(importVersion);
    requireThat(!payload.issues?.length,'incomplete_history');
    requireThat(payload.continuation!==false,'missing_rollout');
    // Explicit branch selection first preserves the current local branch remotely.
    if(item.action==='resolve'&&local)resolveEtag=(await this.vault.publish(item.preserve,this.state.get('device'))).head.etag;
    {
      const cfg=this.config(),project=cfg.bindings?.[payload.projectId??item.projectId];requireThat(project,'project_required');
      const grouped=new Map();for(const entry of item.targets){const target=cfg.targets[entry];if(!target?.home||!target?.binary){result.targets[entry]={status:'not_configured'};continue;}
       try{await binaryVersion(target.binary);const home=await canonical(target.home);const group=grouped.get(home)??[];group.push({entry,target:{...target,home,project}});grouped.set(home,group);}catch(e){result.targets[entry]={status:'failed',error:publicError(e)};}}
      for(const group of grouped.values()){
       try{const first=group[0];const r=await this.importer.import(payload,first.target,{replace:item.action==='resolve',vault:this.vault,expectedHashes:Object.fromEntries(payload.files.map(f=>[f.id,plan.targetSnapshots[first.target.home]?.hashes[f.id]??null]))});
        for(const {entry,target}of group){
         // Shared storage is written once; different runtime versions are still checked.
         let nativeStarted=false,nativeTask=null;try{if(entry!==first.entry&&target.binary!==first.target.binary){await this.importer.processGuard();if(!r.backup)r.backup=(await this.importer.backup(target.home)).id;nativeTask=id();this.state.set('import/'+nativeTask,{status:'validating',backup:r.backup,home:target.home});nativeStarted=true;await this.importer.native({binary:target.binary,home:target.home,project,files:payload.files,device:payload.device});await this.importer.record(payload,target.home,project,target.binary,await binaryVersion(target.binary));this.state.set('import/'+nativeTask,{status:'verified',backup:r.backup,home:target.home});}
          result.targets[entry]={status:'verified',version:importVersion,home:target.home,project,binary:target.binary,backup:r.backup,checkedAt:new Date().toISOString()};
         }catch(e){result.targets[entry]={status:'failed',error:publicError(e),backup:r.backup};if(nativeStarted){this.state.set('import/'+nativeTask,{status:'needs_recovery',backup:r.backup,home:target.home,error:e.code??'native_error'});for(const prior of Object.values(result.targets))if(prior.home===target.home&&prior.status==='verified')prior.status='imported';for(const remaining of group)result.targets[remaining.entry]??={status:'failed',error:{code:'recovery_required',detail:''},backup:r.backup};break;}}
        }
       }catch(e){for(const {entry}of group)result.targets[entry]??={status:'failed',error:publicError(e)};}
      }
      this.local=await scan(this.config().sourceHomes);const importedLocal=this.local.rows.find(x=>x.id===item.id);if(importedLocal&&Object.values(result.targets).some(x=>x.status==='verified'&&x.home===importedLocal.home))this.rememberBaseline(importedLocal,importVersion);
      for(const f of payload.files)this.state.set('association/'+f.id,{projectId:payload.projectId,source:f.source??payload.source,originProject:f.originProject?.nativeId?f.originProject:payload.originProject});
      const key='entries/'+this.scope()+'/'+item.id;this.state.set(key,{...this.state.get(key,{}),...result.targets});
      const values=Object.values(result.targets);if(item.action==='resolve'&&values.length&&values.every(x=>x.status==='verified'))await this.vault.choose(item.id,item.version,resolveEtag);result.status=values.every(x=>['verified','imported'].includes(x.status))?'downloaded':values.some(x=>['verified','imported'].includes(x.status))?'partial':'failed';
    }
   }catch(e){result.status='failed';result.error=publicError(e);}
   finally{this.state.set('job/'+job.id,job);this.onProgress({...job});}
  }
  if(job.status==='running')job.status=job.items.some(x=>['failed','partial','conflict','busy','blocked','conflict_preserved'].includes(x.status))?'attention':'completed';
  }finally{this.vault.writeBudget=null;await fs.rm(plan.stage,{recursive:true,force:true}).catch(()=>{});this.running=false;job.finishedAt=new Date().toISOString();this.state.set('job/'+job.id,job);this.onProgress({...job});}
  return job;
 }
}
