import React,{useEffect,useRef,useState} from 'react';
import {DetectionPanel,EntryFields} from './Environment';
import {Select} from './Select';
import {SyncPlan} from './SyncPlan';

export function TransferFlow({request,rows,cfg,setConfig,call,refreshRows,t,size,onClose,onStart,onCopies}:any){
 const [draft,setDraft]=useState(()=>structuredClone(cfg));
 const [targets,setTargets]=useState<string[]>(request.targets??['desktop']);
 const [info,setInfo]=useState<Record<string,any>>({});
 const [report,setReport]=useState<any>(null),[plan,setPlan]=useState<any>(null);
 const [pending,setPending]=useState(''), [error,setError]=useState<any>(null);
 const [children,setChildren]=useState(false),[limit,setLimit]=useState(500),[incomplete,setIncomplete]=useState(false);
 const [pathsApplied,setPathsApplied]=useState(false);
 const [connections,setConnections]=useState<Record<string,string>>({});
 const [editing,setEditing]=useState(''), lock=useRef(false);
 const direction=request.direction, uploading=direction!=='download', importing=direction!=='upload'||!!request.version;
 const entries=['desktop','cli','ide'], chosen=rows.filter((r:any)=>request.ids.includes(r.id));
 const needed=chosen.filter((r:any)=>direction==='download'?r.remote:direction==='upload'?r.local:true);
 const projects=[...new Map<string,any>(needed.filter((r:any)=>(!r.busy||direction==='download')&&(direction!=='download'||r.continuation!==false)).map((r:any)=>[r.projectId,r])).values()];
 const homeGroups=[...new Set<string>(targets.map(e=>draft.targets[e]?.home).filter(Boolean))];
 const title=t(direction==='upload'?'uploadCloud':direction==='download'?'importLocal':'both');
 const requiresChoice=(r:any,h:string)=>!Object.prototype.hasOwnProperty.call(draft.nativeBindings?.[r.projectId]??{},h);
 const databases=Object.fromEntries(targets.filter(e=>info[e]).map(e=>[draft.targets[e]?.home,info[e]]));
 const missingEntry=targets.find(e=>!info[e]||info[e].error||info[e].binary!==draft.targets[e]?.binary||info[e].home!==draft.targets[e]?.home);
 const staleChoice=projects.some(r=>homeGroups.some(h=>{const value=draft.nativeBindings?.[r.projectId]?.[h];return value&&(!databases[h]?.supported||!databases[h]?.projects?.some((p:any)=>p.id===value));}));
 const invalid=importing?(!targets.length?'target_required':missingEntry?'resolveEntry':staleChoice?'destination_project_missing':projects.some(r=>!draft.bindings[r.projectId])?'project_required':projects.some(r=>homeGroups.some(h=>requiresChoice(r,h)))?'chooseDestination':''):'';
 async function run(label:string,fn:()=>Promise<any>){
  if(lock.current)return;lock.current=true;setPending(label);setError(null);
  try{await fn();}catch(e:any){setError(e);}finally{lock.current=false;setPending('');}
 }
 async function inspect(next=draft){
  const checked=await call('destinationInfo',{targets:next.targets});setInfo(checked);return checked;
 }
 async function rebuild(approved:string[]=[],newPaths=connections,initial=draft){
  const result=await call('preview',{ids:request.ids,copyChoice:request.copyChoice,direction,targets,chosenVersion:request.version??null,includeDescendants:children,uploadLimitMiB:limit,allowIncomplete:incomplete,approvedAttachments:approved,replacements:newPaths});
  result.displayProjects=Object.fromEntries(projects.map(r=>[r.projectId,Object.fromEntries(targets.map(entry=>{
    const value=initial.nativeBindings?.[r.projectId]?.[initial.targets[entry]?.home];
    return [entry,info[entry]?.projects?.find((p:any)=>p.id===value)?.name??t('historyOnly')];
  }))]));
  setPlan(result);setConnections(newPaths);
 }
 useEffect(()=>{void run(importing?'checkingEntries':'preparingPreview',async()=>{
  if(!importing){await rebuild();return;}
  const checked=await inspect();
  if(targets.some(e=>checked[e]?.error))setReport(await call('detectPaths'));
 });},[]);
 function setBinding(projectId:string,folder:string){setDraft((old:any)=>({...old,bindings:{...old.bindings,[projectId]:folder}}));}
 function selectProject(source:string,home:string,id:string){
  const project=databases[home]?.projects?.find((p:any)=>p.id===id);
  setDraft((old:any)=>({...old,nativeBindings:{...old.nativeBindings,[source]:{...old.nativeBindings?.[source],[home]:id}},
   bindings:{...old.bindings,[source]:project?.folders?.length===1?project.folders[0]:old.bindings[source]??''}}));
 }
 async function close(){if(lock.current)return;if(plan)await call('discardPlan',{token:plan.token});onClose();}
 const infoFor=(entry:string)=>info[entry]?.binary===draft.targets[entry]?.binary&&info[entry]?.home===draft.targets[entry]?.home?info[entry]:null;
 const activity=pending&&<div role="status" className="flow-activity"><progress/><strong>{t(pending)}</strong></div>;
 async function recheck(keys:string[]=approvedKeys()){
  const result=await call('refresh');refreshRows(result);
  if(result.cloudError)throw result.cloudError;
  await rebuild(keys);
 }
 function approvedKeys():string[]{return plan?.selection?.approvedAttachments??[];}
 const issue=error&&<div className="notice error" role="alert"><strong>{t(error.code??'operation_failed')}</strong>{error.detail&&<details><summary>{t('details')}</summary>{error.detail}</details>}{request.copyChoice&&error.code==='stale_plan'?<button onClick={()=>{onCopies(request.ids[0]);}}>{t('inspectCopies')}</button>:['stale_plan','cloud_check_failed','storage_unavailable'].includes(error.code)&&<button disabled={!!pending} onClick={()=>run('refreshing',()=>recheck())}>{t('refreshAndRetry')}</button>}</div>;
 return <>
 {plan?<SyncPlan key={plan.token} plan={plan} cfg={draft} busy={!!pending} t={t} size={size} feedback={<>{activity}{issue}{plan.items.filter((i:any)=>i.excludedReason==='duplicate_identity').map((i:any)=><button className="primary" key={i.id} onClick={()=>run('checkingEntries',async()=>{await call('discardPlan',{token:plan.token});onCopies(i.id);})}>{t('inspectCopies')} · {i.title}</button>)}</>} onClose={()=>void close()}
   onBack={()=>run('checkingEntries',async()=>{await call('discardPlan',{token:plan.token});setPlan(null);if(importing)await inspect();})}
   onRebuild={(keys:string[])=>run('preparingPreview',()=>recheck(keys))}
   onLocate={(key:string,keys:string[])=>run('preparingPreview',async()=>{const path=await call('pickImage');if(path)await rebuild(keys,{...connections,[key]:path});})}
   onUndo={(key:string,keys:string[])=>run('preparingPreview',async()=>{const paths={...connections};delete paths[key];await rebuild(keys,paths);})}
   onExecute={(large:boolean,omitted:any,onlyEligible:boolean)=>run('stageCheck',async()=>{onStart(plan,large,omitted,onlyEligible);})}/>
 :<div className="modal-backdrop"><section className="modal flow" role="dialog" aria-modal="true" aria-label={title}>
 <div className="card-title"><h2>{title}</h2><button disabled={!!pending} onClick={()=>void close()}>{t('close')}</button></div>
 <fieldset disabled={!!pending} className="flow-fields"><p>{t('selectedScope')} <strong>{needed.length} / {chosen.length}</strong> · {needed.length===1?needed[0].title:t('conversations')}</p>
 {chosen.length>needed.length&&<p className="warning-box">{t('skippedScope')} {chosen.filter((r:any)=>!needed.includes(r)).map((r:any)=>r.title).join('、')}</p>}
 {importing&&<>
 <div className="card-title"><h3>1. {t('chooseApp')}</h3><button disabled={!!pending} onClick={()=>run('checkingEntries',async()=>setReport(await call('detectPaths')))}>{t('detectEnvironment')}</button></div>
 {pathsApplied&&<p className="notice" role="status">{t('detectedApplied')}</p>}
 <div className="entry-choices">{entries.map(entry=><label className="entry-choice" key={entry}><input type="checkbox" checked={targets.includes(entry)} onChange={e=>setTargets(e.target.checked?[...targets,entry]:targets.filter(v=>v!==entry))}/><b>{t(entry)}</b><small>{t(infoFor(entry)?.error??(infoFor(entry)?'configured':'needsCheck'))}</small></label>)}</div>
 {targets.some(e=>info[e]?.manualOpen)&&<p className="warning-box">{t('launchManualHint')}</p>}
 {targets.map(entry=><div key={entry}>{infoFor(entry)&&!infoFor(entry)?.error&&editing!==entry&&<button className="text-button" onClick={()=>setEditing(entry)}>{t('editPaths')} · {t(entry)}</button>}{(infoFor(entry)?.error||editing===entry||!infoFor(entry))&&<div className="setup-repair"><strong>{t(entry)} · {t(infoFor(entry)?.error??'needsCheck')}</strong>
 <EntryFields t={t} entry={entry} target={draft.targets[entry]} pick={call} change={v=>setDraft({...draft,targets:{...draft.targets,[entry]:v}})}/>
 <button disabled={!!pending} onClick={()=>run('checkingEntries',async()=>{await inspect();setEditing('');})}>{t('checkAgain')}</button></div>}</div>)}
 {missingEntry&&targets.some(e=>infoFor(e)&&!infoFor(e)?.error)&&<button onClick={()=>setTargets(targets.filter(e=>infoFor(e)&&!infoFor(e)?.error))}>{t('useReadyEntries')}</button>}
 <h3>2. {t('localProject')}</h3><small>{t('userHandoff')}</small>
 {projects.map(r=><section className="setup-project" key={r.projectId}><strong>{t('originProject')} · {r.originProject?.name||r.project}</strong>
 {homeGroups.map(home=>{
   const catalog=databases[home],value=draft.nativeBindings?.[r.projectId]?.[home],selectable=catalog?.supported?catalog.projects:[];
   const proposed=selectable.filter((p:any)=>p.name===r.originProject?.name);
   return <div key={home}><small>{targets.filter(e=>draft.targets[e]?.home===home).map(t).join(' + ')}</small>
     <Select label={t('destinationProject')} value={value===undefined?'__choose__':value||'__history__'} onChange={id=>{if(id!=='__choose__')selectProject(r.projectId,home,id==='__history__'?'':id);}}
       options={[{value:'__choose__',label:t('chooseDestination')},...selectable.map((p:any)=>({value:p.id,label:p.name+(p.roots[0]?' · '+p.roots[0]:' · '+p.id.slice(0,8))})),{value:'__history__',label:t('historyOnly')}]}/>
     {proposed.length===1&&value===undefined&&<button className="text-button" onClick={()=>selectProject(r.projectId,home,proposed[0].id)}>{t('chooseMatching')} {proposed[0].name}</button>}
     {(!selectable.length||value==='')&&<small>{t('historyOnlyHint')}</small>}
     {value&&<small>{t('selectedDestination')} {selectable.find((p:any)=>p.id===value)?.name??t('destination_project_missing')}</small>}
   </div>;
 })}
 <label className="field"><span>{t('projectPath')}</span><input value={draft.bindings[r.projectId]??''} placeholder={t('workingFolderHint')} onChange={e=>setBinding(r.projectId,e.target.value)}/></label>
 <div className="actions"><button onClick={()=>run('chooseFolder',async()=>{const dir=await call('pickDirectory');if(dir)setBinding(r.projectId,dir);})}>{t('bind')}</button>
 <button onClick={()=>run('chooseFolder',async()=>{setBinding(r.projectId,await call('createWorkspace',{projectId:r.projectId}));})}>{t('createWorkingFolder')}</button></div>
 </section>)}
 </>}
 {uploading&&<section className="setup-project"><label className="check"><input type="checkbox" checked={children} onChange={e=>setChildren(e.target.checked)}/>{t('includeDescendants')}</label>
 <label className="field">{t('uploadLimit')}<input type="number" min="1" value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
 {direction==='upload'&&<label className="check"><input type="checkbox" checked={incomplete} onChange={e=>setIncomplete(e.target.checked)}/>{t('incomplete')}</label>}</section>}
 {activity}{issue}{invalid&&<p className="warning-box">{t(invalid)}</p>}
 <div className="modal-actions"><button disabled={!!pending} onClick={()=>void close()}>{t('cancel')}</button><button className="primary" disabled={!!pending||!!invalid||!needed.length} onClick={()=>run('preparingPreview',async()=>{
  if(importing){await setConfig(draft);await call('validateFolders',{projectIds:projects.map(p=>p.projectId)});}
  await rebuild();
 })}>{t('reviewAction')}</button></div>
 </fieldset></section></div>}
 {report&&<DetectionPanel inFlow report={report} cfg={draft} t={t} onRetry={async()=>{const next=await call('detectPaths');setReport(next);return next;}} onClose={()=>setReport(null)} onApply={async(next:any)=>{await setConfig(next);setDraft(next);await inspect(next);setPathsApplied(true);setReport(null);}}/>}
 </>;
}
