import React from 'react';
export function ConversationActions({items,t,busy,open,remove,resume,versions}:any){
 const local=items.filter((i:any)=>i.local).length,remote=items.filter((i:any)=>i.remote).length;
 const single=items.length===1?items[0]:null;
 const targets=Object.entries(single?.targets??{}).filter(([,v]:any)=>v.status==='verified');
 const importFirst=remote&&(!local||single?.status==='remote_changes');
 const upload=<button disabled={busy} className={!importFirst&&!targets.length?'primary':''} onClick={()=>open('upload')}>{t('uploadCloud')}{!single&&' ('+local+')'}…</button>;
 const download=<button disabled={busy} className={importFirst?'primary':''} onClick={()=>open('download')}>{t('importLocal')}{!single&&' ('+remote+')'}…</button>;
 return <div className="actions conversation-actions">
  {targets.map(([entry])=><button key={entry} className="primary" disabled={busy} onClick={()=>resume(single.id,entry)}>{t('continue')} · {t(entry)}</button>)}
  {single?.status==='conflict'&&<button className="primary" disabled={busy} onClick={versions}>{t('compareVersions')}</button>}
  {importFirst?<>{remote>0&&download}{local>0&&upload}</>:<>{local>0&&upload}{remote>0&&download}</>}
  <button className="danger-button" disabled={busy} onClick={remove}>{t('removeChats')}…</button>
  {items.length>1&&local>0&&remote>0&&<details className="more-actions"><summary>{t('moreActions')}</summary><div><button disabled={busy} onClick={()=>open('both')}>{t('both')}…</button>
   </div></details>}
 </div>;
}
