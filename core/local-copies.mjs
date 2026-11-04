import fs from 'node:fs/promises';
import path from 'node:path';
import {scan} from './codex.mjs';
import {hash,id,inside,requireThat} from './util.mjs';
import {checkScope} from './scan-scope.mjs';

export function copiesOf(rows,logical){
  const matches=rows.filter(row=>row.id===logical);
  const paths=new Set(matches.flatMap(row=>row.physicalFiles));
  return matches.flatMap(row=>row.physicalFiles.map(file=>({
    file,home:row.home,title:row.title,bytes:row.historyBytes,updatedAt:row.updatedAt,
    sample:row.messages.at(-1)?.text?.slice(0,240),hash:row.hash,busy:row.busy,
    indexedFile:row.indexedFile??null,canUse:!row.database||row.indexedFile===file||
      (file.endsWith('.zst')&&row.indexedFile===file.slice(0,-4)&&!paths.has(row.indexedFile))
  }))).sort((a,b)=>a.file.localeCompare(b.file));
}
export const copyToken=copies=>hash(JSON.stringify(copies));

function targetHomes(engine,entry){
  if(!entry)return engine.config().sourceHomes;
  const home=engine.config().targets?.[entry]?.home;
  requireThat(['desktop','ide','cli'].includes(entry)&&home,'entry_home_missing');
  return [home];
}

export async function inspectTarget(engine,entry,logical){
  const homes=targetHomes(engine,entry),snapshot=await scan(homes);
  const copies=copiesOf(snapshot.rows,logical);
  return {id:logical,entry,home:homes[0],errors:snapshot.errors,copies,copyToken:copyToken(copies)};
}

// Keep the active database and attachments intact; the backup can undo this choice.
export async function keepLocalCopy(engine,{logical,token,file,entry}){
  requireThat(!engine.running,'task_running');engine.running=true;
  try{
    const homes=targetHomes(engine,entry);
    const inspect=async()=>{
      const snapshot=await scan(homes);
      checkScope(snapshot,[logical],{allowDuplicateRemoval:true});
      const copies=copiesOf(snapshot.rows,logical);
      requireThat(copies.length>1&&copyToken(copies)===token,'stale_plan');
      requireThat(snapshot.rows.filter(r=>r.id===logical).every(r=>r.file&&r.homes.length===1),'copies_multiple_homes');
      const chosen=copies.find(copy=>copy.file===file);
      requireThat(chosen&&copies.every(copy=>copy.home===chosen.home),'copies_multiple_homes');
      requireThat(copies.every(copy=>!copy.busy),'busy');
      requireThat(chosen.canUse&&copies.every(copy=>!copy.indexedFile||copy.indexedFile===chosen.indexedFile||copy.indexedFile===file),'copies_indexed');
      for(const copy of copies){
        await inside(chosen.home,copy.file);
        requireThat(['sessions','archived_sessions'].includes(path.relative(chosen.home,copy.file).split(path.sep)[0]),'unsafe_path');
      }
      return {home:chosen.home,copies};
    };
    const home=await engine.importer.guard((await inspect()).home);
    requireThat(!engine.state.keys('import/').some(k=>{const r=engine.state.get(k);return r.home===home&&['prepared','validating','needs_recovery'].includes(r.status); }),'recovery_required');
    const backup=await engine.importer.backup(home);
    await engine.importer.processGuard();const {copies}=await inspect();
    const task=id(),journal={backup:backup.id,home};engine.state.set('import/'+task,{...journal,status:'prepared'});
    try{
      for(const copy of copies){
        if(copy.file===file)continue;
        const dest=path.join(engine.state.root,'recovered',backup.id,path.relative(home,copy.file));
        await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fs.rename(copy.file,dest);
      }
      const after=await scan([home]);checkScope(after,[logical]);
      requireThat(after.rows.filter(r=>r.id===logical).length===1,'duplicate_identity');
      engine.state.set('import/'+task,{...journal,status:'verified'});return {backup:backup.id};
    }catch(e){
      engine.state.set('import/'+task,{...journal,status:'needs_recovery'});
      requireThat(false,'import_needs_recovery',backup.id);
    }
  }finally{engine.running=false;}
}

export function uploadSource(rows,logical,choice){
  if(!choice)return rows.find(row=>row.id===logical);
  const copies=copiesOf(rows,logical);
  requireThat(copies.length>1&&choice.token===copyToken(copies),'stale_plan');
  const row=rows.find(r=>r.id===logical&&r.physicalFiles.includes(choice.file));
  requireThat(row?.issues.includes('duplicate_identity'),'stale_plan');
  requireThat(copies.find(copy=>copy.file===choice.file)?.canUse,'copies_indexed',row.indexedFile??'');
  return {...row,file:choice.file,issues:row.issues.filter(code=>code!=='duplicate_identity')};
}
