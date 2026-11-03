import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const LIMIT = 64 * 1024 * 1024;
export const id = () => randomUUID();
export const hash = x => createHash('sha256').update(x).digest('hex');
export class Fault extends Error { constructor(code, detail='') { super(code); this.code=code; this.detail=detail; } }
export const requireThat = (condition, code, detail='') => { if (!condition) throw new Fault(code,detail); };
export const exists = async p => { try { await fs.lstat(p); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } };
export async function canonical(p) { requireThat(typeof p==='string' && path.isAbsolute(p),'invalid_path'); return fs.realpath(p); }
export async function inside(root,p) {
  const base=await canonical(root); const target=path.resolve(p);
  requireThat(target!==base && target.startsWith(base+path.sep),'unsafe_path');
  let current=base;
  for(const part of path.relative(base,target).split(path.sep)) {
    current=path.join(current,part);
    try { const s=await fs.lstat(current); requireThat(!s.isSymbolicLink() && (!s.isFile()||s.nlink===1),'unsafe_path'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
  return target;
}
export async function stableRead(file,limit=LIMIT) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try { const before=await handle.stat(); requireThat(before.isFile() && before.size<=limit,'file_too_large');
    const data=await handle.readFile(); const after=await handle.stat();
    requireThat(before.size===after.size && before.mtimeMs===after.mtimeMs,'busy');
    return data;
  } finally { await handle.close(); }
}
export async function atomic(file,data) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.tmp-'+id(); const h=await fs.open(tmp,'wx',0o600);
  try { await h.writeFile(data); await h.sync(); } finally {await h.close();}
  await fs.rename(tmp,file);
}
export async function walk(root) {
  const files=[];
  async function visit(dir) { for(const e of await fs.readdir(dir,{withFileTypes:true})) {
    requireThat(!e.isSymbolicLink(),'unsafe_path'); const p=path.join(dir,e.name);
    if(e.isDirectory()) await visit(p); else if(e.isFile()) files.push(p); else throw new Fault('unsafe_path');
  }}
  if(await exists(root)) await visit(root);
  return files;
}
export function publicError(e) {
  const localCodes = {EACCES:'local_permission_denied',EPERM:'local_permission_denied',EROFS:'read_only_disk',ENOSPC:'disk_space',ENOENT:'local_path_missing',EBUSY:'local_in_use',SQLITE_BUSY:'local_in_use'};
  return {code:localCodes[e?.code]??(e?.code && /^[a-z_]+$/.test(e.code)?e.code:'operation_failed'),detail:e instanceof Fault?e.detail:''};
}
