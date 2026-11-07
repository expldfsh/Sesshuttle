import fs from 'node:fs/promises';
import path from 'node:path';
import {bundleBytes,materialize} from './bundle.mjs';
import {requireThat} from './util.mjs';

// The folder is chosen by the native picker. Stage privately on the same volume
// so a failed download never appears as a completed export.
export async function downloadCopy(vault,logical,version,folder){
  const head=await vault.head(logical);
  requireThat(head?.versions.some(v=>v.id===version),'cloud_version_missing');
  const payload=await vault.version(version);
  requireThat(payload.logicalId===logical,'corrupt_data');
  const disk=await fs.statfs(folder);
  requireThat(disk.bavail*disk.bsize>bundleBytes(payload)+256*1024*1024,'disk_space');
  const dest=await fs.mkdtemp(path.join(folder,'Sesshuttle-'));
  try{
    await materialize(payload,vault,dest);
    await fs.writeFile(path.join(dest,'history-manifest.json'),JSON.stringify(payload),{mode:0o600,flag:'wx'});
    return dest;
  }catch(e){await fs.rm(dest,{force:true,recursive:true});throw e;}
}
