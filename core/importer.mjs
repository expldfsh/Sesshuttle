import {createBackup,restoreReview} from './manual-backups.mjs';
import {importBundle,recordBundle} from './import-bundle.mjs';
import {copyVerified,digestFile} from './stream.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
import { hash,inside,canonical,requireThat } from './util.mjs';
import { assertCodexClosed,prepareNative } from './native.mjs';
import {requireRuntime} from './runtime.mjs';
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
  for(const key of this.state.keys('entries/')){const entries=this.state.get(key);let changed=false;for(const r of Object.values(entries))if(r.home===home){r.status='restored_needs_validation';changed=true;}if(changed)this.state.set(key,entries);}
  for(const key of this.state.keys('import/')){const task=this.state.get(key);if(task.home===home&&['prepared','validating','needs_recovery'].includes(task.status))this.state.set(key,{...task,status:'restored'});}
  this.state.set('restore/'+backupId,{status:'restored'});return {status:'restored_needs_validation'};
 }
 async record(payload,home,project,binary,runtime,runtimeKey){return recordBundle(this,payload,home,project,binary,runtime,runtimeKey);}
 async import(payload,target,{replace=false,expectedHashes={},vault=null,acceptedMissingAttachments=[]}={}){
  requireThat(payload?.format===2,'legacy_format_unsupported');
  return importBundle(this,payload,target,{replace,expectedHashes,vault,acceptedMissingAttachments});
 }
}
