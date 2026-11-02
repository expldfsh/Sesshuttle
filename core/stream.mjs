import {Readable} from 'node:stream';import {createZstdDecompress} from 'node:zlib';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireThat,id } from './util.mjs';
export const CHUNK=4*1024*1024;
export const RECORD_LIMIT=128*1024*1024;
export async function* readBlocks(file,size=CHUNK){
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await h.stat();requireThat(before.isFile(),'unsafe_path');let offset=0;
  while(offset<before.size){const b=Buffer.alloc(Math.min(size,before.size-offset));let n=0;while(n<b.length){const r=await h.read(b,n,b.length-n,offset+n);requireThat(r.bytesRead>0,'busy');n+=r.bytesRead;}offset+=n;yield b;}
  const after=await h.stat();requireThat(before.size===after.size&&before.mtimeMs===after.mtimeMs,'busy');
 }finally{await h.close();}
}
export async function digestFile(file){const h=createHash('sha256');let bytes=0;for await(const b of readBlocks(file)){h.update(b);bytes+=b.length;}return {hash:h.digest('hex'),bytes};}
export async function* rolloutBlocks(file){if(!file.endsWith('.zst')){yield* readBlocks(file);return;}const stream=Readable.from(readBlocks(file)).compose(createZstdDecompress());try{for await(const b of stream)yield b;}finally{stream.destroy();}}
export async function digestRollout(file){const h=createHash('sha256');let bytes=0;for await(const b of rolloutBlocks(file)){h.update(b);bytes+=b.length;}return {hash:h.digest('hex'),historyBytes:bytes,bytes:(await fs.stat(file)).size};}
export async function* records(file){let pending=[],length=0;for await(const block of rolloutBlocks(file)){let from=0;for(let i=0;i<block.length;i++)if(block[i]===10){const end=block.subarray(from,i);length+=end.length;requireThat(length<=RECORD_LIMIT,'record_too_large');pending.push(end);const line=Buffer.concat(pending,length);pending=[];length=0;from=i+1;if(line.length)yield JSON.parse(line.toString('utf8'));}if(from<block.length){const tail=block.subarray(from);pending.push(tail);length+=tail.length;requireThat(length<=RECORD_LIMIT,'record_too_large');}}requireThat(!length,'busy');}
export async function writeStream(file,source){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp-'+id();const h=await fs.open(tmp,'wx',0o600);let ok=false;try{for await(const b of source)await h.writeFile(b);await h.sync();await h.close();await fs.rename(tmp,file);ok=true;}finally{if(!ok){await h.close().catch(()=>{});await fs.rm(tmp,{force:true});}}}
export async function copyVerified(source,target,expected){const h=createHash('sha256');async function* data(){for await(const b of readBlocks(source)){h.update(b);yield b;}if(expected)requireThat(h.digest('hex')===expected,'stale_plan');}await writeStream(target,data());}
