import React, {useState} from 'react';

type Props = {target:any; entry:string; t:(key:string)=>string; pick:(method:string)=>Promise<string|null>; change:(target:any)=>void};
export function EntryFields({target,entry,t,pick,change}:Props){
  const [error,setError]=useState('');
  async function choose(key:'home'|'binary'){
    setError('');
    try{
      const file=await pick(key==='binary'?'pickBinary':'pickDirectory');
      if(file)change({...target,[key]:file});
    }catch(e:any){setError(t(e.code??'operation_failed'));}
  }
  return <div className="entry-fields">{(['binary','home'] as const).map(key=><div className="entry-field" key={key}>
    <strong>{t(key==='binary'?'kernelProgram':'historyFolder')}</strong>
    <small>{t(key==='binary'?'kernelMeaning':'historyMeaning')}</small>
    <span className="input-action"><input aria-label={t(entry)+' '+t(key==='binary'?'kernelProgram':'historyFolder')} value={target?.[key]??''} onChange={e=>change({...target,[key]:e.target.value})}/>
      <button type="button" onClick={()=>choose(key)}>{t('browse')}</button>
    </span></div>)}{error&&<p role="alert" className="warning-box">{error}</p>}</div>;
}

export function DetectionPanel({report,cfg,t,onApply,onRetry,onClose,inFlow=false}:any){
  const entries=['desktop','cli','ide'];
  function suggestions(candidates:any[]) {
    const initial:Record<string,number>={};
    for(const entry of entries){
      const indexes=candidates.map((v:any,index:number)=>({v,index})).filter(({v}:any)=>v.entry===entry&&v.runtime&&v.homeAvailable);
      const current=cfg.targets[entry];
      if(indexes.length===1 && !indexes[0].v.assumedHome && !current?.binary && (!current?.home||current.home===indexes[0].v.home))initial[entry]=indexes[0].index;
    }
    return initial;
  }
  const [chosen,setChosen]=useState(()=>suggestions(report.candidates));
  const [homes,setHomes]=useState<string[]>([]);
  const [applying,setApplying]=useState(false),[error,setError]=useState('');
  const count=Object.keys(chosen).length+homes.length;
  async function apply(){
    setApplying(true);
    const targets={...cfg.targets};const sources=new Set<string>([...cfg.sourceHomes,...homes]);
    for(const [entry,index] of Object.entries(chosen)){
      const candidate=report.candidates[index];targets[entry]={binary:candidate.binary,home:candidate.home};sources.add(candidate.home);
    }
    try{await onApply({...cfg,targets,sourceHomes:[...sources]});}catch(e:any){setError(t(e.code??'operation_failed'));}finally{setApplying(false);}
  }
  return <div className="modal-backdrop detection-layer"><section className="modal" role="dialog" aria-modal="true" aria-label={t('detectEnvironment')}>
    <div className="card-title"><h2>{t('detectEnvironment')}</h2><button disabled={applying} onClick={onClose}>{t('close')}</button></div>
    <p>{t('detectApplyHint')}</p><button disabled={applying} onClick={async()=>{setApplying(true);try{const next=await onRetry();setChosen(suggestions(next.candidates));setHomes([]);setError('');}catch(e:any){setError(t(e.code??'operation_failed'));}finally{setApplying(false);}}}>{t('restartDetection')}</button>
    {entries.map(entry=><section className="candidate-group" key={entry}><h3>{t(entry)}</h3>
      {cfg.targets[entry]?.binary&&<small>{t('currentPath')} <code>{cfg.targets[entry].binary}</code><code>{cfg.targets[entry]?.home}</code></small>}
      {entry==='desktop'&&report.launchers?.length>0&&<div><small>{t('detectedLauncher')}</small>{report.launchers.map((file:string)=><code key={file}>{file}</code>)}</div>}
      {!report.candidates.some((c:any)=>c.entry===entry)&&<p className="warning-box">{t(entry==='desktop'?'launchDesktopToDetect':'noCandidate')}</p>}
      {report.candidates.map((c:any,i:number)=>{
        if(c.entry!==entry)return null;
        const same=cfg.targets[entry]?.binary===c.binary&&cfg.targets[entry]?.home===c.home;
        return <label className="candidate" key={i}><input type="checkbox" disabled={!c.runtime||!c.homeAvailable||same||applying} checked={same||chosen[entry]===i} onChange={e=>setChosen(old=>{const next={...old};if(e.target.checked)next[entry]=i;else delete next[entry];return next;})}/>
          <span><strong>{t(same?'configured':cfg.targets[entry]?.binary?'replaceSaved':'suggested')} · {t(c.evidence)}</strong>
          {c.app&&<small>{t('desktopApp')} <code>{c.app}</code></small>}
          <small>{t('kernelProgram')} <code>{c.binary}</code> {c.runtime||t(c.error||'binary_unavailable')}</small>
          <small>{t('historyFolder')} <code>{c.home}</code> {t(!c.homeAvailable?'pathMissing':c.assumedHome?'checkProposedFolder':'pathFound')}</small></span>
        </label>;
      })}</section>)}
    {!count&&<small>{t('noChangesToApply')}</small>}<details><summary>{t('sourceHomes')}</summary>{report.sourceHomes.map((x:any)=><label className="check" key={x.path}><input type="checkbox" disabled={!x.available||cfg.sourceHomes.includes(x.path)} checked={cfg.sourceHomes.includes(x.path)||homes.includes(x.path)} onChange={e=>setHomes(e.target.checked?[...homes,x.path]:homes.filter(h=>h!==x.path))}/><code>{x.path}</code></label>)}</details>
    {error&&<p role="alert" className="warning-box">{error}</p>}
    <div className="modal-actions"><button disabled={applying} onClick={onClose}>{t('returnManual')}</button><button disabled={applying||count===0} className="primary" onClick={apply}>{t(applying?'applying':inFlow?'saveAndReturn':'applySelected')} ({count})</button></div>
  </section></div>;
}
