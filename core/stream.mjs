import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createZstdDecompress} from 'node:zlib';
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
export async function* rolloutBlocks(file){
 if(!file.endsWith('.zst')){yield* readBlocks(file);return;}
 const input=Readable.from(readBlocks(file),{objectMode:false}),decoded=createZstdDecompress();
 // Observe pipeline completion immediately: an early header-only consumer must
 // close both streams and await cleanup, rather than orphan the decoder error.
 const completion=pipeline(input,decoded).then(()=>null,error=>error);let ended=false;
 try{for await(const block of decoded.iterator({destroyOnReturn:false}))yield block;ended=true;const error=await completion;if(error)throw error;}
 finally{if(!ended){input.destroy();decoded.destroy();}await completion;}
}
export async function digestRollout(file){const h=createHash('sha256');let bytes=0;for await(const b of rolloutBlocks(file)){h.update(b);bytes+=b.length;}return {hash:h.digest('hex'),historyBytes:bytes,bytes:(await fs.stat(file)).size};}
export async function* recordLines(file){
 let pending=[],length=0,base=0,start=0;
 for await(const block of rolloutBlocks(file)){let from=0;for(let i=0;i<block.length;i++)if(block[i]===10){const end=block.subarray(from,i);length+=end.length;requireThat(length<=RECORD_LIMIT,'record_too_large');pending.push(end);const raw=Buffer.concat(pending,length),offset=base+i+1;pending=[];length=0;from=i+1;const line={raw,start,end:offset};start=offset;yield line;}
  if(from<block.length){const tail=block.subarray(from);pending.push(tail);length+=tail.length;requireThat(length<=RECORD_LIMIT,'record_too_large');}base+=block.length;
 }requireThat(!length,'busy');
}
export async function* records(file){for await(const {raw} of recordLines(file))if(raw.length)yield JSON.parse(raw.toString('utf8'));}
export async function writeStream(file,source){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp-'+id();const h=await fs.open(tmp,'wx',0o600);let ok=false;try{for await(const b of source)await h.writeFile(b);await h.sync();await h.close();await fs.rename(tmp,file);ok=true;}finally{if(!ok){await h.close().catch(()=>{});await fs.rm(tmp,{force:true});}}}
export async function copyVerified(source,target,expected){const h=createHash('sha256');async function* data(){for await(const b of readBlocks(source)){h.update(b);yield b;}if(expected)requireThat(h.digest('hex')===expected,'stale_plan');}await writeStream(target,data());}
