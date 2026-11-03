import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeStorage } from 'electron';
import { atomic, Fault, id, requireThat } from '../../core/util.mjs';

const exec = promisify(execFile);
const tool = '/usr/bin/secret-tool';

// Pass secret values only through a private pipe. Diagnostics never contain its output.
async function secretService(args: string[], input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {stdio:['pipe','pipe','ignore']});
    let output = Buffer.alloc(0);
    const stop = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', (part: Buffer) => {
      if (output.length + part.length > 65536) child.kill();
      else output = Buffer.concat([output,part]);
    });
    child.on('error', () => { clearTimeout(stop); reject(new Fault('credential_service_unavailable')); });
    child.on('close', code => {
      clearTimeout(stop);
      if (code === 0) resolve(output.toString().trimEnd());
      else reject(new Fault('credential_service_unavailable'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function credentialHealth() {
  const linux=process.platform==='linux';
  const available=await safeStorage.isAsyncEncryptionAvailable().catch(()=>false);
  const backend=linux?safeStorage.getSelectedStorageBackend():process.platform;
  const client=linux && await fs.access(tool).then(()=>true,()=>false);
  let service=false;
  if (client) {
    service=await exec('/usr/bin/busctl',['--user','--timeout=2','introspect','org.freedesktop.secrets','/org/freedesktop/secrets','org.freedesktop.Secret.Service'],{timeout:3500,maxBuffer:32768}).then(()=>true,()=>false);
  }
  return {linux,desktop:linux?(process.env.XDG_CURRENT_DESKTOP??'').slice(0,80):'',available,backend,client,service};
}

export async function persistConnection(state:any, value:any, testRoot?:string) {
  if(testRoot)throw new Fault('credential_test_memory');
  const status=await credentialHealth();
  const data=JSON.stringify({...value,connection:state.get('connection')});
  if(status.available && !['basic_text','unknown'].includes(status.backend)){
    const encrypted=await safeStorage.encryptStringAsync(data).catch(()=>null);
    if(encrypted){
      try {await atomic(path.join(state.root,'connection-secret.bin'),encrypted);}
      catch {throw new Fault('credential_write_failed');}
      state.set('credentialMethod','system');return;
    }
  }
  if(status.service){
    const reference=state.get('credentialReference')??id();
    await secretService(['store','--label=Sesshuttle R2','application','sesshuttle','profile',reference],data);
    state.set('credentialReference',reference);state.set('credentialMethod','secret-service');return;
  }
  throw new Fault('credential_service_unavailable');
}
export async function retrieveConnection(state:any) {
  const connection=state.get('connection');
  if(!connection)return null;
  let raw:string;
  if(state.get('credentialMethod')==='secret-service'){
    raw=await secretService(['lookup','application','sesshuttle','profile',state.get('credentialReference')]);
  }else{
    const buffer=await fs.readFile(path.join(state.root,'connection-secret.bin')).catch(()=>null);
    if(!buffer)return null;
    raw=(await safeStorage.decryptStringAsync(buffer)).result;
  }
  const value=JSON.parse(raw);
  requireThat(JSON.stringify(value.connection)===JSON.stringify(connection),'credential_restore_failed');
  return {credentials:value.credentials,key:value.key};
}
