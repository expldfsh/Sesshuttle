import {parseKey} from './crypto.mjs';
import {Fault,requireThat} from './util.mjs';

function sameSpace(a,b) {
  if (!a || !b) return false;
  return a.space===b.space && a.bucket===b.bucket && a.endpoint.replace(/\/$/,'')===b.endpoint.replace(/\/$/,'');
}

export function readRecovery(text,knownConnection=null) {
  let file;
  try { file=JSON.parse(text); } catch { throw new Fault('invalid_recovery_file'); }
  requireThat(file?.format===1 && typeof file.endpoint==='string' && file.endpoint.length<=2048 &&
    typeof file.bucket==='string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(file.bucket) &&
    typeof file.space==='string' && /^[0-9a-f-]{36}$/i.test(file.space),'invalid_recovery_file');
  parseKey(file.key);
  if (file.accessKeyId!==undefined) requireThat(typeof file.accessKeyId==='string' &&
    /^[\x21-\x7e]{1,256}$/.test(file.accessKeyId),'invalid_recovery_file');
  const {endpoint,bucket,space,key}=file;
  const knownId=sameSpace(file,knownConnection) ? knownConnection.accessKeyId : '';
  return {endpoint,bucket,space,key,accessKeyId:file.accessKeyId || knownId || ''};
}

export function writeRecovery(connection,secrets) {
  const accessKeyId=secrets?.credentials?.accessKeyId;
  requireThat(accessKeyId,'export_id_missing');
  const {endpoint,bucket,space}=connection;
  const file={format:1,endpoint,bucket,space,accessKeyId,key:secrets.key};
  const text=JSON.stringify(file,null,2);
  readRecovery(text);
  return text;
}
