import {importBundle,recordBundle} from './import-bundle.mjs';
import {copyVerified,digestFile} from './stream.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
import { id,hash,stableRead,inside,canonical,atomic,walk,exists,requireThat,Fault } from './util.mjs';
import { validatePayload,parseRollout,scan,KNOWN_VERSIONS,mapResources } from './codex.mjs';
import { assertCodexClosed,prepareNative,binaryVersion } from './native.mjs';
import { normalized,remember,receiptKey } from './receipts.mjs';
export class Importer {
 constructor(state,{testRoot=null,processGuard=assertCodexClosed,native=prepareNative}={}){this.state=state;this.testRoot=testRoot;this.processGuard=processGuard;this.native=native;}
 async guard(home,{allowTrashRecovery=false}={}){home=await canonical(home);requireThat(allowTrashRecovery||!this.state.keys('trash/').some(k=>{const t=this.state.get(k);return t?.home===home&&['prepared','removing','restoring','needs_recovery'].includes(t.status);}),'trash_recovery_required');if(this.testRoot)await inside(this.testRoot,path.join(home,'target-check'));await this.processGuard();return home;}
 async backup(home){const backupId=id(),root=path.join(this.state.root,'backups',backupId);await fs.mkdir(root,{recursive:true,mode:0o700});
  const files=[];for(const dir of ['sessions','archived_sessions','sesshuttle_assets'])files.push(...await walk(path.join(home,dir)));
  for(const e of await fs.readdir(home,{withFileTypes:true}))if(e.isFile()&&/^((state|thread_history)_\d+\.sqlite(?:-wal|-shm)?|session_index\.jsonl)$/.test(e.name))files.push(path.join(home,e.name));
  let total=0;const manifest=[];
  for(const file of files){await inside(home,file);const info=await digestFile(file);total+=info.bytes;const free=await fs.statfs(root);requireThat(free.bavail*free.bsize>info.bytes+256*1024*1024,'disk_space');const rel=path.relative(home,file);await copyVerified(file,path.join(root,'data',rel),info.hash);manifest.push({path:rel,hash:info.hash,bytes:info.bytes});}
  const info={id:backupId,home,createdAt:new Date().toISOString(),files:manifest,created:[],status:'ready'};await atomic(path.join(root,'manifest.json'),JSON.stringify(info));this.state.set('backup/'+backupId,info);return info;
 }
 async restore(backupId){const info=this.state.get('backup/'+backupId);requireThat(info,'backup_not_found');const home=await this.guard(info.home),root=path.join(this.state.root,'backups',backupId);const staged=[];
  for(const f of info.files){const target=await inside(home,path.join(home,f.path));const file=await inside(root,path.join(root,'data',f.path));requireThat((await digestFile(file)).hash===f.hash,'corrupt_backup');staged.push({target,file,hash:f.hash});}
  const safety=await this.backup(home);this.state.set('restore/'+backupId,{status:'prepared',safety:safety.id});await this.processGuard();
  const originals=new Set(info.files.map(f=>f.path));
  // Preserve new records and attachments outside Codex discovery before restoring its index.
  const current=[];for(const dir of ['sessions','archived_sessions','sesshuttle_assets'])current.push(...await walk(path.join(home,dir)));
  for(const e of await fs.readdir(home))if(/^((state|thread_history)_\d+\.sqlite(?:-wal|-shm)?|session_index\.jsonl)$/.test(e))current.push(path.join(home,e));
  for(const file of current){const rel=path.relative(home,file);if(!originals.has(rel)){await inside(home,file);const dest=path.join(this.state.root,'recovered',safety.id,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(file,dest);}}
  for(const {target,file,hash:expected}of staged)await copyVerified(file,target,expected);
  for(const key of this.state.keys('bundle-receipt/'+hash(home)+'/'))this.state.set(key,null);
  for(const key of this.state.keys('receipt/'+hash(home)+'/'))this.state.set(key,null);
  for(const key of this.state.keys('entries/')){const entries=this.state.get(key);let changed=false;for(const r of Object.values(entries))if(r.home===home){r.status='restored_needs_validation';changed=true;}if(changed)this.state.set(key,entries);}
  for(const key of this.state.keys('import/')){const task=this.state.get(key);if(task.home===home&&['prepared','validating','needs_recovery'].includes(task.status))this.state.set(key,{...task,status:'restored'});}
  this.state.set('restore/'+backupId,{status:'restored',safety:safety.id});return {status:'restored_needs_validation',safety:safety.id};
 }
 async record(payload,home,project,binary,runtime){if(payload.format===2)return recordBundle(this,payload,home,project,binary,runtime);const rows=(await scan([home])).rows;await remember(this.state,payload,rows,home,project);for(const f of payload.files){const key=receiptKey(home,f.id),r=this.state.get(key);if(r)this.state.set(key,{...r,binary,runtime});}}
 async import(payload,target,{replace=false,expectedHashes={},vault=null,acceptedMissingAttachments=[]}={}){
  if(payload?.format===2)return importBundle(this,payload,target,{replace,expectedHashes,vault,acceptedMissingAttachments});
  validatePayload(payload);requireThat(payload.files.every(f=>KNOWN_VERSIONS.includes(f.version)),'unknown_version');
  requireThat(!payload.issues?.length,'incomplete_history');const home=await this.guard(target.home);const project=await canonical(target.project);const runtime=await binaryVersion(target.binary);
  requireThat(!this.state.keys('import/').some(k=>{const t=this.state.get(k);return t.home===home&&['prepared','validating','needs_recovery'].includes(t.status); }),'recovery_required');
  const current=await scan([home]);requireThat(current.errors.length===0,'scan_incomplete');const writes=[],nativeFiles=[];let allVerified=true;
  for(const f of payload.files){const original=Buffer.from(f.raw,'base64'),parsed=parseRollout(original);requireThat(parsed.issues.length===0&&!parsed.busy,'incomplete_history');requireThat(parsed.resources.every(p=>(payload.assets??[]).some(a=>a.path===p)),'incomplete_history');
   const found=current.rows.filter(r=>r.id===f.id);requireThat(found.length<=1,'duplicate_identity');const old=found[0];nativeFiles.push({...f,placementArchived:old?.archived??f.archived});
   if(expectedHashes[f.id]!==undefined)requireThat((old?.hash??null)===expectedHashes[f.id],'stale_plan');
   const receipt=this.state.get(receiptKey(home,f.id));const existing=old?normalized(this.state,old,await stableRead(old.file)).raw:null;
   if(existing?.equals(original)&&old.archived===f.archived){allVerified&&=!!receipt&&receipt.hash===old.hash&&receipt.project===project&&receipt.binary===target.binary&&receipt.runtime===runtime;continue;}
   allVerified=false;if(old&&!replace)requireThat(original.subarray(0,existing.length).equals(existing),'conflict');
   const date=new Date(parsed.meta.timestamp);requireThat(Number.isFinite(date.getTime()),'invalid_history');const iso=date.toISOString();const name=`rollout-${iso.slice(0,19).replaceAll(':','-')}-${f.id}.jsonl`;
   const file=old?.file??path.join(home,f.archived?'archived_sessions':'sessions',...(f.archived?[]:iso.slice(0,10).split('-')),name);
   await inside(home,file);writes.push({file,raw:mapResources(original,payload.assets??[],home),created:!old,id:f.id});
  }
  if(allVerified)return {status:'verified',backup:null,unchanged:true,runtime};
  for(const asset of payload.assets??[]){const file=await inside(home,path.join(home,'sesshuttle_assets',asset.hash+'.'+asset.ext));if(await exists(file)){requireThat(hash(await stableRead(file))===asset.hash,'corrupt_data');}else writes.push({file,raw:Buffer.from(asset.data,'base64'),created:true});}
  const backup=await this.backup(home);backup.created=writes.filter(w=>w.created).map(w=>path.relative(home,w.file));this.state.set('backup/'+backup.id,backup);await atomic(path.join(this.state.root,'backups',backup.id,'manifest.json'),JSON.stringify(backup));
  const taskId=id();this.state.set('import/'+taskId,{status:'prepared',backup:backup.id,home});
  try{
   await this.processGuard();const fresh=await scan([home]);requireThat(fresh.errors.length===0&&fresh.rows.length===current.rows.length,'stale_plan');
   for(const old of current.rows){const now=fresh.rows.find(x=>x.file===old.file);requireThat(now?.hash===old.hash,'stale_plan');}
   for(const w of writes){await inside(home,w.file);if(w.created)requireThat(!await exists(w.file),'stale_plan');await atomic(w.file,w.raw);}
   this.state.set('import/'+taskId,{status:'validating',backup:backup.id,home});
   await this.native({binary:target.binary,home,project,files:nativeFiles,device:payload.device});await this.record(payload,home,project,target.binary,runtime);
   this.state.set('import/'+taskId,{status:'verified',backup:backup.id,home});return {status:'verified',backup:backup.id,runtime};
  }catch(e){this.state.set('import/'+taskId,{status:'needs_recovery',backup:backup.id,home,error:e.code??'operation_failed'});throw new Fault('import_needs_recovery',backup.id);}
 }
}
