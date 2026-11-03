import {readOmissionText} from './attachment-policy.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {constants} from 'node:fs';
import {records} from './stream.mjs';import {databaseRecords,openCatalog} from './catalog.mjs';import {imageType} from './codex.mjs';import {hash,inside,requireThat} from './util.mjs';
export function resourceReferences(value,resources=new Set(),issues=new Set(),omissions=new Map()){
 if(!value||typeof value!=='object')return {resources,issues,omissions};
 const omission=['text','input_text'].includes(value.type)?readOmissionText(value.text):null;if(omission)omissions.set(JSON.stringify(omission),omission);
 if(['localImage','local_image'].includes(value.type)&&typeof value.path==='string')resources.add(value.path);
 if(['input_image','image'].includes(value.type)){const u=value.image_url??value.url;if(typeof u==='string'&&!u.startsWith('data:image/'))issues.add('external_image');}
 if(value.file_id||['input_audio','input_file'].includes(value.type))issues.add('remote_resource');
 for(const v of Object.values(value))if(typeof v==='object')resourceReferences(v,resources,issues,omissions);
 return {resources,issues,omissions};
}
export async function referencesFor(row,catalog=null,{ownership=false}={}){
 const resources=new Set(),issues=new Set(),omissions=new Map();let owned;
 try{if(row.file)for await(const record of records(row.file))resourceReferences(record,resources,issues,omissions);
  if(row.database){catalog??=owned=await openCatalog(row.home);for(const record of databaseRecords(catalog,row.id)){if(typeof record.row.item_json==='string')resourceReferences(JSON.parse(record.row.item_json),resources,issues,omissions);if(ownership&&record.table==='thread_attachments'&&typeof record.row.payload==='string'){const visit=v=>{if(typeof v==='string'&&path.isAbsolute(v))resources.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))visit(x);};try{visit(JSON.parse(record.row.payload));}catch{throw new Error('Invalid attachment metadata');}}}}
  return {resources:[...resources],issues:[...issues],omittedAttachments:[...omissions.values()]};
 }finally{owned?.close();}
}
export async function inspectAttachment(row,resource,approved=[],replacement=null){
 const source=replacement||resource;
 const result={key:hash(row.id+'\0'+resource),sessionId:row.id,path:resource,bytes:0,status:'unreadable'};
 try{
  requireThat(path.isAbsolute(resource),'unsupported');const stat=await fs.lstat(source);requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'unsafe');
  const resolved=await fs.realpath(source);if(replacement)result.replacementPath=replacement;result.resolved=resolved;result.bytes=stat.size;result.stamp=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const handle=await fs.open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const bytes=Buffer.alloc(32);const read=await handle.read(bytes,0,bytes.length,0);result.ext=imageType(bytes.subarray(0,read.bytesRead));requireThat(result.ext,'unsupported');}finally{await handle.close();}
  let internal=false;for(const root of [row.home,row.project].filter(Boolean))try{await inside(root,resolved);internal=true;break;}catch{}
  result.external=!internal;result.status=replacement||internal||approved.includes(result.key)?'included':'approval_required';
 }catch(e){
  // A regular macOS screenshot in the OS capture directory is recognizable even
  // when opening its pixels is denied. Never waive arbitrary unreadable paths.
  const screenshot = result.stamp && /\/T\/(?:TemporaryItems\/NSIRD_screencaptureui_[^/]+\/Screenshot [^/]+\.png|codex-clipboard-[a-f\d-]+\.png)$/i.test(result.resolved??'') && /^\/(?:private\/)?var\/folders\//.test(result.resolved);
  if(!replacement && screenshot && ['EPERM','EACCES'].includes(e.code)){result.status='unreadable_image';result.readError=e.code;return result;}
  result.readError=String(e.code??'').slice(0,40);result.status=e.code==='ENOENT'?'missing':['unsafe','unsupported'].includes(e.code)?e.code:'unreadable';}
 return result;
}
export const attachmentIssue=status=>({approval_required:'attachment_approval',missing:'attachment_missing',unsupported:'attachment_unsupported',unsafe:'attachment_unsafe',unreadable:'attachment_unreadable',unreadable_image:'attachment_image_denied'})[status];
export async function attachmentUnchanged(a){try{const s=await fs.lstat(a.replacementPath??a.path);return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&(await fs.realpath(a.replacementPath??a.path))===a.resolved&&[s.size,s.mtimeMs,s.ctimeMs].join(':')===a.stamp;}catch{return false;}}
