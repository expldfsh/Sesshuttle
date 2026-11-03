import React,{useEffect,useRef,useState} from 'react';

const dateLabel=(v:string|undefined,locale:string)=>v?new Date(v).toLocaleString(locale):'—';
const scopes=['local','cloud','both'];
const scopeKey=(s:string)=>({local:'removeHere',cloud:'removeCloud',both:'removeBoth'}[s]??s);
const modeKey=(s:string)=>({trash:'toBin',purge:'permanentDelete',restore:'restoreCopy'}[s]??s);

function ConfirmationLabel({t,mode,local,cloud}:any){
  const destinations=[local>0?t('thisDevice')+' '+local+' '+t('chatCountUnit'):'',cloud>0?t('cloud')+' '+cloud+' '+t('backupVersions'):''].filter(Boolean);
  return <>{t(modeKey(mode))} · {destinations.join(' + ')}</>;
}
function CopyList({items,t,locale}:any){
  return <details className="removal-copies"><summary>{t('keptCopies')} ({items.length})</summary>
    {!items.length&&<p>{t('noKnownCopies')}</p>}
    <ul>{items.map((c:any,i:number)=><li key={i}><b>{t(c.place)}</b> · {c.title??c.home} {c.at&&' · '+dateLabel(c.at,locale)} <code>{c.id?.slice(0,12)}</code>
      {c.place==='wholeBackup'&&<small>{t('wholeBackupHint')}</small>}
      {c.members?.length>0&&<small>{c.members.join(' · ')}</small>}</li>)}</ul>
  </details>;
}

