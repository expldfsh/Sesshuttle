import React,{useState} from 'react';
const repairLabel=(code:string)=>{
 if(code==='duplicate_identity')return 'inspectCopies';
 if(code==='scan_incomplete')return 'scanSummary';
 if(['recovery_required','import_needs_recovery','trash_recovery_required'].includes(code))return 'backups';
 if(['entry_home_missing','entry_binary_missing','binary_unavailable','working_folder_missing','project_required'].includes(code))return 'configureAndContinue';
 if(['storage_permission','storage_write_permission','storage_not_connected','decrypt_failed'].includes(code))return 'manageConnection';
 return 'reviewAndRetry';
};
const ok=(v:any)=>v.status==='verified';
export function TaskFeedback({job,t,size,onDismiss,onActivity,onRepair,onOpen}:any){
 const [expanded,setExpanded]=useState(false);
 if(!job)return null;
 const running=job.status==='running',progress=job.progress,items=job.items??[];
 const uploaded=items.filter((i:any)=>i.cloudStatus==='uploaded'&&!i.unchangedCloud).length;
 const existing=items.filter((i:any)=>i.unchangedCloud).length;
 const imported=items.filter((i:any)=>Object.values(i.targets??{}).some(ok)).length;
 const received=items.filter((i:any)=>i.historyReady).length;
 const entryCounts=['desktop','cli','ide'].map(entry=>({entry,count:items.filter((i:any)=>i.targets?.[entry]?.status==='verified').length}));
 const problems=items.filter((i:any)=>!['uploaded','downloaded','skip','running'].includes(i.status));
 const warnings=items.filter((i:any)=>i.omittedImages||Object.values(i.targets??{}).some((r:any)=>r.omittedAttachments?.length));
 const next=items.flatMap((i:any)=>Object.entries(i.targets??{}).filter(([,r])=>ok(r)).map(([entry])=>({i,entry})))[0];
 return <section className={'task-feedback '+(running?'active':problems.length||warnings.length?'attention':'success')} aria-label={t('taskResult')}>
   <div className="task-heading"><strong role="status" aria-live="polite">{running?t(progress?.stage??'stageCheck'):t(job.status==='attention'?(uploaded||imported||existing?'partial':'attention'):job.status==='completed'?'transferFinished':job.status)}</strong>
    {running&&progress&&<span>{progress.index} / {progress.total} · {progress.title} {progress.bytes>0?' · '+size(progress.bytes):''}</span>}
    {!running&&<span>{uploaded>0&&<>{t('uploaded')} {uploaded}　</>}{existing>0&&<>{t('alreadyBackedUp')} {existing}　</>}{received>0&&<>{t('historyReceived')} {received}　</>}{entryCounts.filter(x=>x.count).map(x=><span key={x.entry}>{t(x.entry)} · {t('entryReady')} {x.count}　</span>)}{problems.length>0&&<>{t('issues')} {problems.length}　</>}{warnings.length>0&&t('someImagesMissing')}</span>}
    {!running&&<button className="text-button" onClick={onDismiss} aria-label={t('close')}>×</button>}
   </div>
   {running?<progress aria-label={t('running')}/>:<>
    {(problems.length>0||warnings.length>0||expanded)&&<div className="task-items">{(expanded?items:[...new Set([...problems,...warnings])]).map((i:any)=><div key={i.id}>
      <b>{i.title}</b> · {t(i.status)} {i.cloudStatus&&<span>{t('cloud')} {t(i.cloudStatus)}</span>}
      {i.historyReady&&<p>{t('historyReceived')}{i.status!=='downloaded'&&' · '+t('cacheRetryHint')}</p>}{i.error&&<p>{i.stage&&t(i.stage)+' · '}{t(i.error.code)} {i.error.detail}</p>}{Object.entries(i.targets??{}).map(([entry,r]:any)=><p key={entry}>{t(entry)} · {r.error&&r.stage&&t(r.stage)+' · '}{t(r.error?.code??(r.omittedAttachments?.length?'imported_missing_attachments':ok(r)?'entryReady':r.status==='imported'?'entryUnverified':r.status))}
        {r.error?.detail&&<small>{r.error.detail}</small>}{r.nativeProjectName&&<small>{t('projectLabelVerified')} · {r.nativeProjectName}</small>}{!ok(r)&&<button className="primary" onClick={()=>onRepair(i,entry)}>{t(repairLabel(r.error?.code))}</button>}</p>)}
      {i.status!=='running'&&!Object.keys(i.targets??{}).length&&!['uploaded','skip'].includes(i.status)&&<button className="primary" onClick={()=>onRepair(i)}>{t(repairLabel(i.error?.code))}</button>}
    </div>)}</div>}
    <div className="actions">{next&&<button onClick={()=>onOpen(next.i.id,next.entry)}>{t('continue')} · {t(next.entry)}</button>}
    <button className="text-button" onClick={()=>setExpanded(!expanded)}>{t(expanded?'collapseDetails':'progressDetails')}</button><button className="text-button" onClick={onActivity}>{t('activity')}</button></div>
   </>}
 </section>;
}
