import React,{useState}from'react';
export function SyncPlan({plan,cfg,busy,t,size,onClose,onRebuild,onExecute}:any){
 const[approved,setApproved]=useState<string[]>(plan.selection?.approvedAttachments??[]),[large,setLarge]=useState(false);
 const rows=plan.items.flatMap((x:any)=>x.files??[]),unique=new Set(rows.map((r:any)=>r.id));
 const changed=JSON.stringify([...approved].sort())!==JSON.stringify([...(plan.selection?.approvedAttachments??[])].sort());
 const blocked=plan.items.some((x:any)=>x.action==='blocked'||(x.issues?.length&&!(plan.allowIncomplete&&['upload','preserve_conflict'].includes(x.action)))||(x.continuation===false&&x.targets.length));
 const runnable=plan.items.some((x:any)=>!['skip','busy','conflict','blocked'].includes(x.action));
 return <div className="modal-backdrop"><div className="modal sync-plan" role="dialog" aria-modal="true" aria-label={t('preview')}><div className="card-title"><h2>{t('preview')}</h2><button onClick={onClose}>{t('close')}</button></div>
 <p>{t(plan.direction==='upload'?'uploadPreviewHint':'previewHint')}</p>
 <p><strong>{plan.ids?.length??plan.items.length}</strong> {t('directSelections')} · <strong>{unique.size}</strong> {t('actualScope')}</p>
 <div className="upload-summary"><p>{t('cloudUsage')}: <strong>{size(plan.cloudBytes)}</strong></p><p>{t('newUpload')}: <strong>{size(plan.chunkUploadBytes)}</strong> + {t('metadataReserve')}: {size(plan.metadataReserve)}</p><p>{t('uploadUpperBound')}: <strong>{size(plan.uploadBytes)}</strong> / {t('uploadLimit')}: {size(plan.uploadLimitBytes)}</p><p>{t('projectedCloud')}: <strong>{size(plan.cloudBytes+plan.uploadBytes)}</strong></p><small>{t('quotaHint')}</small>{plan.overLimit&&<p role="alert" className="error-text">{t('upload_limit')}</p>}{plan.largeUpload&&<label className="check"><input type="checkbox" checked={large} onChange={e=>setLarge(e.target.checked)}/>{t('confirmLarge')} ({size(plan.uploadBytes)})</label>}</div>
 <div className="scope-list">{plan.items.map((item:any)=><section className="scope-item" key={item.id}><div className="card-title"><strong>{item.title}</strong><span>{t(item.action)} · {size(item.bytes)}</span></div>
 {item.targets?.map((entry:string)=><p key={entry}>{t('localDestination')}: {t(entry)}<code>{cfg.targets[entry]?.home||t('not_configured')}</code><small>{t('projectPath')}: {cfg.bindings[item.projectId]||t('chooseProject')}</small></p>)}
 {item.issues?.length>0&&<p className="warning-box">{item.issues.map(t).join(' · ')}</p>}{item.continuation===false&&<p className="warning-box">{t('missing_rollout')}</p>}
 {(item.files??[]).map((file:any)=><div className="scope-file" key={file.id+file.reason}><div className="card-title"><strong>{file.title}</strong><span>{size(file.bytes)}</span></div><small>{t(file.kind==='background'?'backgroundChats':'mainChats')} · {t(file.reason)} · {file.originProject?.name||t('unassignedProject')}</small><code>{file.id}</code>
 {!!file.attachments?.length&&<details open={file.attachments.some((a:any)=>a.status!=='included')}><summary>{file.attachments.length} {t('attachments')}</summary>{file.attachments.map((a:any)=><div className="attachment-row" key={a.key}><code>{a.path}</code><span className={a.status==='included'?'muted':'amber-text'}>{t('attachment_'+a.status)} · {size(a.bytes)}</span>{a.external&&['included','approval_required'].includes(a.status)&&(a.role==='preserve'||!['download','resolve'].includes(item.action))&&<label className="check"><input type="checkbox" checked={approved.includes(a.key)} onChange={e=>setApproved(e.target.checked?[...new Set([...approved,a.key])]:approved.filter(k=>k!==a.key))}/>{t('approveAttachment')}</label>}</div>)}</details>}
 </div>)}
 </section>)}</div>
 {changed&&<p className="warning-box">{t('rebuildHint')}</p>}{blocked&&!changed&&<p className="warning-box">{t('planBlockedHint')}</p>}
 <div className="modal-actions"><button onClick={onClose}>{t('cancel')}</button>{changed&&<button className="primary" disabled={busy} onClick={()=>onRebuild(approved)}>{t('rebuildPreview')}</button>}<button className="primary" disabled={busy||changed||blocked||!runnable||plan.overLimit||(plan.largeUpload&&!large)} onClick={()=>onExecute(large)}>{t(plan.direction==='upload'?'confirmUpload':'confirmSync')}</button></div>
 </div></div>;
}
