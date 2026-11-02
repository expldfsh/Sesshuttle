import fs from 'node:fs/promises';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {validateBundle,bundleIdentity,bundleBytes,materialize} from './bundle.mjs';
import {dbPaths,tableColumns,TABLES} from './catalog.mjs';
import {records,copyVerified,writeStream} from './stream.mjs';
import {id,hash,requireThat,inside,exists,Fault} from './util.mjs';
import {scan,KNOWN_VERSIONS} from './codex.mjs';
import {binaryVersion,NativeClient} from './native.mjs';
const key=(home,tid)=>'bundle-receipt/'+hash(home)+'/'+tid;
export async function recordBundle(importer,payload,home,project,binary,runtime){const rows=(await scan([home])).rows;for(const f of payload.files){const r=rows.find(x=>x.id===f.id);if(r)importer.state.set(key(home,f.id),{identity:bundleIdentity(payload),hash:r.hash,project,binary,runtime,checkedAt:new Date().toISOString()});}}
async function initialize(binary,home,project,root){const client=new NativeClient(binary,home,project);try{await client.init(home);}finally{await client.close();}
 if(!(await dbPaths(home)).history){
  // Ask this exact runtime to create its own schema in a disposable application
  // directory. No fabricated bootstrap conversation enters the user's home.
  const scratch=path.join(root,'schema-'+id());await fs.mkdir(scratch,{recursive:true,mode:0o700});const bootstrap=new NativeClient(binary,scratch,project);
  try{await bootstrap.init(scratch);const r=await bootstrap.rpc('thread/start',{cwd:project,historyMode:'paginated',sandbox:'read-only',approvalPolicy:'on-request'});await bootstrap.rpc('thread/inject_items',{threadId:r.thread.id,items:[{type:'message',role:'developer',content:[{type:'input_text',text:'sesshuttle isolated schema initialization. No task.'}]}]});}finally{await bootstrap.close();}
  const p=(await dbPaths(scratch)).history;requireThat(p,'database_schema');const db=new DatabaseSync(p);try{db.exec('PRAGMA foreign_keys=OFF; BEGIN');for(const t of TABLES.history)if(tableColumns(db,t).length)db.exec('DELETE FROM "'+t+'"');db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
  const dest=await inside(home,path.join(home,path.basename(p)));requireThat(!await exists(dest),'stale_plan');await copyVerified(p,dest);await fs.rm(scratch,{recursive:true,force:true});
 }
}
function validateRow(record,tid){requireThat(TABLES[record.kind]?.includes(record.table)&&record.row&&typeof record.row==='object','corrupt_data');const row=record.row;requireThat(record.table==='threads'?row.id===tid:record.table==='thread_spawn_edges'?row.child_thread_id===tid:row.thread_id===tid,'corrupt_data');}
async function mergeDatabases(home,files,placements,project){const paths=await dbPaths(home),dbs={};try{for(const [kind,p]of Object.entries(paths)){await inside(home,p);dbs[kind]=new DatabaseSync(p);dbs[kind].exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');}
 for(const f of files){const artifact=f.artifacts.find(a=>a.kind==='database');if(!artifact)continue;const cleared=new Set();for(const [kind,tables]of Object.entries(TABLES))for(const table of [...tables].reverse()){if(table==='threads')continue;const db=dbs[kind];if(!db)continue;const cols=tableColumns(db,table);const field=table==='thread_spawn_edges'?'child_thread_id':'thread_id';if(cols.includes(field)){db.prepare('DELETE FROM "'+table+'" WHERE "'+field+'"=?').run(f.id);cleared.add(table);}}for await(const record of records(artifact.file)){validateRow(record,f.id);const db=dbs[record.kind];requireThat(db,'database_schema');const columns=tableColumns(db,record.table),row={...record.row};for(const k of Object.keys(row))if(!columns.includes(k)){requireThat(record.table==='threads'&&k==='attached_thread_parent_id'&&row[k]===null,'database_schema');delete row[k];}requireThat(columns.length,'database_schema');
  if(record.table==='threads'){row.rollout_path=placements.get(f.id);row.cwd=project;if('project_id'in row)row.project_id=null;if('thread_section_id'in row)row.thread_section_id=null;row.archived=f.archived?1:0;}
  const table=record.table;if(!cleared.has(table)&&table!=='threads'){const field=table==='thread_spawn_edges'?'child_thread_id':'thread_id';db.prepare(`DELETE FROM "${table}" WHERE "${field}"=?`).run(f.id);cleared.add(table);}
  const fields=Object.keys(row),values=fields.map(k=>row[k]);const quoted=fields.map(k=>'"'+k+'"');const pk=db.prepare(`PRAGMA table_info("${table}")`).all().filter(x=>x.pk).map(x=>x.name);
  const update=fields.filter(k=>!pk.includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',');
  const sql=`INSERT INTO "${table}" (${quoted.join(',')}) VALUES (${fields.map(()=>'?').join(',')}) ON CONFLICT ${update?'DO UPDATE SET '+update:'DO NOTHING'}`;db.prepare(sql).run(...values);
 }}for(const db of Object.values(dbs))db.exec('COMMIT');
 }catch(e){for(const db of Object.values(dbs))try{db.exec('ROLLBACK');}catch{}throw e;}finally{for(const db of Object.values(dbs))db.close();}}
export async function importBundle(importer,payload,target,{replace=false,expectedHashes={},vault}={}){
 validateBundle(payload);requireThat(payload.files.find(f=>f.id===payload.logicalId).artifacts.some(a=>a.kind==='rollout'),'missing_rollout');requireThat(vault,'storage_not_connected');// Source versions are historical metadata; the target executable is independently validated below.
 requireThat(!payload.issues?.length,'incomplete_history');const home=await importer.guard(target.home),project=await fs.realpath(target.project),runtime=await binaryVersion(target.binary);
 requireThat(!importer.state.keys('import/').some(k=>{const t=importer.state.get(k);return t.home===home&&['prepared','validating','needs_recovery'].includes(t.status); }),'recovery_required');
 const before=await scan([home]);requireThat(!before.errors.length,'scan_incomplete');let verified=true;for(const f of payload.files){const old=before.rows.find(r=>r.id===f.id);if(expectedHashes[f.id]!==undefined)requireThat((old?.hash??null)===expectedHashes[f.id],'stale_plan');const receipt=importer.state.get(key(home,f.id));const identical=receipt&&receipt.hash===old?.hash&&receipt.identity===bundleIdentity(payload);verified&&=!!identical&&receipt.project===project&&receipt.binary===target.binary&&receipt.runtime===runtime;
  const raw=f.artifacts.find(a=>a.kind==='rollout'),db=f.artifacts.find(a=>a.kind==='database');const exact=old&&(old.rawHash??null)===(raw?.hash??null)&&(old.dbHash??null)===(db?.hash??null);
  if(old&&!replace&&!exact)requireThat(receipt?.hash===old.hash,'conflict');
 }
 if(verified)return {status:'verified',backup:null,unchanged:true,runtime};
 const temp=path.join(importer.state.root,'downloads',id());await fs.mkdir(temp,{recursive:true,mode:0o700});const disk=await fs.statfs(temp);requireThat(disk.bavail*disk.bsize>bundleBytes(payload)+256*1024*1024,'disk_space');let taskId,backup;
 try{const staged=await materialize(payload,vault,temp),placements=new Map(),writes=[];
  for(const f of staged.files){const old=before.rows.find(r=>r.id===f.id),rollout=f.artifacts.find(a=>a.kind==='rollout');f.placementArchived=f.artifacts.some(a=>a.kind==='database')?f.archived:(old?.archived??f.archived);const destination=(!f.artifacts.some(a=>a.kind==='database')||old?.archived===f.archived?old?.file?.replace(/\.zst$/,''):null)??path.join(home,f.archived?'archived_sessions':'sessions',`rollout-2026-01-01T00-00-00-${f.id}.jsonl`);await inside(home,destination);placements.set(f.id,destination);
   if(rollout)writes.push({source:rollout.file,target:destination,hash:rollout.hash,preservedOriginal:old?.file&&old.file!==destination?old.file:null});
   // Map explicit asset paths in a temporary copy only; original artifacts stay intact in R2.
   const replacements=new Map();for(const a of f.artifacts.filter(a=>a.kind==='asset')){const dest=await inside(home,path.join(home,'sesshuttle_assets',a.hash));writes.push({source:a.file,target:dest,hash:a.hash});replacements.set(a.path,dest);}
   if(replacements.size){function change(v){if(!v||typeof v!=='object')return;if(['localImage','local_image'].includes(v.type)&&replacements.has(v.path))v.path=replacements.get(v.path);for(const x of Object.values(v))if(typeof x==='object')change(x);}
    for(const a of f.artifacts.filter(a=>a.kind!=='asset')){const output=a.file+'.mapped';async function* mapped(){for await(const r of records(a.file)){if(a.kind==='database'&&r.row?.item_json){const item=JSON.parse(r.row.item_json);change(item);r.row.item_json=JSON.stringify(item);}else change(r);yield Buffer.from(JSON.stringify(r)+'\n');}}await writeStream(output,mapped());if(a.kind==='rollout'){const w=writes.find(w=>w.source===a.file);w.source=output;delete w.hash;}else a.file=output;}
   }
  }
  backup=await importer.backup(home);taskId=id();importer.state.set('import/'+taskId,{status:'prepared',backup:backup.id,home});await importer.processGuard();const fresh=await scan([home]);requireThat(!fresh.errors.length&&fresh.rows.length===before.rows.length&&before.rows.every(r=>fresh.rows.some(n=>n.id===r.id&&n.hash===r.hash)),'stale_plan');
  for(const w of writes){await inside(home,w.target);if(w.preservedOriginal){await inside(home,w.preservedOriginal);const kept=path.join(importer.state.root,'recovered',backup.id,path.relative(home,w.preservedOriginal));await fs.mkdir(path.dirname(kept),{recursive:true,mode:0o700});await fs.rename(w.preservedOriginal,kept);}await copyVerified(w.source,w.target,w.hash);}
  if(staged.files.some(f=>f.artifacts.some(a=>a.kind==='database'))){await initialize(target.binary,home,project,temp);await mergeDatabases(home,staged.files,placements,project);}
  importer.state.set('import/'+taskId,{status:'validating',backup:backup.id,home});await importer.native({binary:target.binary,home,project,files:staged.files,device:payload.device});await recordBundle(importer,payload,home,project,target.binary,runtime);importer.state.set('import/'+taskId,{status:'verified',backup:backup.id,home});return {status:'verified',backup:backup.id,runtime};
 }catch(e){if(taskId){importer.state.set('import/'+taskId,{status:'needs_recovery',backup:backup.id,home,error:e.code??'operation_failed'});throw new Fault('import_needs_recovery',backup.id+': '+(e.code??e.message)+' '+(e.detail??''));}throw e;}finally{await fs.rm(temp,{recursive:true,force:true});}
}
