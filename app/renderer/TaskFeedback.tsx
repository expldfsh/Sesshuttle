import React,{useState} from 'react';
const ok=(v:any)=>v.status==='verified';
export function TaskFeedback({job,t,size,onDismiss,onActivity,onRepair,onOpen}:any){
 const [expanded,setExpanded]=useState(false);
 if(!job)return null;
 const running=job.status==='running',progress=job.progress,items=job.items??[];
 const uploaded=items.filter((i:any)=>i.cloudStatus==='uploaded').length;
 const imported=items.filter((i:any)=>Object.values(i.targets??{}).some(ok)).length;
 const problems=items.filter((i:any)=>!['uploaded','downloaded','skip','running'].includes(i.status));
 const warnings=items.filter((i:any)=>i.omittedImages||Object.values(i.targets??{}).some((r:any)=>r.omittedAttachments?.length));
 const next=items.flatMap((i:any)=>Object.entries(i.targets??{}).filter(([,r])=>ok(r)).map(([entry])=>({i,entry})))[0];
 return <section className={'task-feedback '+(running?'active':problems.length||warnings.length?'attention':'success')} aria-label={t('taskResult')}>
   <div className="task-heading"><strong role="status" aria-live="polite">{running?t(progress?.stage??'stageCheck'):t(job.status==='completed'?'transferFinished':job.status)}</strong>
    {running&&progress&&<span>{progress.index} / {progress.total} · {progress.title} {progress.bytes>0?' · '+size(progress.bytes):''}</span>}
    {!running&&<span>{uploaded>0&&<>{t('uploaded')} {uploaded}　</>}{imported>0&&<>{t('downloaded')} {imported}　</>}{problems.length>0&&<>{t('issues')} {problems.length}　</>}{warnings.length>0&&t('someImagesMissing')}</span>}
    {!running&&<button className="text-button" onClick={onDismiss} aria-label={t('close')}>×</button>}
   </div>
   {running?<progress aria-label={t('running')}/>:<>
    {(problems.length>0||warnings.length>0||expanded)&&<div className="task-items">{(expanded?items:[...new Set([...problems,...warnings])]).map((i:any)=><div key={i.id}>
      <b>{i.title}</b> · {t(i.status)} {i.cloudStatus&&<span>{t('cloud')} {t(i.cloudStatus)}</span>}
      {i.error&&<p>{t(i.error.code)}</p>}{Object.entries(i.targets??{}).map(([entry,r]:any)=><p key={entry}>{t(entry)} · {t(r.error?.code??(r.omittedAttachments?.length?'imported_missing_attachments':r.status))}
        {r.nativeProjectName&&<small>{t('projectLabelVerified')} · {r.nativeProjectName}</small>}{!ok(r)&&<button onClick={()=>onRepair(i,entry)}>{t('fixAndRetry')}</button>}</p>)}
      {i.status!=='running'&&!Object.keys(i.targets??{}).length&&!['uploaded','skip'].includes(i.status)&&<button onClick={()=>onRepair(i)}>{t('fixAndRetry')}</button>}
    </div>)}</div>}
    <div className="actions">{next&&<button onClick={()=>onOpen(next.i.id,next.entry)}>{t('continue')} · {t(next.entry)}</button>}
    <button className="text-button" onClick={()=>setExpanded(!expanded)}>{t(expanded?'collapseDetails':'progressDetails')}</button><button className="text-button" onClick={onActivity}>{t('activity')}</button></div>
   </>}
 </section>;
}