export function RemovalFlow({initial,call,t,size,locale,connected,onClose,onExecute,onRepair}:any){
  const [q,setQ]=useState<any>(()=>initial.plan?.q??{ids:initial.ids,scope:initial.scope??(initial.hasLocal?'local':'cloud'),mode:initial.mode??'trash',kind:initial.binId?'bin':'live',binId:initial.binId,includeDependents:false});
  const [plan,setPlan]=useState<any>(initial.plan??null),[versions,setVersions]=useState<Record<string,string[]>>({});
  const [pending,setPending]=useState(false),[error,setError]=useState<any>(null),[permanent,setPermanent]=useState(false),[upgrade,setUpgrade]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),title=useRef<HTMLHeadingElement>(null),lock=useRef(false);
  useEffect(()=>{const d=dialog.current;d?.showModal();return()=>d?.close();},[]);
  useEffect(()=>{title.current?.focus();if(dialog.current)dialog.current.scrollTop=0;},[plan?.token]);
  const refresh=async(request:any,revise=false)=>{
    if(lock.current)return;lock.current=true;setPending(true);setError(null);setPermanent(false);setUpgrade(false);
    try{const next=revise?await call('reviseRemovalPlan',{id:plan.token}):await call('reviewRemoval',request);setQ(next.q);setPlan(next);setVersions({});}
    catch(e){setError(e);}finally{lock.current=false;setPending(false);}
  };
  const reset=()=>{setPlan(null);setVersions({});setPermanent(false);setUpgrade(false);setError(null);};
  const previous=plan?.previous;
  const done=(side:string,home?:string)=>previous?.sides.some((s:any)=>s.side===side&&(!home||s.home===home)&&s.status==='done');
  const groups=(plan?.local??[]).filter((g:any)=>!done('local',g.home));
  const totalLocal=new Set(groups.flatMap((g:any)=>g.ids)).size;
  const totalCloud=done('cloud')?0:(plan?.cloud?.count??0);
  const noWork=!!plan&&!totalLocal&&!totalCloud;
  const changed=Object.keys(versions).length>0;
  const blocked=groups.some((g:any)=>g.blockers.length);
  const needUpgrade=totalCloud>0&&plan?.cloud?.upgrade&&!previous?.upgradeAccepted;
  const needPermanent=q.mode==='purge';
  const canRun=!pending&&!changed&&!blocked&&!noWork&&(!needPermanent||permanent)&&(!needUpgrade||upgrade);
  function toggleVersion(row:any,version:string,checked:boolean){
    const original=row.versions.filter((v:any)=>v.selected).map((v:any)=>v.id);
    const current=versions[row.id]??original;
    setVersions(old=>({...old,[row.id]:checked?[...new Set([...current,version])]:current.filter((v:string)=>v!==version)}));
    setPermanent(false);setUpgrade(false);
  }
  const scopeAvailable=(s:string)=>s==='local'?initial.hasLocal:s==='cloud'?connected&&initial.hasCloud:connected&&initial.hasLocal&&initial.hasCloud;
  const wrongVersion=previous?.error?.code==='stale_plan';
  const warning=<div className="other-device-note"><b>{t('otherDevices')}</b> {t(q.scope==='local'?'otherNoChange':q.mode==='restore'?'remoteRestoreHint':q.kind==='bin'?'otherBinImpact':'otherCloudImpact')}</div>;
  return <dialog className="removal-dialog" ref={dialog} aria-labelledby="removal-title" onCancel={e=>{e.preventDefault();if(!pending)onClose();}}>
    <header className="card-title"><h2 id="removal-title" tabIndex={-1} ref={title}>{t(plan?'reviewRemoval':q.kind==='bin'?'manageBinCopy':'removeChats')}</h2><button disabled={pending} onClick={onClose}>{t('close')}</button></header>
    {!plan?<><p>{initial.titles?.join(' · ')}</p>
      {q.kind==='live'?<>
        <fieldset className="remove-options"><legend>1. {t('deleteWhere')}</legend>{scopes.map(s=><label key={s}><input type="radio" name="place" checked={q.scope===s} disabled={pending||!scopeAvailable(s)} onChange={()=>setQ({...q,scope:s})}/>{t(scopeKey(s))}</label>)}</fieldset>
        {(!initial.hasLocal||!initial.hasCloud||!connected)&&<p className="muted">{t(!connected?'deleteOffline':!initial.hasLocal?'cloudOnlyRemoval':'localOnlyRemoval')}</p>}
        <fieldset className="remove-options"><legend>2. {t('deleteHow')}</legend>{['trash','purge'].map(m=><label key={m}><input type="radio" name="method" checked={q.mode===m} disabled={pending} onChange={()=>setQ({...q,mode:m})}/>{t(modeKey(m))}</label>)}</fieldset>
        <p>{t(q.mode==='trash'?'binPolicy':'permanentPolicy')}</p>
      </>:<p><b>{t(scopeKey(q.scope))} · {t(modeKey(q.mode))}</b><small>{t('onlyBinCopy')}</small></p>}
      {warning}
    </>:<>
      <p className="preview-state">{t(scopeKey(q.scope))} · {t(modeKey(q.mode))} · {t('removalPreviewOnly')}</p>
      {previous&&<div className="warning-box">{t('retryOnlyRemaining')}{previous.sides.filter((s:any)=>s.status==='done').map((s:any)=><small key={s.home??s.side}>{t('sideDone')} · {s.home??t('cloud')}</small>)}</div>}
      {warning}
      {!!plan.selected.length&&<details><summary>{t('directSelections')} ({plan.selected.length})</summary><ul>{plan.selected.map((r:any)=><li key={r.id}>{r.title} · {r.project} · {t(r.local?(r.remote?'bothCopies':'thisDevice'):'cloud')}{q.scope==='local'&&!r.local||q.scope==='cloud'&&!r.remote?' · '+t('outsideRemoval'):''}</li>)}</ul></details>}
      {groups.map((g:any)=><section key={g.home} className="removal-section"><h3>{t('thisDevice')} · {plan.device}</h3>
        {g.binPath&&<div><b>{t('binStorageFolder')}</b><code>{g.binPath}</code><small>{t('nativeHistoryLocation')}</small></div>}<code>{g.home}</code>{g.entries?.length>0&&<p>{t('sharingEntries')} {g.entries.map(t).join(' + ')}</p>}
        {q.kind==='bin'&&<p>{t('onlyBinCopy')}</p>}{(q.kind==='live'||q.mode==='restore')&&<p>{t('closeBeforeLocal')}</p>}
        <ul>{g.rows.map((r:any)=><li key={r.id}><b>{r.title}</b> · {t(r.kind==='background'?'backgroundChats':'mainChats')} · {r.originProject?.name??'—'}{r.indexOnly&&<small>{t('indexOnlyRemoval')}</small>}</li>)}</ul>
        <p>{t('listedFilesSize')} <b>{size(g.bytes)}</b> · {t(q.mode==='trash'?'binUsesSpace':q.mode==='purge'?'fileBytesHint':'restoreCopy')}</p>
        {!!g.blockers.length&&<div className="warning-box"><b>{t('trash_dependencies')}</b><ul>{g.blockers.map((b:any)=><li key={b.id}>{b.title}</li>)}</ul>
          <button disabled={pending||!!previous} onClick={()=>refresh({...q,includeDependents:true})}>{t('includeAndReview')}</button></div>}
        <details><summary>{t('historyFiles')} ({g.files.filter((f:any)=>f.kind==='history').length})</summary>{g.files.filter((f:any)=>f.kind==='history').map((f:any)=><div key={f.path}><code>{g.binPath&&q.mode==='purge'?g.binPath+'/'+f.saved:f.path}</code><small>{size(f.bytes)}{g.binPath&&q.mode==='purge'?' · '+t('originalLocation')+' '+f.path:''}</small></div>)}</details>
        <details open={g.assets.length>0}><summary>{t('attachments')} ({g.assets.length})</summary>{g.assets.map((a:any)=><div className="removal-resource" key={a.path}><code>{g.binPath&&q.mode==='purge'&&a.disposition==='remove'?g.binPath+'/'+g.files.find((f:any)=>f.path===a.path)?.saved:a.path}</code><small>{g.binPath&&a.disposition==='remove'?t('originalLocation')+' '+a.path+' · ':''}{t(a.disposition==='remove'?modeKey(q.mode):'trash_'+a.disposition)}{a.bytes?' · '+size(a.bytes):''}{a.sharedWith?.length?' · '+a.sharedWith.map((r:any)=>r.title).join(' / '):''}</small></div>)}</details>
      </section>)}
      {plan.cloud&&!done('cloud')&&<section className="removal-section"><h3>{t('currentSpace')} · {plan.bucket}</h3><code>{plan.space}</code>
        {!previous&&<p>{t('chooseVersionsHint')}</p>}<p>{t('cloudFreeEstimate')} <b>{size(plan.cloud.freeBytes)}</b>{q.mode==='trash'?' · '+t('binUsesSpace'):''}</p>
        {plan.cloud.items.map((r:any)=><div className="removal-version-group" key={r.id}><h3>{r.title}</h3><small>{r.project??''}</small>
          {r.versions.map((v:any)=><div className="removal-version" key={v.id}><label className="check"><input type="checkbox" checked={(versions[r.id]??r.versions.filter((a:any)=>a.selected).map((a:any)=>a.id)).includes(v.id)} disabled={pending||!!previous} onChange={e=>toggleVersion(r,v.id,e.target.checked)}/>
            <span><b>{dateLabel(v.at,locale)}</b> · {v.device||'—'} · {size(v.bytes)} {v.current&&<b>{t('currentVersion')}</b>} <code>{v.id.slice(0,12)}</code></span></label>
            <details><summary>{v.files.length} {t('conversations')} · {v.files.reduce((n:number,f:any)=>n+f.assets.length,0)} {t('attachments')}</summary>
              {v.files.map((f:any)=><div className="removal-resource" key={f.id}><b>{f.title}</b> {f.kind&&' · '+t(f.kind==='background'?'backgroundChats':'mainChats')} · {f.project??''}
                {f.assets.map((a:any,i:number)=><div key={i}><code>{a.path}</code><small>{t('assetDecision_'+a.disposition)} · {size(a.bytes)}{a.sharedWith?.length?' · '+[...new Set(a.sharedWith.map((ref:any)=>ref.title))].join(' / '):''}</small></div>)}</div>)}
            </details></div>)}
          {!changed&&<p className="cloud-next"><b>{t('availableAfter')}</b> {r.nextTips.length?r.nextTips.map((v:any)=>dateLabel(v.at,locale)+' · '+(v.device??'')+' · '+v.id.slice(0,8)).join(' / '):t('noActiveVersion')}{r.nextTips.length>1&&<small>{t('branchesRemain')}</small>}</p>}
        </div>)}
      </section>}
      <CopyList items={plan.retained} t={t} locale={locale}/>
      {q.scope==='local'&&!plan.cloudChecked&&<p className="muted">{t('uninspectedCloud')}</p>}
      {q.scope==='cloud'&&<p>{t('localCopiesRetained')}</p>}
      {needUpgrade&&<label className="check warning-box"><input type="checkbox" checked={upgrade} onChange={e=>setUpgrade(e.target.checked)}/>{t('upgradeSpaceConsent')}</label>}
      {needPermanent&&<label className="check warning-box"><input type="checkbox" checked={permanent} onChange={e=>setPermanent(e.target.checked)}/>{t('permanentConsent')}</label>}
    </>}
    {pending&&<div className="flow-activity" role="status"><progress/>{t('readingRemoval')}</div>}
    {changed&&<p className="warning-box" role="status">{t('versionSelectionChanged')}</p>}
    {noWork&&<p role="status">{t('nothing_to_remove')}</p>}
    {error&&<div role="alert" className="notice error"><span>{t(error.code??'operation_failed')} {error.detail}</span>
      {['cloud_cleanup_pending','trash_recovery_required','storage_not_connected'].includes(error.code)&&<button onClick={()=>onRepair(error.code==='storage_not_connected'?'settings':'backups')}>{t(error.code==='storage_not_connected'?'settings':'backups')}</button>}</div>}
    <footer className="modal-actions">
      <button disabled={pending} onClick={onClose}>{t('cancel')}</button>
      {!plan?<button className="primary" disabled={pending} onClick={()=>refresh(q)}>{t('showRemovalList')}</button>:<>
        {!previous&&<button disabled={pending} onClick={reset}>{t('changeDeleteOptions')}</button>}
        {previous&&wrongVersion&&<button disabled={pending} onClick={()=>refresh(q,true)}>{t('reviewChangedRemoval')}</button>}
        {changed?<button className="primary" disabled={pending} onClick={()=>refresh({...q,versions:{...q.versions,...versions}})}>{t('recomputeRemoval')}</button>:
        <button className={q.mode==='purge'?'permanent-action':'primary'} disabled={!canRun} onClick={()=>onExecute(plan,permanent,upgrade)}><ConfirmationLabel t={t} mode={q.mode} local={totalLocal} cloud={totalCloud}/></button>}
      </>}
    </footer>
  </dialog>;
}

