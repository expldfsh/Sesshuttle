import React,{useState} from 'react';

export function SyncPlan({plan,cfg,busy,t,size,feedback,onClose,onBack,onLocate,onUndo,onRebuild,onExecute}:any){
 const [omitted,setOmitted]=useState<string[]>([]);
 const [approved,setApproved]=useState<string[]>(plan.selection?.approvedAttachments??[]);
 const [large,setLarge]=useState(false);
 const rows=plan.items.flatMap((item:any)=>item.files);
 const count=new Set(rows.map((r:any)=>r.id)).size;
 const changed=JSON.stringify([...approved].sort())!==JSON.stringify([...(plan.selection?.approvedAttachments??[])].sort());
 const runnable=plan.items.filter((item:any)=>!['skip','busy','conflict','blocked'].includes(item.action));
 const hasUpload=plan.items.some((i:any)=>['upload','upload_import','preserve_conflict','resolve'].includes(i.action));
 const hasImport=plan.items.some((i:any)=>i.targets.length);
 const blocked=plan.items.some((item:any)=>{
   if(item.action==='blocked'||(item.continuation===false&&item.targets.length))return true;
   if(!runnable.includes(item))return false;
   if(plan.allowIncomplete&&['upload','preserve_conflict'].includes(item.action))return false;
   return item.attachmentReview.blockingIssues.length||item.attachmentReview.optional.some((a:any)=>!omitted.includes(a.key));
 });
 const disabled=busy||changed||blocked||!runnable.length||plan.overLimit||(plan.largeUpload&&!large);
 const destination=[...new Set<string>(runnable.flatMap((i:any)=>i.targets))].map(t).join(' + ');
 return <div className="modal-backdrop"><section className="modal sync-plan" role="dialog" aria-modal="true" aria-label={t('reviewAction')}>
  <div className="card-title"><h2>{t('reviewAction')}</h2><button disabled={busy} onClick={onClose}>{t('close')}</button></div>
  <p className="preview-state">{t('previewOnly')} · {plan.ids.length} {t('directSelections')} · {count} {t('actualScope')}</p>
  {hasImport&&<p>{t('previewHint')}</p>}
  {hasUpload&&<div className="upload-summary">
    <p>{t('uploadUpperBound')} <strong>{size(plan.uploadBytes)}</strong> / {t('uploadLimit')} {size(plan.uploadLimitBytes)}</p>
    <details><summary>{t('capacityDetails')}</summary><p>{t('cloudUsage')} {size(plan.cloudBytes)} · {t('newUpload')} {size(plan.chunkUploadBytes)} · {t('metadataReserve')} {size(plan.metadataReserve)}</p>
    <p>{t('projectedCloud')} {size(plan.cloudBytes+plan.uploadBytes)}</p><small>{t('quotaHint')}</small></details>
    {plan.overLimit&&<p role="alert">{t('upload_limit')}</p>}
    {plan.largeUpload&&<label className="check"><input type="checkbox" checked={large} onChange={e=>setLarge(e.target.checked)}/>{t('confirmLarge')} ({size(plan.uploadBytes)})</label>}
  </div>}
  <div className="scope-list">{plan.items.map((item:any)=><section className="scope-item" key={item.id}>
   <div className="card-title"><strong>{item.title}</strong><span>{t(item.action)} · {size(item.bytes)}</span></div>
   {item.targets.map((entry:string)=><details key={entry} className="destination-summary"><summary>{t(entry)} → {plan.displayProjects?.[item.projectId]?.[entry]}</summary><small>{t('historyFolder')}</small><code>{cfg.targets[entry]?.home}</code><small>{t('projectPath')}</small><code>{cfg.bindings[item.projectId]}</code></details>)}
   {item.issues.length>0&&<p className="warning-box">{item.issues.map(t).join(' · ')}</p>}
   {item.continuation===false&&<p>{t('missing_rollout')}</p>}
   {item.files.map((file:any)=><div className="scope-file" key={file.id+file.reason}>
    <strong>{file.title}</strong><small>{t(file.kind==='background'?'backgroundChats':'mainChats')} · {t(file.reason)} · {file.originProject?.name||t('unassignedProject')} · {size(file.bytes)}</small>
    {!!file.missingDependencies?.length&&<div className="warning-box">{t('findParent')}{file.missingDependencies.map((id:string)=><code key={id}>{id}</code>)}</div>}
    {!!file.omittedAttachments?.length&&<details><summary>{t('priorMissingImages')} ({file.omittedAttachments.length})</summary>{file.omittedAttachments.map((a:any)=><code key={a.path}>{a.path}</code>)}</details>}
    {!!file.attachments?.length&&<details open={file.attachments.some((a:any)=>a.status!=='included')}><summary>{file.attachments.length} {t('attachments')}</summary>
    {file.attachments.map((a:any)=><div className="attachment-row" key={a.key}>
     <code>{a.path}</code><span>{t('attachment_'+a.status)} · {size(a.bytes)}</span>
     {a.replacementPath&&<small>{t('replacementFile')} <code>{a.replacementPath}</code></small>}
     {plan.selection.replacements?.[a.key]&&<button disabled={busy} onClick={()=>onUndo(a.key,approved)}>{t('replacementUndo')}</button>}
     {a.readError&&<small>{t('systemDetail')} {a.readError}</small>}
     {item.attachmentReview.optional.some((v:any)=>v.key===a.key)&&<label className="check"><input type="checkbox" checked={omitted.includes(a.key)} onChange={e=>setOmitted(e.target.checked?[...new Set([...omitted,a.key])]:omitted.filter(k=>k!==a.key))}/>{t('acceptMissingImage')}</label>}
     {a.external&&!a.replacementPath&&['included','approval_required'].includes(a.status)&&(a.role==='preserve'||!['download','resolve'].includes(item.action))&&<label className="check"><input type="checkbox" checked={approved.includes(a.key)} onChange={e=>setApproved(e.target.checked?[...new Set([...approved,a.key])]:approved.filter(k=>k!==a.key))}/>{t('approveAttachment')}</label>}
     {a.status!=='included'&&a.status!=='unsafe'&&<button disabled={busy} onClick={()=>onLocate(a.key,approved)}>{t('locateImage')}</button>}
    </div>)}</details>}
   </div>)}
  </section>)}</div>
  {changed&&<p>{t('rebuildHint')}</p>}
  {blocked&&!changed&&<p role="alert" className="warning-box">{t('resolvePreview')}</p>}
  {!runnable.length&&<p role="alert">{t('nothingEligible')}</p>}
  {feedback}
  <div className="modal-actions"><button disabled={busy} onClick={onBack}>{t('editScope')}</button><button disabled={busy} onClick={()=>onRebuild(approved)}>{t(changed?'rebuildPreview':'checkAgain')}</button>
   <button className="primary" disabled={disabled} onClick={()=>onExecute(large,omitted)}>{hasImport?(hasUpload?t('confirmBoth'):t('confirmImport'))+' '+destination:t('confirmUploadCount')+' '+runnable.length+' '+t('conversations')}</button>
  </div>
 </section></div>;
}
