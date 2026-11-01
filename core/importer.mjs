import fs from 'node:fs/promises';import path from 'node:path';
import { id,hash,stableRead,inside,canonical,atomic,walk,exists,requireThat,Fault,LIMIT } from './util.mjs';
import { validatePayload,parseRollout,scan,KNOWN_VERSIONS } from './codex.mjs';
import { assertCodexClosed,prepareNative,binaryVersion } from './native.mjs';
export class Importer {
 constructor(state,{testRoot=null,processGuard=assertCodexClosed,native=prepareNative}={}){this.state=state;this.testRoot=testRoot;this.processGuard=processGuard;this.native=native;}
 async guard(home){home=await canonical(home);if(this.testRoot)await inside(this.testRoot,path.join(home,'target-check'));await this.processGuard();return home;}
 async backup(home){const backupId=id(),root=path.join(this.state.root,'backups',backupId);await fs.mkdir(root,{recursive:true,mode:0o700});
  const files=[];for(const dir of ['sessions','archived_sessions'])files.push(...await walk(path.join(home,dir)));
  for(const e of await fs.readdir(home,{withFileTypes:true}))if(e.isFile()&&/^((state|thread_history)_\d+\.sqlite(?:-wal|-shm)?|session_index\.jsonl)$/.test(e.name))files.push(path.join(home,e.name));
  let total=0;const manifest=[];
  for(const file of files){await inside(home,file);const raw=await stableRead(file);total+=raw.length;requireThat(total<1024*1024*1024,'backup_too_large');const rel=path.relative(home,file);await atomic(path.join(root,'data',rel),raw);manifest.push({path:rel,hash:hash(raw)});}
  const info={id:backupId,home,createdAt:new Date().toISOString(),files:manifest,created:[],status:'ready'};await atomic(path.join(root,'manifest.json'),JSON.stringify(info));this.state.set('backup/'+backupId,info);return info;
 }
 async restore(backupId){const info=this.state.get('backup/'+backupId);requireThat(info,'backup_not_found');const home=await this.guard(info.home),root=path.join(this.state.root,'backups',backupId);const staged=[];
  for(const f of info.files){const target=await inside(home,path.join(home,f.path));const file=await inside(root,path.join(root,'data',f.path));const raw=await stableRead(file);requireThat(hash(raw)===f.hash,'corrupt_backup');staged.push({target,raw});}
  const safety=await this.backup(home);this.state.set('restore/'+backupId,{status:'prepared',safety:safety.id});
  // Preserve files created by the import outside the native discovery folders.
  for(const rel of info.created??[]){const file=await inside(home,path.join(home,rel));if(await exists(file)){const dest=path.join(this.state.root,'recovered',id(),path.basename(file));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(file,dest);}}
  const originals=new Set(info.files.map(f=>f.path));
  for(const e of await fs.readdir(home))if(/^(state|thread_history)_\d+\.sqlite(?:-wal|-shm)?$/.test(e)&&!originals.has(e)){
   const target=await inside(home,path.join(home,e));const dest=path.join(this.state.root,'recovered',id(),e);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(target,dest);
  }
  for(const {target,raw}of staged)await atomic(target,raw);
  this.state.set('restore/'+backupId,{status:'restored',safety:safety.id});return {status:'restored_needs_validation',safety:safety.id};
 }
 async import(payload,target,{replace=false,expectedHashes={}}={}){
  validatePayload(payload);requireThat(payload.files.every(f=>KNOWN_VERSIONS.includes(f.version)),'unknown_version');
  requireThat(!payload.issues?.length,'incomplete_history');const home=await this.guard(target.home);const project=await canonical(target.project);await binaryVersion(target.binary);
  const current=await scan([home]);requireThat(current.errors.length===0,'scan_incomplete');const writes=[];
  for(const f of payload.files){const parsed=parseRollout(Buffer.from(f.raw,'base64'));requireThat(parsed.issues.length===0&&!parsed.busy,'incomplete_history');
   const found=current.rows.filter(r=>r.id===f.id);requireThat(found.length<=1,'duplicate_identity');const old=found[0];
   if(expectedHashes[f.id]!==undefined)requireThat((old?.hash??null)===expectedHashes[f.id],'stale_plan');
   const raw=Buffer.from(f.raw,'base64');if(old?.hash===f.hash)continue;
   if(old&&!replace){const existing=await stableRead(old.file);requireThat(raw.subarray(0,existing.length).equals(existing),'conflict');}
   const date=new Date(parsed.meta.timestamp);requireThat(Number.isFinite(date.getTime()),'invalid_history');const iso=date.toISOString();const name=`rollout-${iso.slice(0,19).replaceAll(':','-')}-${f.id}.jsonl`;
   const file=old?.file??path.join(home,f.archived?'archived_sessions':'sessions',...(f.archived?[]:iso.slice(0,10).split('-')),name);
   await inside(home,file);writes.push({file,raw,created:!old,id:f.id,archived:f.archived});
  }
  if(!writes.length)return {status:'already_imported',backup:null};
  const backup=await this.backup(home);backup.created=writes.filter(w=>w.created).map(w=>path.relative(home,w.file));
  this.state.set('backup/'+backup.id,backup);await atomic(path.join(this.state.root,'backups',backup.id,'manifest.json'),JSON.stringify(backup));
  const taskId=id();this.state.set('import/'+taskId,{status:'prepared',backup:backup.id,home,ids:writes.map(w=>w.id)});
  try{
   await this.processGuard();
   const fresh=await scan([home]);for(const old of current.rows){const now=fresh.rows.find(x=>x.id===old.id);requireThat(now?.hash===old.hash,'stale_plan');}
   for(const w of writes)await atomic(w.file,w.raw);
   this.state.set('import/'+taskId,{status:'validating',backup:backup.id,home});
   await this.native({binary:target.binary,home,project,files:payload.files,device:payload.device});
   this.state.set('import/'+taskId,{status:'verified',backup:backup.id,home});
   return {status:'verified',backup:backup.id};
  }catch(e){this.state.set('import/'+taskId,{status:'needs_recovery',backup:backup.id,home,error:e.code??'operation_failed'});throw new Fault('import_needs_recovery',backup.id);}
 }
}
