import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {scan} from './codex.mjs';import {openCatalog,dbPaths,tableColumns} from './catalog.mjs';import {referencesFor,inspectAttachment} from './attachments.mjs';import {copyVerified,digestFile,writeStream,records,recordLines} from './stream.mjs';import {id,hash,requireThat,inside,exists,atomic,Fault} from './util.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const signature=rows=>hash(JSON.stringify(rows.map(r=>[r.id,r.hash,r.physicalFiles]).sort((a,b)=>a[0].localeCompare(b[0]))));
const encoded=r=>Buffer.from(JSON.stringify(r,(_k,v)=>v instanceof Uint8Array?{$blob:Buffer.from(v).toString('base64')}:v)+'\n');
const value=v=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$blob==='string'?Buffer.from(v.$blob,'base64'):v;
function tables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name).filter(t=>/^[a-z_][a-z0-9_]*$/i.test(t)&&!t.startsWith('sqlite_')).map(table=>{const info=db.prepare('PRAGMA table_info("'+table+'")').all(),columns=info.map(c=>c.name);const fields=table==='threads'?['id']:columns.includes('child_thread_id')?['child_thread_id',...(columns.includes('parent_thread_id')?['parent_thread_id']:[])]:columns.includes('thread_id')?['thread_id']:[];return {table,fields,pk:info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)};}).filter(t=>t.fields.length);}
function where(t,ids){return {sql:t.fields.map(f=>'"'+f+'" IN ('+ids.map(()=>'?').join(',')+')').join(' OR '),args:t.fields.flatMap(()=>ids)};}
function* selectedRecords(catalog,ids){for(const [kind,db]of Object.entries(catalog.dbs))for(const t of tables(db)){const w=where(t,ids);for(const row of db.prepare('SELECT * FROM "'+t.table+'" WHERE '+w.sql+(t.pk.length?' ORDER BY '+t.pk.map(k=>'"'+k+'"').join(','):' ORDER BY rowid')).iterate(...w.args))yield {kind,table:t.table,row};}}
async function indexRows(home,ids){const file=path.join(home,'session_index.jsonl'),selected=[];if(await exists(file))for await(const line of recordLines(file)){if(line.raw.length&&ids.includes(JSON.parse(line.raw.toString('utf8')).id))selected.push(line.raw.toString('utf8'));}return selected;}
async function rewriteIndex(home,ids,restored=[]){const file=path.join(home,'session_index.jsonl');if(!await exists(file)&&!restored.length)return;async function* output(){if(await exists(file))for await(const line of recordLines(file)){if(!line.raw.length||!ids.includes(JSON.parse(line.raw.toString('utf8')).id)){yield line.raw;yield Buffer.from('\n');}}for(const line of restored)yield Buffer.from(line+'\n');}await writeStream(file,output());}
async function ownedAsset(home,file,projects){for(const root of projects.filter(Boolean))try{await inside(root,file);return false;}catch{}
 try{await inside(home,file);return ['sesshuttle_assets','assets','images','attachments','uploads'].includes(path.relative(home,file).split(path.sep)[0]);}catch{}
 try{await inside(os.tmpdir(),file);return /^codex-clipboard-[0-9a-f-]+\.(png|jpe?g|webp|gif)$/i.test(path.basename(file))||/\/TemporaryItems\/NSIRD_screencaptureui_[^/]+\/[^/]+\.(png|jpe?g)$/i.test(file);}catch{return false;}
}
async function databaseWrite(home,action){const dbs={};try{for(const [kind,file]of Object.entries(await dbPaths(home))){await inside(home,file);const db=dbs[kind]=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');}await action(dbs);for(const db of Object.values(dbs))db.exec('COMMIT');}catch(e){for(const db of Object.values(dbs))try{db.exec('ROLLBACK');}catch{}throw e;}finally{for(const db of Object.values(dbs))db.close();}}
export class Trash{
 constructor(state,importer,{checkpoint=async()=>{}}={}){this.state=state;this.importer=importer;this.checkpoint=checkpoint;this.plans=new Map();}
 list(){return this.state.keys('trash/').map(k=>this.state.get(k)).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async preview(homes,{ids,includeDependents=false},{ownershipHomes=homes,reserveAssets=[],snapshot=null}={}){
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=2000&&typeof includeDependents==='boolean','invalid_selection');
  const result=snapshot??await scan(homes);requireThat(!result.errors.length,'scan_incomplete');const selected=new Set(ids);requireThat(ids.every(tid=>result.rows.some(r=>r.id===tid)),'invalid_selection');
  if(includeDependents){let added;do{added=false;for(const row of result.rows)if(!selected.has(row.id)&&(row.dependencies??[row.parent].filter(Boolean)).some(x=>selected.has(x))){selected.add(row.id);added=true;}}while(added);}
  const rows=result.rows.filter(r=>selected.has(r.id)),home=rows[0].home;requireThat(rows.every(r=>r.home===home&&r.homes.length===1),'trash_multiple_homes');requireThat(rows.every(r=>!r.busy&&r.issues.every(issue=>issue==='missing_rollout'&&r.database)),'incomplete_history');
  const blockers=result.rows.filter(r=>!selected.has(r.id)&&(r.dependencies??[r.parent].filter(Boolean)).some(x=>selected.has(x))).map(r=>({id:r.id,title:r.title,kind:r.kind}));
  const ownerRows=[...result.rows];
  for(const other of ownershipHomes.filter(p=>!homes.includes(p))){
    const otherScan=await scan([other]);requireThat(!otherScan.errors.length,'scan_incomplete');
    ownerRows.push(...otherScan.rows);
  }
  const ownerKey=r=>r.home===home?r.id:r.home+'#'+r.id;
  const projects=[...new Set(ownerRows.map(r=>r.project))],owners=new Map(),assets=new Map(),catalogs=new Map();
  let knownOwners=true;
  try{for(const row of ownerRows){if(!catalogs.has(row.home))catalogs.set(row.home,await openCatalog(row.home));for(const p of catalogs.get(row.home).projects??[])for(const root of p.roots)if(!projects.includes(root))projects.push(root);const refs=await referencesFor(row,catalogs.get(row.home),{ownership:true});if(!row.file||refs.issues.length)knownOwners=false;for(const resource of refs.resources){let real;try{real=await fs.realpath(resource);}catch{real=path.resolve(resource);}const set=owners.get(real)??new Set();set.add(ownerKey(row));owners.set(real,set);if(selected.has(ownerKey(row)))assets.set(real,{path:real,unsafeReference:(assets.get(real)?.unsafeReference??false)||!path.isAbsolute(resource)||await fs.lstat(resource).then(s=>!s.isFile()||s.isSymbolicLink()||s.nlink!==1,()=>true),sessionIds:[...new Set([...(assets.get(real)?.sessionIds??[]),row.id])]});}}}finally{for(const c of catalogs.values())c.close();}
  const files=[];for(const row of rows)for(const file of row.physicalFiles??[row.file].filter(Boolean)){await inside(home,file);requireThat(/^(sessions|archived_sessions)[/\\\\].+\.jsonl(?:\.zst)?$/.test(path.relative(home,file)),'unsafe_path');if(!files.some(f=>f.path===file))files.push({path:file,kind:'history',sessionIds:[row.id],...(await digestFile(file))});}
  for(const a of assets.values()){const unselected=[...(owners.get(a.path)??[])].filter(x=>!selected.has(x));a.sharedWith=unselected.map(key=>ownerRows.find(r=>ownerKey(r)===key)).map(r=>({id:r.id,title:r.title,home:r.home}));if(unselected.length||reserveAssets.includes(a.path)){a.disposition='shared';continue;}if(!await exists(a.path)){a.disposition='missing';continue;}if(a.unsafeReference||!await ownedAsset(home,a.path,projects)){a.disposition='protected';continue;}if(!knownOwners){a.disposition='uncertain';continue;}try{const s=await fs.lstat(a.path);requireThat(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1,'unsafe_path');const report=await inspectAttachment(rows[0],a.path);requireThat(['included','approval_required'].includes(report.status),'unsafe_path');const info=await digestFile(a.path);Object.assign(a,info);a.disposition='remove';files.push({...a,kind:'asset'});}catch(e){a.disposition=e.code==='ENOENT'?'missing':'protected';}}
  const token=id(),plan={token,home,homes,ownershipHomes,reserveAssets,ids:[...selected],requestedIds:ids,includeDependents,signature:signature(result.rows),rows:rows.map(r=>({id:r.id,title:r.title,kind:r.kind,indexOnly:!r.file,bytes:r.bytes,originProject:r.originProject})),files,assets:[...assets.values()],blockers,bytes:files.reduce((n,f)=>n+f.bytes,0)};this.plans.clear();this.plans.set(token,plan);return plan;
 }
 async mark(info,status){info.status=status;this.state.set('trash/'+info.id,info);await atomic(path.join(this.state.root,'trash',info.id,'manifest.json'),JSON.stringify(info));}
 invalidate(home,ids){for(const prefix of ['bundle-receipt/'+hash(home)+'/','receipt/'+hash(home)+'/'])for(const tid of ids)this.state.set(prefix+tid,null);for(const k of this.state.keys('entries/')){const entries=this.state.get(k);if(!entries)continue;for(const r of Object.values(entries))if(r.home===home&&ids.some(tid=>k.endsWith('/'+tid)))r.status='locally_removed';this.state.set(k,entries);}}
 async remove(token){const plan=this.plans.get(token);requireThat(plan&&!plan.blockers.length,'trash_dependencies');await this.importer.guard(plan.home);requireThat(!this.list().some(t=>t.home===plan.home&&['prepared','removing','restoring','needs_recovery'].includes(t.status)),'trash_recovery_required');const current=await scan(plan.homes);requireThat(!current.errors.length&&signature(current.rows)===plan.signature,'stale_plan');
  const root=path.join(this.state.root,'trash',token);await fs.mkdir(root,{recursive:true,mode:0o700});const disk=await fs.statfs(root);requireThat(disk.bavail*disk.bsize>plan.bytes+plan.rows.reduce((n,r)=>n+r.bytes,0)+256*1024*1024,'disk_space');
  const info={id:token,home:plan.home,ids:plan.ids,rows:plan.rows,assets:plan.assets,createdAt:new Date().toISOString(),files:[]};
  this.state.set('trash/'+token,{...info,status:'staging'});
  try{
  const files=[];for(const [i,f]of plan.files.entries()){const saved='files/'+i;await copyVerified(f.path,path.join(root,saved),f.hash);files.push({...f,saved});}
  const catalog=await openCatalog(plan.home),dbFile=path.join(root,'records.jsonl');try{async function* data(){for(const r of selectedRecords(catalog,plan.ids))yield encoded(r);}await writeStream(dbFile,data());}finally{catalog.close();}
  Object.assign(info,{files,indexRows:await indexRows(plan.home,plan.ids),database:await digestFile(dbFile)});await this.mark(info,'prepared');this.plans.delete(token);
  }catch(e){if(this.state.get('trash/'+token)?.status==='staging')await this.clearStaging(token);throw e;}
  try{await this.importer.processGuard();const fresh=await scan(plan.homes);requireThat(!fresh.errors.length&&signature(fresh.rows)===plan.signature,'stale_plan');const ownership=await new Trash(this.state,this.importer).preview(plan.homes,{ids:plan.requestedIds,includeDependents:plan.includeDependents},{ownershipHomes:plan.ownershipHomes,reserveAssets:plan.reserveAssets});
   requireThat(!ownership.blockers.length&&plan.files.length===ownership.files.length&&plan.files.every(f=>ownership.files.some(g=>g.path===f.path&&g.hash===f.hash)),'stale_plan');
   for(const f of info.files)requireThat((await digestFile(f.path)).hash===f.hash,'stale_plan');await this.mark(info,'removing');
   await databaseWrite(plan.home,async dbs=>{for(const db of Object.values(dbs))for(const t of tables(db).sort((a,b)=>Number(a.table==='threads')-Number(b.table==='threads'))){const w=where(t,plan.ids);db.prepare('DELETE FROM "'+t.table+'" WHERE '+w.sql).run(...w.args);}});
   await this.checkpoint('database_removed');await rewriteIndex(plan.home,plan.ids);for(const f of info.files){requireThat((await digestFile(f.path)).hash===f.hash,'stale_plan');await fs.unlink(f.path);}this.invalidate(plan.home,plan.ids);await this.mark(info,'removed');return info;
  }catch(e){await this.mark(info,'needs_recovery');throw new Fault('trash_needs_recovery',info.id+': '+(e.code??e.message));}
 }
 async clearStaging(trashId){
  const info=this.state.get('trash/'+trashId);requireThat(info?.status==='staging','invalid_selection');
  await this.eraseCopy(info);
 }
 async eraseCopy(info){
  requireThat(/^[a-f0-9-]{36}$/i.test(info.id),'unsafe_path');
  const root=await inside(this.state.root,path.join(this.state.root,'trash',info.id));
  await fs.rm(root,{recursive:true,force:true});this.state.set('trash/'+info.id,null);
 }
 async purge(trashId){
  const info=this.state.get('trash/'+trashId);
  requireThat(info&&['removed','restored','purging'].includes(info.status),'trash_recovery_required');
  this.state.set('trash/'+trashId,{...info,status:'purging'});await this.eraseCopy(info);
 }
 async restore(trashId){const info=this.state.get('trash/'+trashId);requireThat(info&&['prepared','removing','removed','restoring','needs_recovery'].includes(info.status),'backup_not_found');const home=await this.importer.guard(info.home,{allowTrashRecovery:true}),root=await inside(this.state.root,path.join(this.state.root,'trash',info.id));
  const dbFile=await inside(root,path.join(root,'records.jsonl'));requireThat((await digestFile(dbFile)).hash===info.database.hash,'corrupt_backup');const expected=new Set();for await(const r of records(dbFile))expected.add(hash(encoded(r)));
  const catalog=await openCatalog(home);try{for(const r of selectedRecords(catalog,info.ids))requireThat(expected.has(hash(encoded(r))),'trash_restore_conflict');}finally{catalog.close();}
  const index=await indexRows(home,info.ids);requireThat(index.every(r=>info.indexRows.includes(r)),'trash_restore_conflict');
  for(const f of info.files){await inside(root,path.join(root,f.saved));requireThat((await digestFile(path.join(root,f.saved))).hash===f.hash,'corrupt_backup');if(f.kind==='history')await inside(home,f.path);else requireThat(await ownedAsset(home,f.path,[]),'unsafe_path');if(await exists(f.path))requireThat((await digestFile(f.path)).hash===f.hash,'trash_restore_conflict');}
  const disk=await fs.statfs(home);requireThat(disk.bavail*disk.bsize>info.files.reduce((n,f)=>n+f.bytes,0)+info.database.bytes+256*1024*1024,'disk_space');await this.mark(info,'restoring');
  try{await this.importer.processGuard();for(const f of info.files)if(!await exists(f.path))await copyVerified(path.join(root,f.saved),f.path,f.hash);
   await databaseWrite(home,async dbs=>{for await(const r of records(dbFile)){const db=dbs[r.kind];requireThat(db&&tables(db).some(t=>t.table===r.table),'database_schema');const columns=Object.keys(r.row);requireThat(columns.every(c=>tableColumns(db,r.table).includes(c)),'database_schema');const names=columns.map(c=>'"'+c+'"');db.prepare('INSERT OR IGNORE INTO "'+r.table+'" ('+names.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...columns.map(c=>value(r.row[c])));}});
   await rewriteIndex(home,info.ids,info.indexRows);this.invalidate(home,info.ids);await this.mark(info,'restored');return info;
  }catch(e){await this.mark(info,'needs_recovery');throw new Fault('trash_needs_recovery',info.id+': '+(e.code??e.message));}
 }
}
