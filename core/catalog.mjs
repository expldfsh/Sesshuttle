// Native databases are opened read-only. No migration or native process runs here.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exists,requireThat,hash} from './util.mjs';
export const TABLES={state:['threads','thread_dynamic_tools','thread_spawn_edges','thread_attachments'],history:['thread_turns','thread_items','thread_realtime_items','thread_history_projection_state']};
export async function dbPaths(home){const names=await fs.readdir(home);const latest=prefix=>names.filter(n=>new RegExp('^'+prefix+'_\\d+\\.sqlite$').test(n)).sort((a,b)=>Number(b.match(/_(\d+)/)[1])-Number(a.match(/_(\d+)/)[1]))[0];return Object.fromEntries(Object.entries({state:latest('state'),history:latest('thread_history')}).filter(([,n])=>n).map(([k,n])=>[k,path.join(home,n)]));}
export function tableColumns(db,table){return db.prepare(`PRAGMA table_info("${table}")`).all().map(x=>x.name);}
export async function openCatalog(home){const paths=await dbPaths(home),dbs={};try{for(const [kind,file] of Object.entries(paths)){requireThat(!(await fs.lstat(file)).isSymbolicLink(),'unsafe_path');const db=new DatabaseSync(file,{readOnly:true});dbs[kind]=db;db.exec('PRAGMA query_only=ON; BEGIN');}const wanted=['id','name','title','source','originator','cwd','cli_version','created_at','updated_at','created_at_ms','updated_at_ms','archived','rollout_path','attached_thread_parent_id','agent_nickname','agent_role','project_id'];const columns=dbs.state?tableColumns(dbs.state,'threads').filter(x=>wanted.includes(x)):[];const threads=dbs.state?dbs.state.prepare('SELECT '+columns.map(x=>'"'+x+'"').join(',')+' FROM threads ORDER BY id LIMIT 20001').all():[];requireThat(threads.length<=20000,'space_too_large');return {paths,dbs,threads,projects:readProjects(dbs.state),edges:dbs.state&&tableColumns(dbs.state,'thread_spawn_edges').includes('parent_thread_id')?dbs.state.prepare('SELECT parent_thread_id,child_thread_id FROM thread_spawn_edges').all():[],close(){for(const db of Object.values(dbs)){db.exec('ROLLBACK');db.close();}}};}catch(e){for(const db of Object.values(dbs))db.close();throw e;}}
export function* databaseRecords(catalog,tid){for(const [kind,tables] of Object.entries(TABLES)){const db=catalog.dbs[kind];if(!db)continue;for(const table of tables){const columns=tableColumns(db,table);if(!columns.length)continue;let where,args;
 if(table==='threads'){where='id=?';args=[tid];}else if(columns.includes('thread_id')){where='thread_id=?';args=[tid];}else if(table==='thread_spawn_edges'&&columns.includes('child_thread_id')){where='child_thread_id=?';args=[tid];}else continue;
 const pk=db.prepare(`PRAGMA table_info("${table}")`).all().filter(x=>x.pk).sort((a,b)=>a.pk-b.pk).map(x=>'"'+x.name+'"');
 for(const row of db.prepare(`SELECT * FROM "${table}" WHERE ${where}${pk.length?' ORDER BY '+pk.join(','):''}`).iterate(...args))yield {kind,table,row};
}}}
export function encodeRecord(record){return Buffer.from(JSON.stringify(record)+'\n');}
export function databaseSummary(catalog,tid){const digest=createHash('sha256');let bytes=0,count=0,turnCount=0,busy=false;const messages=[];
 for(const r of databaseRecords(catalog,tid)){const b=encodeRecord(r);digest.update(b);bytes+=b.length;
  if(r.table==='thread_turns')turnCount++;
  if(r.table==='thread_turns'&&['inProgress','in_progress','running'].includes(r.row.status))busy=true;
  if(r.table==='thread_items'){count++;try{const item=JSON.parse(r.row.item_json);const type=item.type?.toLowerCase();if(['usermessage','agentmessage','commandexecution'].includes(type)){const text=item.text??item.aggregatedOutput??item.aggregated_output??item.content?.map(x=>x.text??'').join('\n')??'';messages.push({role:type==='usermessage'?'user':type==='agentmessage'?'assistant':'tool',text:String(text).slice(0,12000)});if(messages.length>30)messages.shift();}}catch{}}
 }return {hash:digest.digest('hex'),bytes,count,turnCount,busy,messages};}
export async function indexNames(home){const result=new Map(),file=path.join(home,'session_index.jsonl');if(await exists(file)){const {records}=await import('./stream.mjs');for await(const r of records(file))if(r.id&&typeof r.thread_name==='string')result.set(r.id,r.thread_name);}return result;}
export function nativeMeta(thread){let source=thread.source;try{source=JSON.parse(source);}catch{}return {id:thread.id,source,originator:thread.originator,cli_version:thread.cli_version,cwd:thread.cwd,timestamp:new Date((thread.created_at_ms??thread.created_at*1000)||0).toISOString(),parent_thread_id:thread.attached_thread_parent_id??source?.subagent?.thread_spawn?.parent_thread_id,agent_nickname:thread.agent_nickname,agent_role:thread.agent_role};}
export function displayName(thread,fallback){return (thread?.name?.trim()||fallback||thread?.title?.split('\n').find(x=>x.trim())||thread?.id)?.slice(0,200);}

// Only project identity, display name and roots leave the native catalog. Account
// metadata is never added to sync manifests.
export function readProjects(db){
 if(!db||!tableColumns(db,'projects').includes('name'))return [];
 const roots=tableColumns(db,'project_roots').includes('path')?db.prepare('SELECT project_id,path FROM project_roots').all():[];
 return db.prepare('SELECT * FROM projects LIMIT 20001').all().map(p=>{let backing=null;try{const m=JSON.parse(p.metadata??'{}');backing=JSON.parse(m['codex.chatGptBacking']??'{}').projectId??null;}catch{}
  return {id:p.id,name:p.name,roots:roots.filter(r=>r.project_id===p.id).map(r=>r.path),backing};});
}
export function projectFor(catalog,thread,cwd){
 const all=catalog.projects??[],explicit=all.find(p=>p.id===thread?.project_id);
 if(explicit)return {nativeId:explicit.id,name:explicit.name,match:'id'};
 const normalize=p=>String(p??'').replaceAll('\\','/').replace(/\/$/,'');const dir=normalize(cwd);
 let candidates=all.map(p=>({...p,length:Math.max(-1,...p.roots.map(normalize).filter(r=>dir===r||dir.startsWith(r+'/')).map(r=>r.length))})).filter(p=>p.length>=0);
 const longest=Math.max(-1,...candidates.map(p=>p.length));candidates=candidates.filter(p=>p.length===longest);
 // Desktop migration may retain an old unlinked project at the same root. The
 // explicit ChatGPT backing matching that root identifies the current project.
 const linked=candidates.filter(p=>p.backing&&p.roots.some(r=>normalize(r).endsWith('/.chatgpt-projects/'+p.backing)));
 const chosen=candidates.length===1?candidates[0]:linked.length===1?linked[0]:null;
 if(chosen)return {nativeId:chosen.id,name:chosen.name,match:candidates.length===1?'root':'backing_root'};
 return candidates.length?{name:null,match:'ambiguous',candidates:candidates.map(p=>({id:p.id,name:p.name}))}:{name:path.basename(cwd??'')||null,match:'directory'};
}
