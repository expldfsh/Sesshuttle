import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {zstdCompressSync} from 'node:zlib';import {records,digestRollout} from '../../core/stream.mjs';
test('compressed header consumers close safely at chunk boundaries; corrupt streams still fail',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-stream-'));try{
  for(const n of [1,18000,20000,65536,100000])for(const tail of [0,500,16000,50000,1000000]){
   const file=path.join(root,'case.jsonl.zst'),raw=Buffer.from(JSON.stringify({first:'x'.repeat(n)})+'\n'+(tail?JSON.stringify({tail:'y'.repeat(tail)})+'\n':''));await fs.writeFile(file,zstdCompressSync(raw));
   for(let i=0;i<4;i++)for await(const first of records(file)){assert.equal(first.first.length,n);break;}
   assert.equal((await digestRollout(file)).historyBytes,raw.length);
  }
  const corrupt=path.join(root,'bad.jsonl.zst');await fs.writeFile(corrupt,'not zstd');await assert.rejects(digestRollout(corrupt));
  const truncated=zstdCompressSync(Buffer.from(JSON.stringify({data:randomBytes(200000).toString('base64')})+'\n'));await fs.writeFile(corrupt,truncated.subarray(0,truncated.length-100));await assert.rejects(async()=>{for await(const record of records(corrupt)){};});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
