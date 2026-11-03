import fs from 'node:fs/promises';
import {scan} from './codex.mjs';
import {Trash} from './trash.mjs';
import {cloudRemovalPlan,changeCloud,cloudBins} from './cloud-trash.mjs';
import {id,hash,canonical,requireThat,publicError} from './util.mjs';

const uuid=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/i.test(s);
const unique=a=>[...new Set(a)];
const localScope=s=>s==='local'||s==='both';
const cloudScope=s=>s==='cloud'||s==='both';
const localFingerprint=p=>hash(JSON.stringify([p.home,p.signature,p.ids,p.blockers,p.files.map(f=>[f.path,f.hash]),p.assets.map(a=>[a.path,a.disposition])]));
const binFingerprint=i=>hash(JSON.stringify([i.id,i.home,i.rows,i.files,i.database,i.status]));
function cleanRequest(input){
  const {scope,mode,ids,kind='live',binId=null,versions={},includeDependents=false}=input;
  requireThat(['local','cloud','both'].includes(scope)&&['live','bin'].includes(kind),'invalid_selection');
  requireThat(kind==='live'?['trash','purge'].includes(mode):scope!=='both'&&uuid(binId)&&['purge','restore'].includes(mode),'invalid_selection');
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=2000&&ids.every(uuid)&&typeof includeDependents==='boolean','invalid_selection');
  return {scope,mode,kind,ids:unique(ids),binId,versions,includeDependents};
}
function cloudRequest(q,groups=[]){return {ids:q.ids,inspectIds:unique(groups.flatMap(g=>g.ids)),action:q.kind==='bin'&&q.mode==='purge'?'purgeBin':q.mode,binId:q.binId,versions:q.versions};}
export class Removals{
  constructor(engine,trash,{onProgress=()=>{}}={}){
    this.engine=engine;this.trash=trash;this.state=engine.state;this.onProgress=onProgress;this.plans=new Map();
  }
  storageKey(){const v=this.engine.vault;return v?hash(JSON.stringify([v.store.endpoint??null,v.store.bucket??null,v.space])):null;}
  jobs(){return this.state.keys('removal/').map(k=>this.state.get(k)).filter(Boolean).map(j=>['checking','running'].includes(j.status)&&this.activeId!==j.id?{...j,status:'interrupted'}:j).sort((a,b)=>b.at.localeCompare(a.at));}
  async bins(){
    let cloud={bins:[],pending:null},cloudError=null;
    if(this.engine.vault)try{cloud=await cloudBins(this.engine.vault);}catch(e){cloudError=publicError(e);}
    return {local:this.trash.list().filter(t=>t.status!=='staging'),cloud,cloudError,jobs:this.jobs()};
  }
  async homes(){
    const cfg=this.engine.config(),out=new Set();
    for(const p of unique([...cfg.sourceHomes,...Object.values(cfg.targets??{}).map(t=>t.home)].filter(Boolean))){
      try{out.add(await canonical(p));}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    return [...out];
  }
  async preview(input,onlyHomes=null){
    const q=cleanRequest(input),vault=this.engine.vault,config=this.engine.config(),local=[],homeList=localScope(q.scope)&&q.kind==='live'?await this.homes():[];
    const sources=this.engine.rows??[],selected=sources.filter(r=>q.ids.includes(r.id));
    if(q.kind==='live')requireThat(q.ids.every(tid=>selected.some(r=>r.id===tid)),'stale_plan');
    const record=q.kind==='bin'&&q.scope==='local'?this.state.get('trash/'+q.binId):null;
    if(q.scope==='local'&&q.kind==='bin'){
      requireThat(record&&q.ids.length===record.ids.length&&record.ids.every(tid=>q.ids.includes(tid)),'backup_not_found');
      requireThat(q.mode==='restore'?['prepared','removed','removing','restoring','needs_recovery'].includes(record.status):['removed','restored','purging'].includes(record.status),'trash_recovery_required');
      local.push({binPath:this.state.root+'/trash/'+record.id,token:q.binId,home:record.home,ids:record.ids,rows:record.rows,files:record.files,assets:record.assets,bytes:record.files.reduce((n,f)=>n+f.bytes,0)+record.database.bytes,blockers:[],fingerprint:binFingerprint(record)});
    }
    for(const home of homeList){
      if(onlyHomes&&!onlyHomes.includes(home))continue;
      const result=await scan([home]);requireThat(!result.errors.length,'scan_incomplete');
      const ids=q.ids.filter(tid=>result.rows.some(r=>r.id===tid));if(!ids.length)continue;
      const p=await new Trash(this.state,this.engine.importer).preview([home],{ids,includeDependents:q.includeDependents},{ownershipHomes:homeList,snapshot:result});
      const entries=[];
      for(const [entry,t] of Object.entries(config.targets??{}))if(t.home&&await canonical(t.home).catch(()=>null)===home)entries.push(entry);
      local.push({...p,entries,fingerprint:localFingerprint(p)});
    }
    const localIds=unique([...q.ids,...local.flatMap(g=>g.ids)]),retained=[];
    for(const t of this.trash.list())if(t.id!==record?.id&&t.ids.some(tid=>localIds.includes(tid)))
      retained.push({place:'localBin',id:t.id,home:t.home,at:t.createdAt,title:t.rows.map(r=>r.title).join(' · ')});
    for(const k of this.state.keys('backup/')){const b=this.state.get(k);if(b)retained.push({place:'wholeBackup',id:b.id,home:b.home,at:b.createdAt});}
    let cloud=null,cloudError=null;
    if(cloudScope(q.scope)){
      requireThat(vault,'storage_not_connected');cloud=(await cloudRemovalPlan(vault,cloudRequest(q,local))).preview;
    }else if(vault){
      try{const preserved=await cloudRemovalPlan(vault,{action:'trash',ids:localIds,versions:Object.fromEntries(localIds.map(tid=>[tid,[]]))});retained.push(...preserved.preview.retained);}
      catch(e){cloudError=publicError(e);}
    }
    if(cloud)retained.push(...cloud.retained);
    const token=id(),plan={token,q,local,cloud,retained,cloudError,space:vault?.space??null,
      storageKey:this.storageKey(),bucket:vault?.store.bucket??this.state.get('connection')?.bucket,device:this.state.get('device').name,
      configHash:hash(JSON.stringify(config)),homeList,
      selected:selected.map(r=>({id:r.id,title:r.title,local:r.local,remote:r.remote,project:r.originProject?.name??r.project})),
      cloudChecked:!!vault&&!cloudError};
    this.plans.clear();this.plans.set(token,plan);return plan;
  }
  async localTicket(g,plan){
    const q=plan.q,importer=this.engine.importer;
    if(q.kind==='bin'){
      const current=this.state.get('trash/'+q.binId);
      requireThat(current&&binFingerprint(current)===g.fingerprint,'stale_plan');
      if(q.mode==='restore')await importer.guard(g.home,{allowTrashRecovery:true});
      return;
    }
    await importer.guard(g.home);
    const worker=new Trash(this.state,importer);
    const p=await worker.preview([g.home],{ids:g.requestedIds,includeDependents:q.includeDependents},
      {ownershipHomes:plan.homeList,reserveAssets:g.assets.filter(a=>a.disposition==='shared').map(a=>a.path)});
    requireThat(!p.blockers.length,'trash_dependencies');requireThat(localFingerprint(p)===g.fingerprint,'stale_plan');
    const disk=await fs.statfs(this.state.root);
    requireThat(disk.bavail*disk.bsize>g.bytes+g.rows.reduce((n,r)=>n+r.bytes,0)+256*1024*1024,'disk_space');
    worker.plans.clear();worker.plans.set(g.token,{...p,token:g.token});return worker;
  }
  async execute(token,{permanent=false,upgrade=false}={}){
    const plan=this.plans.get(token)??this.state.get('removal-plan/'+token);
    requireThat(plan&&uuid(token)&&!this.engine.running,'stale_plan');
    const {q}=plan;
    requireThat(q.mode!=='purge'||permanent===true,'permanent_confirmation');

    requireThat(!cloudScope(q.scope)||this.storageKey()===plan.storageKey,'space_changed');
    requireThat(plan.local.length||plan.cloud?.count,'nothing_to_remove');
    requireThat(plan.local.every(p=>!p.blockers.length),'trash_dependencies');
    let job=this.state.get('removal/'+token);
    requireThat(!plan.cloud?.upgrade||!plan.cloud?.count||job?.upgradeAccepted||job?.sides.some(s=>s.side==='cloud'&&s.status==='done')||upgrade===true,'cloud_upgrade_required');
    requireThat(!job||job.status!=='completed','stale_plan');
    job??={id:token,at:new Date().toISOString(),scope:q.scope,mode:q.mode,kind:q.kind,space:plan.space,
      titles:unique([...plan.selected.map(r=>r.title),...plan.local.flatMap(p=>p.rows.map(r=>r.title)),...(plan.cloud?.items??[]).map(r=>r.title)]),
      sides:[...(plan.cloud?.count?[{side:'cloud',status:'waiting',count:plan.cloud.count}]:[]),...plan.local.map(g=>({side:'local',home:g.home,token:g.token,status:'waiting',count:g.rows.length}))]};
    job.upgradeAccepted=!!(job.upgradeAccepted||upgrade);
    this.state.set('removal-plan/'+token,plan);this.plans.delete(token);this.engine.running=true;this.activeId=token;
    const tickets=new Map();
    const save=()=>{this.state.set('removal/'+token,job);this.onProgress(job);};
    let current;
    try{
      job.status='checking';delete job.error;save();
      if(plan.replaces){const prior=this.state.get('removal/'+plan.replaces);if(prior){prior.status='replaced';this.state.set('removal/'+prior.id,prior);this.state.set('removal-plan/'+prior.id,null);}}
      for(const side of job.sides){
        if(side.status==='done')continue;
        current=side;delete side.error;
        if(side.side==='cloud'){
          const marker=await this.engine.vault.open();
          if(marker.completed?.includes(token)){side.status='done';continue;}
          if(marker.pending?.id!==token){const fresh=await cloudRemovalPlan(this.engine.vault,cloudRequest(q,plan.local));requireThat(fresh.preview.signature===plan.cloud.signature,'stale_plan');}
        }else{
          const saved=this.state.get('trash/'+side.token),g=plan.local.find(p=>p.token===side.token);
          if(side.started&&q.kind==='live'&&saved){
            if(q.mode==='purge'&&['removed','purging'].includes(saved.status))continue;
            if(saved.status==='removed'&&q.mode==='trash'){side.status='done';continue;}
            if(saved.status==='staging')await this.trash.clearStaging(side.token);
            else requireThat(false,saved.status==='restored'?'stale_plan':'trash_recovery_required');
          }
          if(side.started&&q.mode==='purge'&&!saved&&side.erasing){side.status='done';continue;}
          if(q.kind==='bin'&&side.started&&saved?.status==='restored'&&q.mode==='restore'){side.status='done';continue;}
          if(q.kind==='bin'&&side.started&&saved?.status==='purging'&&q.mode==='purge')continue;
          requireThat(hash(JSON.stringify(this.engine.config()))===plan.configHash,'stale_plan');
          tickets.set(g.token,await this.localTicket(g,plan));
        }
      }
      for(const side of job.sides){
        if(side.status==='done')continue;current=side;side.started=true;side.status='running';job.status='running';save();
        if(side.side==='cloud')await changeCloud(this.engine.vault,cloudRequest(q,plan.local),plan.cloud.signature,token,{upgrade:job.upgradeAccepted,progress:(n,total)=>{side.progress=[n,total];this.onProgress(job);}});
        else{
          const g=plan.local.find(p=>p.token===side.token);
          if(q.kind==='bin'&&q.mode==='restore')await this.trash.restore(g.token);
          else{
            if(q.kind==='live'&&!this.state.get('trash/'+g.token)){await tickets.get(g.token).remove(g.token);}
            if(q.mode==='purge'){side.erasing=true;save();await this.trash.purge(g.token);}
          }
        }
        side.status='done';delete side.error;save();
      }
      job.status='completed';this.state.set('removal-plan/'+token,null);
    }catch(e){
      const error=publicError(e);
      if(current){
        current.status='failed';current.error=error;
        if(current.side==='cloud'&&current.started){
          const marker=await this.engine.vault.open().catch(()=>null);
          if(marker?.pending?.id===token)current.status='cleanup';
          else if(marker?.completed?.includes(token)){current.status='done';delete current.error;}
        }
      }
      job.error=error;job.status=job.sides.some(s=>['done','cleanup'].includes(s.status))?'partial':'attention';
    }
    finally{this.engine.running=false;this.activeId=null;save();}
    return job;
  }
  retryPlan(token){const plan=this.state.get('removal-plan/'+token),job=this.state.get('removal/'+token);requireThat(plan&&job,'stale_plan');return {...plan,previous:job};}
  async revise(token){
    const plan=this.retryPlan(token),job=plan.previous,remaining=job.sides.filter(s=>s.status!=='done');
    requireThat(remaining.length,'nothing_to_remove');
    if(remaining.some(s=>s.side==='cloud')){
      requireThat(this.storageKey()===plan.storageKey,'space_changed');
      const marker=await this.engine.vault.open();requireThat(marker.pending?.id!==token&&!marker.completed?.includes(token),'resume_original_plan');
    }
    for(const s of remaining.filter(s=>s.side==='local'&&s.started))if(plan.q.kind==='live')requireThat(!this.state.get('trash/'+s.token)||this.state.get('trash/'+s.token).status==='restored','resume_original_plan');
    const sides=unique(remaining.map(s=>s.side));
    const homes=remaining.filter(s=>s.side==='local').map(s=>s.home);
    const ids=unique([...plan.local.filter(g=>homes.includes(g.home)).flatMap(g=>g.requestedIds??g.ids),...(sides.includes('cloud')?plan.cloud.items.filter(i=>i.versions.some(v=>v.selected)).map(i=>i.id):[])]);
    const versions=Object.fromEntries(Object.entries(plan.q.versions).filter(([k])=>ids.includes(k)));
    const next=await this.preview({...plan.q,ids,versions,scope:sides.length===2?'both':sides[0]},homes);
    next.replaces=token;return next;
  }
}
