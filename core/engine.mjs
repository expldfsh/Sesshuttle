import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { scan,capture,relation } from './codex.mjs';import { Importer } from './importer.mjs';
import { id,hash,requireThat,publicError,Fault,canonical } from './util.mjs';
export class Engine{
 constructor(state,{vault=null,importer=null,onProgress=()=>{}}={}){this.state=state;this.vault=vault;this.importer=importer??new Importer(state);this.onProgress=onProgress;this.plans=new Map();this.cancelled=false;this.running=false;this.local={rows:[],errors:[]};this.remote=[];this.cloudError=null;}
 config(){return this.state.get('config',{language:'zh-CN',sourceHomes:[path.join(os.homedir(),'.codex')],targets:{},bindings:{}});}
 scope(){return this.vault?.space??'offline';}
 association(row){const key='association/'+row.id;let x=this.state.get(key);if(!x){const pkey='project/'+hash(row.home+'\0'+row.project);let projectId=this.state.get(pkey);if(!projectId)projectId=this.state.set(pkey,id());x=this.state.set(key,{projectId,source:row.source});}return x;}
 async snapshot(row){const p=await capture(row,this.local.rows);const association=this.association(row);return {...p,projectId:association.projectId,source:association.source};}
 async refresh(){requireThat(!this.running,'task_running');this.local=await scan(this.config().sourceHomes);this.cloudError=null;
  if(this.vault){try{this.remote=await this.vault.heads();this.state.set('cache/'+this.scope(),{heads:this.remote,checkedAt:new Date().toISOString()});}catch(e){this.cloudError=publicError(e);this.remote=this.state.get('cache/'+this.scope(),{heads:[]}).heads;}}
  else this.remote=[];
  const rows=[];
  for(const logical of new Set([...this.local.rows.map(x=>x.id),...this.remote.map(x=>x.logicalId)])){
   const local=this.local.rows.find(x=>x.id===logical),head=this.remote.find(x=>x.logicalId===logical);let status=local?(head?'unchecked':'local_only'):'remote_only';
   if(local?.busy)status='busy';else if(head?.tips.length>1)status='conflict';else if(local&&head&&!this.cloudError){try{status=relation(await this.snapshot(local),await this.vault.version(head.tips[0]));}catch(e){status='pending';}}
   const association=local?this.association(local):{projectId:head?.projectId};
   rows.push({id:logical,title:local?.title??head.title,source:local?association.source:head.source,project:local?.project??head.project,projectId:association.projectId,
    updatedAt:local?.updatedAt,cloudUpdatedAt:head?.versions.at(-1)?.at,device:head?.device,bytes:local?.bytes??head.bytes,archived:local?.archived??false,
    issues:local?.issues??head?.issues??[],status,local:!!local,remote:!!head,version:local?.version,
    messages:local?.messages??[],totalMessages:local?.totalMessages??0,
    versions:head?.versions??[],tips:head?.tips??[],targets:this.state.get('entries/'+this.scope()+'/'+logical,{})});
  }
  this.rows=rows.sort((a,b)=>(b.updatedAt??b.cloudUpdatedAt??'').localeCompare(a.updatedAt??a.cloudUpdatedAt??''));
  return {rows:this.rows,errors:this.local.errors,cloudError:this.cloudError,checkedAt:this.local.checkedAt,remoteCheckedAt:this.state.get('cache/'+this.scope())?.checkedAt};
 }
 async preview({ids,direction,targets,allowIncomplete=false,chosenVersion=null}){
  requireThat(!this.running,'task_running');requireThat(this.vault,'storage_not_connected');requireThat(!this.cloudError,'cloud_check_failed');
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=2000&&ids.every(x=>this.rows.some(r=>r.id===x)),'invalid_selection');
  requireThat(['upload','download','both'].includes(direction),'invalid_selection');requireThat(Array.isArray(targets)&&targets.every(x=>['desktop','cli','ide'].includes(x)),'invalid_selection');
  requireThat(direction==='upload'||targets.length>0,'target_required');
  const items=[];
  for(const logical of [...new Set(ids)]){const row=this.rows.find(x=>x.id===logical),local=this.local.rows.find(x=>x.id===logical),head=this.remote.find(x=>x.logicalId===logical);let action='skip';
   if(row.status==='busy')action='busy';
   else if(chosenVersion){requireThat(head?.versions.some(x=>x.id===chosenVersion),'invalid_selection');action='resolve';}
   else if(direction==='upload'&&local)action='upload';
   else if(direction==='download'&&head)action=head.tips.length>1?'conflict':'download';
   else if(direction==='both'){if(['local_only','local_changes'].includes(row.status))action='upload';else if(['remote_only','remote_changes','synced'].includes(row.status))action='download';else if(row.status==='conflict')action='preserve_conflict';}
   items.push({id:logical,title:row.title,action,bytes:row.bytes,expectedHash:local?.hash??null,expectedHead:head?.etag??null,
     version:chosenVersion??head?.tips[0]??null,issues:row.issues,targets:action==='download'||action==='resolve'?targets:[],projectId:row.projectId});
  }
  const token=id();const plan={token,space:this.scope(),configHash:hash(JSON.stringify(this.config())),direction,targets,allowIncomplete,items,createdAt:new Date().toISOString()};this.plans.clear();this.plans.set(token,plan);return plan;
 }
 cancel(){this.cancelled=true;}
 async execute(token){const plan=this.plans.get(token);requireThat(plan&&plan.space===this.scope()&&plan.configHash===hash(JSON.stringify(this.config())),'stale_plan');requireThat(!this.running,'task_running');this.plans.delete(token);this.running=true;this.cancelled=false;
  const job={id:id(),startedAt:new Date().toISOString(),status:'running',items:[]};this.state.set('job/'+job.id,job);
  try{for(const item of plan.items){if(this.cancelled){job.status='paused';break;}const result={id:item.id,title:item.title,action:item.action,status:'running',targets:{}};job.items.push(result);this.onProgress({...job});
   try{if(['skip','busy','conflict'].includes(item.action)){result.status=item.action;continue;}
    const current=await scan(this.config().sourceHomes);const local=current.rows.find(x=>x.id===item.id);requireThat((local?.hash??null)===item.expectedHash,'stale_plan');
    const head=await this.vault.head(item.id);requireThat((head?.etag??null)===item.expectedHead,'stale_plan');this.local=current;
    if(['upload','preserve_conflict'].includes(item.action)){
      requireThat(local,'stale_plan');const payload=await this.snapshot(local);requireThat(!payload.issues.length||plan.allowIncomplete,'incomplete_history');
      const published=await this.vault.publish(payload,this.state.get('device'));result.status=published.conflict?'conflict_preserved':'uploaded';
    }else{
      const payload=await this.vault.version(item.version);requireThat(!payload.issues?.length,'incomplete_history');
      // Explicit branch selection first preserves the current local branch remotely.
      if(item.action==='resolve'&&local)await this.vault.publish(await this.snapshot(local),this.state.get('device'));
      const cfg=this.config(),project=cfg.bindings?.[payload.projectId??item.projectId];requireThat(project,'project_required');
      const grouped=new Map();for(const entry of item.targets){const target=cfg.targets[entry];if(!target?.home||!target?.binary){result.targets[entry]={status:'not_configured'};continue;}
       try{const home=await canonical(target.home);const group=grouped.get(home)??[];group.push({entry,target:{...target,home,project}});grouped.set(home,group);}catch(e){result.targets[entry]={status:'failed',error:publicError(e)};}}
      for(const group of grouped.values()){
       try{const first=group[0];const r=await this.importer.import(payload,first.target,{replace:item.action==='resolve',expectedHashes:local?.home===first.target.home?{[item.id]:item.expectedHash}:{}});
        for(const {entry,target}of group){
         // Shared storage is written once; different runtime versions are still checked.
         if(entry!==first.entry&&target.binary!==first.target.binary){await this.importer.native({binary:target.binary,home:target.home,project,files:payload.files,device:payload.device});}
         result.targets[entry]={status:r.status==='verified'?'verified':'imported',version:item.version,home:target.home,project,backup:r.backup,checkedAt:new Date().toISOString()};
        }
       }catch(e){for(const {entry}of group)result.targets[entry]??={status:'failed',error:publicError(e)};}
      }
      this.state.set('association/'+payload.logicalId,{projectId:payload.projectId,source:payload.source});
      const key='entries/'+this.scope()+'/'+item.id;this.state.set(key,{...this.state.get(key,{}),...result.targets});
      const values=Object.values(result.targets);result.status=values.every(x=>['verified','imported'].includes(x.status))?'downloaded':values.some(x=>['verified','imported'].includes(x.status))?'partial':'failed';
    }
   }catch(e){result.status='failed';result.error=publicError(e);}
   finally{this.state.set('job/'+job.id,job);this.onProgress({...job});}
  }
  if(job.status==='running')job.status=job.items.some(x=>['failed','partial','conflict','busy'].includes(x.status))?'attention':'completed';
  }finally{this.running=false;job.finishedAt=new Date().toISOString();this.state.set('job/'+job.id,job);this.onProgress({...job});}
  return job;
 }
}
