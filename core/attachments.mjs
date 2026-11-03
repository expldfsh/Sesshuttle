import fs from 'node:fs/promises';import path from 'node:path';import {constants} from 'node:fs';
import {records} from './stream.mjs';import {databaseRecords,openCatalog} from './catalog.mjs';import {imageType} from './codex.mjs';import {hash,inside,requireThat} from './util.mjs';
export function resourceReferences(value,resources=new Set(),issues=new Set()){
 if(!value||typeof value!=='object')return {resources,issues};
 if(['localImage','local_image'].includes(value.type)&&typeof value.path==='string')resources.add(value.path);
 if(['input_image','image'].includes(value.type)){const u=value.image_url??value.url;if(typeof u==='string'&&!u.startsWith('data:image/'))issues.add('external_image');}
 if(value.file_id||['input_audio','input_file'].includes(value.type))issues.add('remote_resource');
 for(const v of Object.values(value))if(typeof v==='object')resourceReferences(v,resources,issues);
 return {resources,issues};
}
export async function referencesFor(row,catalog=null,{ownership=false}={}){
 const resources=new Set(),issues=new Set();let owned;
 try{if(row.file)for await(const record of records(row.file))resourceReferences(record,resources,issues);
  if(row.database){catalog??=owned=await openCatalog(row.home);for(const record of databaseRecords(catalog,row.id)){if(typeof record.row.item_json==='string')resourceReferences(JSON.parse(record.row.item_json),resources,issues);if(ownership&&record.table==='thread_attachments'&&typeof record.row.payload==='string'){const visit=v=>{if(typeof v==='string'&&path.isAbsolute(v))resources.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))visit(x);};try{visit(JSON.parse(record.row.payload));}catch{throw new Error('Invalid attachment metadata');}}}}
  return {resources:[...resources],issues:[...issues]};
 }finally{owned?.close();}
}
export async function inspectAttachment(row,resource,approved=[]){
 const result={key:hash(row.id+'\0'+resource),sessionId:row.id,path:resource,bytes:0,status:'unreadable'};
 try{
  requireThat(path.isAbsolute(resource),'unsupported');const stat=await fs.lstat(resource);requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'unsafe');
  const resolved=await fs.realpath(resource);result.resolved=resolved;result.bytes=stat.size;result.stamp=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const handle=await fs.open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const bytes=Buffer.alloc(32);const read=await handle.read(bytes,0,bytes.length,0);result.ext=imageType(bytes.subarray(0,read.bytesRead));requireThat(result.ext,'unsupported');}finally{await handle.close();}
  let internal=false;for(const root of [row.home,row.project].filter(Boolean))try{await inside(root,resolved);internal=true;break;}catch{}
  result.external=!internal;result.status=internal||approved.includes(result.key)?'included':'approval_required';
 }catch(e){result.status=e.code==='ENOENT'?'missing':['unsafe','unsupported'].includes(e.code)?e.code:'unreadable';}
 return result;
}
export const attachmentIssue=status=>({approval_required:'attachment_approval',missing:'attachment_missing',unsupported:'attachment_unsupported',unsafe:'attachment_unsafe',unreadable:'attachment_unreadable'})[status];
export async function attachmentUnchanged(a){try{const s=await fs.lstat(a.path);return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&(await fs.realpath(a.path))===a.resolved&&[s.size,s.mtimeMs,s.ctimeMs].join(':')===a.stamp;}catch{return false;}}