export function RemovalResult({job,t,onRetry,onBackups,onDismiss,busy}:any){
  if(!job)return null;
  const running=busy&&['checking','running'].includes(job.status),interrupted=job.status==='interrupted'||!busy&&['checking','running'].includes(job.status);
  const label=interrupted?'removeInterrupted':({checking:'checkingRemoval',running:'removingNow',partial:'removePartial',attention:'removeAttention',completed:'removeComplete',replaced:'replacedReview'} as any)[job.status];
  return <section className={'task-feedback '+(running?'active':job.status==='completed'?'success':'attention')} aria-label={t('removeChats')}>
    <div className="task-heading"><strong role="status">{t(label)} · {t(modeKey(job.mode))}</strong>{!running&&onDismiss&&<button onClick={onDismiss} aria-label={t('close')}>×</button>}</div>
    {running&&<progress/>}<small>{job.titles?.join(' · ')}</small>
    {job.sides.map((s:any)=><p key={s.home??s.side}><b>{t(s.side==='local'?'thisDevice':'currentSpace')} · {t(({done:'sideDone',failed:'sideFailed',cleanup:'sideCleanup',localCleanup:'sideLocalCleanup',running:interrupted?'removeInterrupted':'sideRunning',waiting:'sideWaiting'} as any)[s.status])}</b> · {s.count} {t(s.side==='local'?'chatCountUnit':'backupVersions')}
      {s.progress&&s.status==='running'&&<small> · {s.progress[0]}/{s.progress[1]} {t('cloudObjects')}</small>}{s.home&&<small> {s.home}</small>}{s.error&&<small className="reason">{t(s.error.code)} {s.error.detail}</small>}</p>)}
    {job.error&&!job.sides.some((s:any)=>s.error)&&<p>{t(job.error.code)}</p>}
    <div className="actions">{!running&&['attention','partial','checking','running','interrupted'].includes(job.status)&&<button className="primary" disabled={busy} onClick={()=>onRetry(job.id)}>{t('reviewRemaining')}</button>}
      {onBackups&&<button disabled={busy} onClick={onBackups}>{t('backups')}</button>}</div>
  </section>;
}

