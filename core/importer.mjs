import {createBackup,restoreReview} from './manual-backups.mjs';
import {checkScope,checkUnchanged} from './scan-scope.mjs';
import {checkLocalProject} from './local-projects.mjs';
import {importBundle,recordBundle} from './import-bundle.mjs';
import {copyVerified,digestFile} from './stream.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
import { id,hash,stableRead,inside,canonical,atomic,exists,requireThat } from './util.mjs';
import { validatePayload,parseRollout,scan,mapResources } from './codex.mjs';
import { assertCodexClosed,prepareNative,checkSourceProviders } from './native.mjs';
import {requireRuntime,receiptMatchesRuntime} from './runtime.mjs';
import { normalized,remember,receiptKey } from './receipts.mjs';
export class Importer {
 constructor(state,{testRoot=null,processGuard=assertCodexClosed,native=prepareNative,authorize=binary=>requireRuntime(binary,state),fixture}={}){this.state=state;this.testRoot=testRoot;this.processGuard=processGuard;this.authorize=authorize;this.fixture=fixture;this.native=options=>native({...options,authorize,fixture});}
 async guard(home,{allowTrashRecovery=false,restoreId=null,checkProcess=true}={}){home=await canonical(home);requireThat(allowTrashRecovery||!this.state.keys('trash/').some(k=>{const t=this.state.get(k);return t?.home===home&&['prepared','removing','restoring','needs_recovery'].includes(t.status);}),'trash_recovery_required');requireThat(!this.state.keys('restore/').some(k=>this.state.get(k)?.status==='prepared'&&this.state.get('backup/'+k.slice(8))?.home===home&&k!=='restore/'+restoreId),'restore_pending');if(this.testRoot)await inside(this.testRoot,path.join(home,'target-check'));if(checkProcess)await this.processGuard(home);return home;}
 async backup(home){return createBackup(this,home);}
 async restore(backupId,reviewToken){const info=this.state.get('backup/'+backupId);requireThat(info,'backup_not_found');const home=await this.guard(info.home,{restoreId:backupId}),root=path.join(this.state.root,'backups',backupId);const staged=[];
  for(const f of info.files){const target=await inside(home,path.join(home,f.path));const file=await inside(root,path.join(root,'data',f.path));requireThat((await digestFile(file)).hash===f.hash,'corrupt_backup');staged.push({target,file,hash:f.hash});}
  await this.processGuard(home);
  const review=await restoreReview(info);requireThat(review.token===reviewToken,'stale_plan');
  this.state.set('restore/'+backupId,{status:'prepared'});
  for(const {target,file,hash:expected}of staged)await copyVerified(file,target,expected);
  for(const rel of review.remove)await fs.unlink(await inside(home,path.join(home,rel)));
  for(const key of this.state.keys('bundle-receipt/'+hash(home)+'/'))this.state.set(key,null);
  for(const key of this.state.keys('receipt/'+hash(home)+'/'))this.state.set(key,null);
  for(const key of this.state.keys('entries/')){const entries=this.state.get(key);let changed=false;for(const r of Object.values(entries))if(r.home===home){r.status='restored_needs_validation';changed=true;}if(changed)this.state.set(key,entries);}
  for(const key of this.state.keys('import/')){const task=this.state.get(key);if(task.home===home&&['prepared','validating','needs_recovery'].includes(task.status))this.state.set(key,{...task,status:'restored'});}
  this.state.set('restore/'+backupId,{status:'restored'});return {status:'restored_needs_validation'};
 }
 async record(payload,home,project,binary,runtime,runtimeKey){if(payload.format===2)return recordBundle(this,payload,home,project,binary,runtime,runtimeKey);const rows=(await scan([home])).rows;await remember(this.state,payload,rows,home,project);for(const f of payload.files){const key=receiptKey(home,f.id),r=this.state.get(key);if(r)this.state.set(key,{...r,binary,runtime,runtimeKey});}}
 async import(payload,target,{replace=false,expectedHashes={},vault=null,acceptedMissingAttachments=[]}={}){
  if(payload?.format===2)return importBundle(this,payload,target,{replace,expectedHashes,vault,acceptedMissingAttachments});
  validatePayload(payload);
  requireThat(!(payload.issues??[]).some(issue=>issue!=='unknown_version'),'incomplete_history');const home=await this.guard(target.home);const project=await canonical(target.project);const identity=await this.authorize(target.binary),runtime=identity.version;
  requireThat(!this.state.keys('import/').some(k=>{const t=this.state.get(k);return t.home===home&&['prepared','validating','needs_recovery'].includes(t.status); }),'recovery_required');
  const nativeProjectName=await checkLocalProject(home,target.nativeProjectId,identity.projects);
  const current=await scan([home]);checkScope(current,payload.files.map(f=>f.id),{allowUnrelatedFileErrors:true});const writes=[],nativeFiles=[];let allVerified=true;
  for(const f of payload.files){const original=Buffer.from(f.raw,'base64'),parsed=parseRollout(original);requireThat(parsed.issues.length===0&&!parsed.busy,'incomplete_history');requireThat(parsed.resources.every(p=>(payload.assets??[]).some(a=>a.path===p)),'incomplete_history');
   const found=current.rows.filter(r=>r.id===f.id);requireThat(found.length<=1,'duplicate_identity');const old=found[0];nativeFiles.push({...f,sourceProvider:parsed.meta.model_provider,placementArchived:old?.archived??f.archived});
   requireThat(!old?.busy,'busy',f.id);if(expectedHashes[f.id]!==undefined)requireThat((old?.hash??null)===expectedHashes[f.id],'stale_plan');
   const receipt=this.state.get(receiptKey(home,f.id));const existing=old?normalized(this.state,old,await stableRead(old.file)).raw:null;
   if(existing?.equals(original)&&old.archived===f.archived){allVerified&&=(!target.nativeProjectId || f.id!==payload.logicalId || (old?.originProject?.match==='id' && old.originProject.nativeId===target.nativeProjectId))&&!!receipt&&receipt.hash===old.hash&&receipt.project===project&&receipt.binary===target.binary&&receiptMatchesRuntime(receipt,identity);continue;}
   allVerified=false;if(old&&!replace)requireThat(original.subarray(0,existing.length).equals(existing),'conflict');
   const date=new Date(parsed.meta.timestamp);requireThat(Number.isFinite(date.getTime()),'invalid_history');const iso=date.toISOString();const name=`rollout-${iso.slice(0,19).replaceAll(':','-')}-${f.id}.jsonl`;
   const file=old?.file??path.join(home,f.archived?'archived_sessions':'sessions',...(f.archived?[]:iso.slice(0,10).split('-')),name);
   await inside(home,file);writes.push({file,raw:mapResources(original,payload.assets??[],home),created:!old,id:f.id});
  }
  if(allVerified)return {status:'verified',nativeProjectName,backup:null,unchanged:true,runtime};
  for(const asset of payload.assets??[]){const file=await inside(home,path.join(home,'sesshuttle_assets',asset.hash+'.'+asset.ext));if(await exists(file)){requireThat(hash(await stableRead(file))===asset.hash,'corrupt_data');}else writes.push({file,raw:Buffer.from(asset.data,'base64'),created:true});}
  await checkSourceProviders(identity,home,project,nativeFiles,this.fixture);
  await this.processGuard(home);checkUnchanged(current,await scan([home]),payload.files.map(f=>f.id));
  requireThat((await this.authorize(target.binary)).key===identity.key,'runtime_changed');
  const taskId=id();this.state.set('import/'+taskId,{status:'prepared',backup:null,home});
  try{
   target.onStage?.('stageWrite');for(const w of writes){await inside(home,w.file);if(w.created)requireThat(!await exists(w.file),'stale_plan');await atomic(w.file,w.raw);}
   this.state.set('import/'+taskId,{status:'validating',backup:null,home});
   target.onStage?.('stageVerify');await this.native({expectedKey:identity.key,binary:target.binary,home,project,files:nativeFiles,logicalId:payload.logicalId,nativeProjectId:target.nativeProjectId});await this.record(payload,home,project,target.binary,runtime,identity.key);
   this.state.set('import/'+taskId,{status:'verified',backup:null,home});return {status:'verified',nativeProjectName,backup:null,runtime};
  }catch(e){this.state.set('import/'+taskId,{status:'failed',backup:null,home,error:e.code??'operation_failed'});throw e;}
 }
}
