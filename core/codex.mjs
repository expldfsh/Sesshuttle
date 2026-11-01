import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, stableRead, walk, Fault, requireThat, exists, LIMIT } from './util.mjs';
export const KNOWN_VERSIONS=['0.164.0','0.164.0-alpha.11.1','0.166.0-alpha.5.1'];
export function sourceOf(meta){
 if(typeof meta.source==='object'&&meta.source?.subagent) return 'subagent';
 if(['codex_work_desktop','codex_desktop'].includes(meta.originator))return 'desktop';
 if(meta.source==='cli'||meta.source==='exec')return 'cli';
 if(meta.source==='vscode'&&['codex_vscode','codex_ide'].includes(meta.originator))return 'ide';
 return 'unknown';
}
export function parseRollout(raw) {
 requireThat(raw.length<=LIMIT&&raw.length>0,'file_too_large');
 requireThat(raw.at(-1)===10,'busy');
 let records;try{records=raw.toString('utf8').trimEnd().split('\n').map(x=>JSON.parse(x));}catch{throw new Fault('invalid_history');}
 const meta=records[0]?.payload;
 requireThat(records[0]?.type==='session_meta'&&typeof meta?.id==='string'&&/^[0-9a-f-]{36}$/i.test(meta.id),'invalid_history');
 const messages=[],seen=new Set(),issues=[],resources=[],active=new Set();
 function inspect(v){if(!v||typeof v!=='object')return;
   if(['input_image','image'].includes(v.type)) { const url=v.image_url??v.url;
     if(typeof url==='string'&&!url.startsWith('data:image/')) issues.push('external_image');
     if(v.file_id)issues.push('remote_resource');
   }
   if(['localImage','local_image'].includes(v.type)&&typeof v.path==='string')resources.push(v.path);
   if(['input_audio','input_file'].includes(v.type)||v.file_id)issues.push('remote_resource');
   for(const item of Object.values(v))if(typeof item==='object')inspect(item);
 }
 for(const r of records){
  const p=r.payload;
  if(r.type==='event_msg') {
   if(['task_started','turn_started'].includes(p.type))active.add(p.turn_id??'turn');
   if(['task_complete','turn_complete','turn_aborted'].includes(p.type))active.delete(p.turn_id??'turn');
   const item=p.item;const type=item?.type?.toLowerCase();
   if(item&&['usermessage','agentmessage','commandexecution'].includes(type)&&!seen.has(item.id)){
     seen.add(item.id);const text=type==='commandexecution'?(item.aggregated_output??item.aggregatedOutput??''):(item.text??item.content?.map(c=>c.text??'').join('\n')??'');
     messages.push({role:type==='usermessage'?'user':type==='agentmessage'?'assistant':'tool',text:text.slice(0,12000),id:item.id});
   }
   if(p.type==='user_message'&&typeof p.message==='string')messages.push({role:'user',text:p.message.slice(0,12000)});
   if(p.type==='agent_message'&&typeof p.message==='string')messages.push({role:'assistant',text:p.message.slice(0,12000)});
  }
  inspect(p);
 }
 if(!messages.length) for(const r of records)if(r.type==='response_item'&&r.payload?.type==='message'&&['user','assistant'].includes(r.payload.role)){
  const text=r.payload.content?.map(c=>c.text??'').join('\n')??'';
  if(text&&!/^<environment_context>|^# AGENTS.md|^<permissions/.test(text))messages.push({role:r.payload.role,text:text.slice(0,12000)});
 }
 if(resources.length)issues.push('external_attachment');
 if(!KNOWN_VERSIONS.includes(meta.cli_version))issues.push('unknown_version');
 return {meta,records,messages,issues:[...new Set(issues)],resources:[...new Set(resources)],busy:active.size>0};
}
export async function scan(homes) {
 const rows=[],errors=[],seen=new Map();
 for(const configured of homes){
  try {
   const home=await fs.realpath(configured);
   for(const folder of ['sessions','archived_sessions']) {
    let files;try{files=await walk(path.join(home,folder));}catch(e){errors.push({home,code:e.code??'scan_failed'});continue;}
    for(const file of files.filter(p=>p.endsWith('.jsonl'))){
     try {const raw=await stableRead(file),parsed=parseRollout(raw),stat=await fs.stat(file);const fingerprint=hash(raw);
       const duplicate=seen.get(parsed.meta.id);
       if(duplicate&&duplicate.hash===fingerprint){duplicate.homes.push(home);continue;}
       const row={id:parsed.meta.id,key:hash(home+'\0'+parsed.meta.id),file,home,homes:[home],hash:fingerprint,
        source:sourceOf(parsed.meta),title:parsed.messages.find(x=>x.role==='user')?.text.slice(0,140)||parsed.meta.id,
        project:parsed.meta.cwd??'',parent:parsed.meta.parent_thread_id??null,version:parsed.meta.cli_version??'unknown',
        updatedAt:stat.mtime.toISOString(),bytes:raw.length,archived:folder==='archived_sessions',
        issues:parsed.issues,busy:parsed.busy,messages:parsed.messages.slice(-100),totalMessages:parsed.messages.length};
       if(duplicate){row.issues.push('duplicate_identity');duplicate.issues.push('duplicate_identity');}
       rows.push(row);seen.set(row.id,row);
     }catch(e){errors.push({file,code:e.code??'invalid_history'});}
    }
   }
  }catch(e){errors.push({home:configured,code:e.code??'scan_failed'});}
 }
 return {rows,errors,checkedAt:new Date().toISOString()};
}
export async function capture(row,rows) {
 const included=new Map();
 const visit=async r=>{if(included.has(r.id))return;requireThat(!r.busy,'busy');
   const raw=await stableRead(r.file);requireThat(hash(raw)===r.hash,'stale_plan');
   const p=parseRollout(raw);requireThat(!p.busy,'busy');
   included.set(r.id,{id:r.id,raw:raw.toString('base64'),hash:hash(raw),archived:r.archived,version:r.version,issues:r.issues});
   if(r.parent){const parent=rows.find(x=>x.id===r.parent);requireThat(parent,'missing_dependency');await visit(parent);}
   for(const child of rows.filter(x=>x.parent===r.id))await visit(child);
 };
 await visit(row);
 return {format:1,logicalId:row.id,title:row.title,source:row.source,project:row.project,
   updatedAt:row.updatedAt,archived:row.archived,files:[...included.values()],issues:[...new Set([...included.values()].flatMap(x=>x.issues))]};
}
export function validatePayload(p){
 requireThat(p?.format===1&&Array.isArray(p.files)&&p.files.length>0&&p.files.length<=200,'corrupt_data');
 const seen=new Set();let total=0;
 for(const f of p.files){requireThat(typeof f.raw==='string'&&typeof f.hash==='string','corrupt_data');
  const raw=Buffer.from(f.raw,'base64');total+=raw.length;requireThat(total<=LIMIT,'file_too_large');
  requireThat(hash(raw)===f.hash&&!seen.has(f.id),'corrupt_data');const parsed=parseRollout(raw);
  requireThat(parsed.meta.id===f.id&&parsed.meta.cli_version===f.version,'corrupt_data');seen.add(f.id);
 }
 requireThat(seen.has(p.logicalId),'corrupt_data');return p;
}
export function relation(local,remote) {
 if(!local&&!remote)return 'empty';if(!local)return 'remote_only';if(!remote)return 'local_only';
 const a=new Map(local.files.map(x=>[x.id,x]));const b=new Map(remote.files.map(x=>[x.id,x]));
 let ahead=false,behind=false;
 for(const key of new Set([...a.keys(),...b.keys()])){
  if(!a.has(key)){behind=true;continue;}if(!b.has(key)){ahead=true;continue;}
  const x=Buffer.from(a.get(key).raw,'base64'),y=Buffer.from(b.get(key).raw,'base64');
  if(x.equals(y))continue;
  if(x.length>y.length&&x.subarray(0,y.length).equals(y))ahead=true;
  else if(y.length>x.length&&y.subarray(0,x.length).equals(x))behind=true;else return 'conflict';
 }
 if(ahead&&behind)return 'conflict';if(ahead)return 'local_changes';if(behind)return 'remote_changes';
 return local.archived===remote.archived?'synced':'conflict';
}
