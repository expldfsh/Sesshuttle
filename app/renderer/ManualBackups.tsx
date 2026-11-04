import React,{useState} from 'react';
import {Select} from './Select';

export function ManualBackups({data,cfg,t,date,size,busy,ask,work,call,reload,changed,notify}:any){
 const homes=Array.from(new Set<string>([...cfg.sourceHomes,...Object.values(cfg.targets).map((v:any)=>v.home)].filter(Boolean)));
 const [chosen,setChosen]=useState('');
 const home=homes.includes(chosen)?chosen:homes[0];
 async function create(){
  if(!await ask(t('createBackupConfirm')+'\n'+home))return;
  await call('createBackup',{home});await reload();notify(t('backupCreated'));
 }
 async function restore(b:any){
  const review=await call('reviewRestore',{id:b.id});
  const message=[date(b.createdAt),review.home,t('restoreConfirm'),t('restoreFiles')+' '+review.count,t('removeFiles')+' '+review.remove.length,...review.remove].join('\n');
  if(!await ask(message))return;
  await call('restore',{id:b.id,token:review.token});changed();await reload();notify(t('restoreDone'));
 }
 async function discard(b:any){
  if(!await ask([t('deleteBackupConfirm'),date(b.createdAt),b.home,size(b.diskBytes)].join('\n')))return;
  await call('deleteBackup',{id:b.id});await reload();notify(t('backupDeleted'));
 }
 return <section className="card"><h2>{t('localBackups')}</h2><p>{t('manualBackupHint')}</p>
 <div className="actions">{homes.length>0&&<Select label={t('dataHome')} value={home} options={homes.map(p=>({value:p,label:p}))} onChange={setChosen}/>}
 <button className="primary" disabled={busy||!home} onClick={()=>work(create,'creatingBackup')}>{t('createBackup')}</button></div>
 {data.imports.filter((x:any)=>x.status==='needs_recovery').map((x:any,i:number)=><p className="warning-box" key={i}>{t('import_needs_recovery')} · {x.home} · {x.backup}</p>)}
 {!data.backups.length&&<p>{t('noBackups')}</p>}
 {data.backups.slice().sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt)).map((b:any)=><div className="backup-row" key={b.id}><div><strong>{date(b.createdAt)} · {t(b.reason==='manual'?'manualReason':'legacyReason')}</strong><small>{b.home}</small>{b.restorePending&&<p className="warning-box">{t('restore_pending')}</p>}<small>{b.count} {t('files')} · {t('diskUsed')} {size(b.diskBytes)}</small></div>
 <button disabled={busy} onClick={()=>work(()=>restore(b),'restoreActive')}>{t('restore')}</button>
 <button disabled={busy} className="danger" onClick={()=>work(()=>discard(b),'deletingBackup')}>{t('deleteBackup')}</button></div>)}</section>;
}
