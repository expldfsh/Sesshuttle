import React,{useState} from 'react';

export function SyncPlan({plan,cfg,busy,t,size,feedback,onClose,onBack,onLocate,onUndo,onRebuild,onExecute}:any){
 const [omitted,setOmitted]=useState<Record<string,Record<string,string[]>>>({});
 const [approved,setApproved]=useState<string[]>(plan.selection?.approvedAttachments??[]);
 const [large,setLarge]=useState(false);
 const runnable=plan.items.filter((item:any)=>!item.excludedReason);
 const excluded=plan.items.filter((item:any)=>item.excludedReason);
 const count=new Set(runnable.flatMap((i:any)=>i.files.map((f:any)=>f.id))).size;
 const changed=JSON.stringify([...approved].sort())!==JSON.stringify([...(plan.selection?.approvedAttachments??[])].sort());
 const hasUpload=runnable.some((i:any)=>['upload','upload_import','preserve_conflict','resolve'].includes(i.action));
 const hasImport=runnable.some((i:any)=>i.targets.length);
 const remaining=runnable.filter((item:any)=>item.attachmentReview.optional.some((a:any)=>!omitted[item.id]?.[a.role]?.includes(a.key)));
 const disabled=busy||changed||remaining.length>0||!runnable.length||plan.overLimit||(plan.largeUpload&&!large);
 const destination=[...new Set<string>(runnable.flatMap((i:any)=>i.targets))].map(t).join(' + ');
 function accept(item:string,role:string,keys:string[],include:boolean){
   setOmitted(old=>{
     const current=old[item]?.[role]??[];
     const next=include?[...new Set([...current,...keys])]:current.filter(k=>!keys.includes(k));
     return {...old,[item]:{...old[item],[role]:next}};
   });
 }
 const confirm=excluded.length?t(plan.direction==='upload'?'onlyUploadEligible':plan.direction==='download'?'onlyImportEligible':'onlySyncEligible').replace('{n}',String(runnable.length)):
   hasImport?(hasUpload?t('confirmBoth'):t('confirmImport'))+' '+destination:t('confirmUploadCount')+' '+runnable.length+' '+t('conversations');
 return <div className="modal-backdrop"><section className="modal sync-plan" role="dialog" aria-modal="true" aria-label={t('reviewAction')}>
  <div className="card-title"><h2>{t('reviewAction')}</h2><button disabled={busy} onClick={onClose}>{t('close')}</button></div>
  <p className="preview-state">{t('previewOnly')} · {plan.ids.length} {t('directSelections')} · {count} {t('actualScope')}</p>
  {excluded.length>0&&<div className="warning-box" role="status"><b>{t('batchEligibility').replace('{ready}',String(runnable.length)).replace('{blocked}',String(excluded.length))}</b>
    <ul>{excluded.map((i:any)=><li key={i.id}>{i.title} · {t(i.excludedReason==='busy'?'busyReason':i.excludedReason)}</li>)}</ul></div>}
  {hasImport&&<p>{t('previewHint')}</p>}
  {hasUpload&&<div className="upload-summary">
    <p>{t('uploadUpperBound')} <strong>{size(plan.uploadBytes)}</strong> / {t('uploadLimit')} {size(plan.uploadLimitBytes)}</p>
    <details><summary>{t('capacityDetails')}</summary><p>{t('cloudUsage')} {size(plan.cloudBytes)} · {t('newUpload')} {size(plan.chunkUploadBytes)} · {t('metadataReserve')} {size(plan.metadataReserve)}</p>
    <p>{t('projectedCloud')} {size(plan.cloudBytes+plan.uploadBytes)}</p><small>{t('quotaHint')}</small></details>
    {plan.overLimit&&<p role="alert">{t('upload_limit')}</p>}
    {plan.largeUpload&&<label className="check"><input type="checkbox" checked={large} onChange={e=>setLarge(e.target.checked)}/>{t('confirmLarge')} ({size(plan.uploadBytes)})</label>}
  </div>}
  <div className="scope-list">{plan.items.map((item:any)=><section className="scope-item" key={item.id}>
   <div className="card-title"><strong>{item.title}</strong><span>{t(item.excludedReason?'excluded':item.action)} · {size(item.bytes)}</span></div>
   {item.targets.map((entry:string)=><details key={entry} className="destination-summary"><summary>{t(entry)} → {plan.displayProjects?.[item.projectId]?.[entry]}</summary><small>{t('historyFolder')}</small><code>{cfg.targets[entry]?.home}</code><small>{t('projectPath')}</small><code>{cfg.bindings[item.projectId]}</code></details>)}
   {item.issues.length>0&&<p className="warning-box">{item.issues.map(t).join(' · ')}</p>}
   {item.continuation===false&&<p>{t('missing_rollout')}</p>}
   {item.files.map((file:any)=>{
    const keys:string[]=item.attachmentReview.optional.filter((a:any)=>a.role===file.role&&a.sessionId===file.id).map((a:any)=>a.key);
    const accepted=omitted[item.id]?.[file.role]??[];
    return <div className="scope-file" key={file.id+file.reason}>
    <strong>{file.title}</strong><small>{t(file.kind==='background'?'backgroundChats':'mainChats')} · {t(file.reason)} · {file.originProject?.name||t('unassignedProject')} · {size(file.bytes)}</small>
    {!!file.missingDependencies?.length&&<div className="warning-box">{t('findParent')}{file.missingDependencies.map((id:string)=><code key={id}>{id}</code>)}</div>}
    {!!file.omittedAttachments?.length&&<details><summary>{t('priorMissingImages')} ({file.omittedAttachments.length})</summary>{file.omittedAttachments.map((a:any)=><code key={a.path}>{a.path}</code>)}</details>}
    {!item.excludedReason&&keys.length>1&&<label className="check"><input type="checkbox" checked={keys.every(k=>accepted.includes(k))} onChange={e=>accept(item.id,file.role,keys,e.target.checked)}/>{t('acceptConversationImages').replace('{n}',String(keys.length))}</label>}
    {!!file.attachments?.length&&<details open={file.attachments.some((a:any)=>a.status!=='included')}><summary>{file.attachments.length} {t('attachments')}</summary>
    {file.attachments.map((a:any)=><div className="attachment-row" key={a.key}>
     <code>{a.path}</code><span>{t('attachment_'+a.status)} · {size(a.bytes)}</span>
     {a.replacementPath&&<small>{t('replacementFile')} <code>{a.replacementPath}</code></small>}
     {plan.selection.replacements?.[a.key]&&<button disabled={busy} onClick={()=>onUndo(a.key,approved)}>{t('replacementUndo')}</button>}
     {a.readError&&<small>{t('systemDetail')} {a.readError}</small>}
     {!item.excludedReason&&keys.includes(a.key)&&<label className="check"><input type="checkbox" checked={accepted.includes(a.key)} onChange={e=>accept(item.id,file.role,[a.key],e.target.checked)}/>{t('acceptMissingImage')}</label>}
     {a.external&&!a.replacementPath&&['included','approval_required'].includes(a.status)&&(a.role==='preserve'||!['download','resolve'].includes(item.action))&&<label className="check"><input type="checkbox" checked={approved.includes(a.key)} onChange={e=>setApproved(e.target.checked?[...new Set([...approved,a.key])]:approved.filter(k=>k!==a.key))}/>{t('approveAttachment')}</label>}
     {a.status!=='included'&&a.status!=='unsafe'&&<button disabled={busy} onClick={()=>onLocate(a.key,approved)}>{t('locateImage')}</button>}
    </div>)}</details>}
   </div>;})}
  </section>)}</div>
  {changed&&<p>{t('rebuildHint')}</p>}
  {remaining.length>0&&<p role="status" className="warning-box">{t('confirmImagesFor')} {remaining.map((i:any)=>i.title).join(' · ')}</p>}
  {!runnable.length&&<p role="alert">{t('nothingEligible')}</p>}
  {feedback}
  <div className="modal-actions"><button disabled={busy} onClick={onBack}>{t('editScope')}</button><button disabled={busy} onClick={()=>onRebuild(approved)}>{t(changed?'rebuildPreview':'checkAgain')}</button>
   <button className="primary" disabled={disabled} onClick={()=>onExecute(large,omitted,excluded.length>0)}>{confirm}</button>
  </div>
 </section></div>;
}