export function RemovalBins({data,connected,t,date,busy,open,resume,settings}:any){
  if(!data)return <p role="status">{t('loadingBins')}</p>;
  return <>{['local','cloud'].map(side=>{
    const local=side==='local',items=local?data.local:data.cloud.bins;
    return <section key={side} className="card"><h2>{t(local?'localTrash':'cloudBin')}</h2><p>{t(local?'localBinHint':'cloudBinHint')}</p>
      {!local&&!connected&&<button onClick={settings}>{t('configureRemovalStorage')}</button>}
      {!local&&data.cloudError&&<p role="alert">{t(data.cloudError.code)}</p>}
      {!local&&data.cloud.pending&&<div className="warning-box"><p>{t('cloud_cleanup_pending')}</p><button disabled={busy} onClick={()=>resume(data.cloud.pending.id,data.storageKey)}>{t('finishConfirmedCloud')}</button></div>}
      {!items.length&&(local||connected&&!data.cloudError)&&<p>{t('noBinItems')}</p>}
      {items.map((b:any)=>{
        const label=local?b.rows.map((r:any)=>r.title).join(' · '):b.title,base={binId:b.id,ids:local?b.ids:[b.logicalId],scope:side,titles:[label]};
        return <div className="backup-row" key={b.id+(b.logicalId??'')}><div><b>{label}</b><small>{date(b.at??b.createdAt)} · {local?b.home:b.count+' '+t('backupVersions')}</small>{local&&<small>{t('trashStatus_'+b.status)}</small>}</div>
          {(!local||!['restored','purging'].includes(b.status))&&<button disabled={busy} onClick={()=>open({...base,mode:'restore'})}>{t('restoreCopy')}…</button>}
          {(!local||['removed','restored','purging'].includes(b.status))&&<button className="danger-button" disabled={busy} onClick={()=>open({...base,mode:'purge'})}>{t('permanentDelete')}…</button>}
        </div>;
      })}</section>;
  })}</>;
}
