import React,{useState} from 'react';
export function StorageStatus({init,t,call,reload,viewCloud}:any){
 const [health,setHealth]=useState<any>(null),[pending,setPending]=useState(''),[message,setMessage]=useState('');
 const warning=init.credentialError;
 async function action(method:string){
  setPending(method);setMessage('');
  try{
   if(method==='credentialHealth'){setHealth(await call(method));}
   else{const r=await call(method);await reload();setMessage(t(r.warning??'credentialsRemembered'));}
  }catch(e:any){setMessage(t(e.code??'operation_failed'));}
  finally{setPending('');}
 }
 return <section className={'storage-state '+(init.connected?'joined':'offline')} aria-live="polite">
   <div className="card-title"><strong>{t(init.connected?'spaceJoined':warning?'connectionNeedsCredentials':'offline')}</strong>
    {init.connected&&<button className="primary" onClick={viewCloud}>{t('viewCloud')}</button>}</div>
   {warning&&<div className="credential-note"><b>{t(init.connected?'onlyThisSession':'signInAgain')}</b><p>{t(warning)}</p>
    <div className="actions"><button disabled={!!pending} onClick={()=>action('credentialHealth')}>{t('checkStorage')}</button>
     {init.connected&&<button disabled={!!pending} onClick={()=>action('retryCredentialSave')}>{t('saveCredentialsAgain')}</button>}</div></div>}
   {pending&&<p role="status">{t('checkingStorage')}</p>}
   {health&&<div className="repair-details"><strong>{t('storageCheckResult')}</strong>
    <p>{health.linux?(health.service?t('serviceReachable'):t('serviceUnconfirmed')):t('unlockSystemStore')}</p>
    {health.linux&&<p>{t(/kde|plasma/i.test(health.desktop)?'kwalletHelp':'secretServiceHelp')}</p>}
    {health.linux&&<details><summary>{t('archSteps')}</summary><p>{t('archGuide')}</p><code>busctl --user introspect org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service</code><code>sudo pacman -S --needed gnome-keyring libsecret</code></details>}
    <small>{health.desktop} · {health.backend}</small></div>}
   {message&&<p role="status">{message}</p>}
 </section>;
}
