import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Vault} from '../../core/vault.mjs';
import {MemoryStore} from '../helpers/memory-store.mjs';
import {newKey} from '../../core/crypto.mjs';
import {hash,id} from '../../core/util.mjs';
import {packStream,materialize} from '../../core/bundle.mjs';
import {repairDownload} from '../../core/attachment-repair.mjs';
import {remapHistory} from '../../core/remap-history.mjs';
import {attachmentUnchanged} from '../../core/attachments.mjs';
import {records} from '../../core/stream.mjs';

test('locating a missing image repairs only the target copy and never publishes new data at preview',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-repair-'));
 try{
  const store=new MemoryStore(),vault=new Vault(store,id(),newKey());await vault.create();
  const tid=id(),original='/source/original.png',key=hash(tid+'\0'+original),stage=path.join(root,'stage');
  await fs.mkdir(stage);
  const raw=Buffer.from([{type:'session_meta',payload:{id:tid}},{type:'event_msg',payload:{item:{content:[{type:'text',text:'unchanged'},{type:'localImage',path:original}]}}}].map(JSON.stringify).join('\n')+'\n');
  const artifact=await packStream([raw],'rollout',vault,stage);
  const payload={format:2,logicalId:tid,issues:['attachment_missing'],files:[{id:tid,artifacts:[artifact],issues:['attachment_missing'],attachmentReport:[{path:original,sessionId:tid,key,status:'missing'}]}]};
  const {version}=await vault.publish(payload,{id:'fixture'});const immutable=await vault.version(version),count=store.objects.size;
  const replacement=path.join(root,'chosen.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');await fs.writeFile(replacement,png);
  const copy=await repairDownload(immutable,{[key]:replacement},vault,stage);
  assert.deepEqual(copy.issues,[]);assert.equal(immutable.files[0].attachmentReport[0].status,'missing');assert.equal(store.objects.size,count);
  const local=await materialize(copy,{readChunk:k=>vault.readForImport(k)},path.join(root,'download'));
  await remapHistory(local.files,root);assert.deepEqual(await fs.readFile(local.files[0].artifacts.find(a=>a.kind==='asset').file),png);
  const list=[];for await(const record of records(local.files[0].artifacts[0].file))list.push(record);
  assert.equal(list[1].payload.item.content[1].path,path.join(root,'sesshuttle_assets',hash(png)));
  await fs.appendFile(replacement,'changed');assert.equal(await attachmentUnchanged(copy.files[0].attachmentReport[0]),false);
  assert.deepEqual(await vault.version(version),immutable);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
