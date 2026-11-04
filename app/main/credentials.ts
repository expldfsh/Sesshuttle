import fs from 'node:fs/promises';
import path from 'node:path';
import {app,safeStorage} from 'electron';
import {atomic,Fault,id,requireThat} from '../../core/util.mjs';
import {linuxCredential,linuxKeyringHealth} from './linux-keyring';

// macOS Keychain asks the user afresh for each attempt, including after a cancellation.
async function macKeychain(state:any,action:'read'|'write'|'unlock',data=''){
  const modulePath=path.join(app.isPackaged?process.resourcesPath:__dirname,'macos-keychain.node');
  try{return await require(modulePath)(action,state.get('device').id,data);}
  catch(e:any){throw new Fault(typeof e.code==='string'&&e.code.startsWith('credential_')?e.code:'credential_provider_failed');}
}

export async function credentialHealth(){
  const linux=process.platform==='linux';
  const backend=linux?safeStorage.getSelectedStorageBackend():process.platform;
  if(!linux)return {linux,backend,service:true,locked:false,desktop:''};
  const desktop=(process.env.XDG_CURRENT_DESKTOP??'').slice(0,80);
  try{return {linux,backend,desktop,...await linuxKeyringHealth()};}
  catch(e:any){return {linux,backend,desktop,service:false,reason:e.code??'credential_provider_failed'};}
}

export async function persistConnection(state:any,value:any,testRoot?:string){
  if(testRoot)throw new Fault('credential_test_memory');
  const data=JSON.stringify({...value,connection:state.get('connection')});
  if(process.platform==='darwin'){
    await macKeychain(state,'write',data);
    state.set('credentialMethod','mac-keychain');
    return;
  }
  if(process.platform==='linux'){
    const reference=state.get('credentialReference')??id();
    try{
      await linuxCredential(reference,data);
      state.set('credentialReference',reference);
      state.set('credentialMethod','secret-service');
      return;
    }catch(e:any){
      // A desktop may expose only its native wallet. Never follow a cancelled
      // prompt with a second prompt or a plaintext fallback.
      if(e.code!=='credential_service_unavailable'||!safeStorage.getSelectedStorageBackend().startsWith('kwallet'))throw e;
    }
  }
  requireThat(await safeStorage.isAsyncEncryptionAvailable(),'credential_service_unavailable');
  const encrypted=await safeStorage.encryptStringAsync(data).catch(()=>{throw new Fault('credential_authorization_failed');});
  try{await atomic(path.join(state.root,'connection-secret.bin'),encrypted);}
  catch{throw new Fault('credential_write_failed');}
  state.set('credentialMethod','system');
}

export async function retrieveConnection(state:any){
  const connection=state.get('connection'),method=state.get('credentialMethod');
  if(!connection||method==='session')return null;
  let raw:string;
  if(method==='mac-keychain'){
    raw=await macKeychain(state,'read');
  }else if(method==='secret-service'){
    raw=await linuxCredential(state.get('credentialReference'));
  }else{
    const buffer=await fs.readFile(path.join(state.root,'connection-secret.bin')).catch((e:any)=>{
      if(e.code==='ENOENT')return null;
      throw new Fault('credential_restore_failed');
    });
    if(!buffer)throw new Fault('credential_item_missing');
    // Existing Electron-encrypted profiles keep their original key and ciphertext.
    if(process.platform==='darwin')await macKeychain(state,'unlock');
    raw=(await safeStorage.decryptStringAsync(buffer)).result;
  }
  const value=JSON.parse(raw);
  requireThat(JSON.stringify(value.connection)===JSON.stringify(connection),'credential_restore_failed');
  return {credentials:value.credentials,key:value.key};
}
