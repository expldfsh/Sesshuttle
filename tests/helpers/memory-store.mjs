import { Fault, hash } from '../../core/util.mjs';
// Test adapter deliberately has no desktop IPC route.
export class MemoryStore {
 constructor(){this.objects=new Map();}
 async get(k){const x=this.objects.get(k);return x?{body:Buffer.from(x.body),etag:x.etag}:null;}
 async put(k,body,etag){const old=this.objects.get(k);if(etag===null&&old||etag&&old?.etag!==etag)throw new Fault('concurrent_update');
  const next={body:Buffer.from(body),etag:'"'+hash(body)+'"'};this.objects.set(k,next);return next.etag;}
 async remove(key){this.objects.delete(key);}
 async list(prefix){return [...this.objects.keys()].filter(k=>k.startsWith(prefix));}
 async inventory(prefix){return [...this.objects].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,bytes:v.body.length}));}
 async test(){return {read:true,write:true};}
}
