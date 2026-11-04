// Run source on Mac, receive on the Linux VM, then return on Mac.
// The exchange file and S3 endpoint are strictly temporary, synthetic and loopback-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {State} from '../core/state.mjs';
import {Engine} from '../core/engine.mjs';
import {Importer} from '../core/importer.mjs';
import {Vault} from '../core/vault.mjs';
import {R2Store} from '../core/storage.mjs';
import {newKey} from '../core/crypto.mjs';
import {id} from '../core/util.mjs';

const [mode,binary,exchange,port]=process.argv.slice(2);
assert.ok(['source','receive','return'].includes(mode)&&path.isAbsolute(binary));
const tmp=await fs.realpath(os.tmpdir()),parent=await fs.realpath(path.dirname(exchange));
assert.ok([tmp,await fs.realpath('/tmp')].includes(path.dirname(parent))&&path.basename(parent).startsWith('sesshuttle-')&&path.basename(exchange)==='exchange.json');
const info=mode==='source'?{key:newKey(),space:id(),marker:'EARLY-'+id()}:JSON.parse(await fs.readFile(exchange,'utf8'));
const child=spawn('python3',['-u','-m','tools.codex_lab.device_bridge',mode,binary,mode==='return'?info.macRoot:'-',info.tid??'-',info.marker],{stdio:['pipe','pipe','inherit']});
const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
async function next(){const line=await lines.next();assert.ok(!line.done,'fixture exited early');return JSON.parse(line.value);}
let state;
try {
 const lab=await next();assert.ok(lab.root.startsWith(tmp+path.sep+'sesshuttle-lab-'));
 if(mode==='receive'&&process.env.SESSHUTTLE_DUPLICATE_TEST==='1'){
  const logical=id(),folder=path.join(lab.home,'sessions','unrelated-conflict');await fs.mkdir(folder,{recursive:true});
  for(const message of ['left','right']){
   const records=[{type:'session_meta',payload:{id:logical,source:'cli',cli_version:'0.166.0',cwd:lab.project}},{type:'event_msg',payload:{type:'user_message',message}}];
   await fs.writeFile(path.join(folder,message+'.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  }
 }
 const store=new R2Store({endpoint:'http://127.0.0.1:'+Number(port),bucket:'sesshuttle-ui',accessKeyId:'fixture',secretAccessKey:'fixture'},{allowLocal:true});
 const vault=new Vault(store,info.space,info.key);if(mode==='source')await vault.create();else await vault.open();
 state=new State(path.join(lab.root,'application'));const entry=process.platform==='linux'?'cli':'desktop';
 state.set('config',{sourceHomes:[lab.home],targets:{[entry]:{home:lab.home,binary}},bindings:info.sourceProject?{[info.sourceProject]:lab.project}:{},nativeBindings:lab.projectId?{[info.sourceProject]:{[lab.home]:lab.projectId}}:{}});
 const engine=new Engine(state,{vault,importer:new Importer(state,{testRoot:lab.root,processGuard:async()=>{}})});
 async function sync(direction){const checked=await engine.refresh();if(mode==='receive'&&process.env.SESSHUTTLE_DUPLICATE_TEST==='1')assert.ok(checked.errors.some(e=>e.code==='duplicate_identity'));const p=await engine.preview({ids:[lab.tid],direction,targets:direction==='upload'?[]:[entry]});const job=await engine.execute(p.token);assert.equal(job.status,'completed',JSON.stringify(job));}
 if(mode==='source'){
  await sync('upload');Object.assign(info,{tid:lab.tid,macRoot:lab.root,sourceProject:engine.rows.find(r=>r.id===lab.tid).projectId});
  await fs.writeFile(exchange,JSON.stringify(info),{mode:0o600});
 }else{
  await sync('download');child.stdin.write('continue\n');const proof=await next();console.log(JSON.stringify(proof));if(mode==='receive')await sync('upload');
 }
 assert.equal(state.keys('backup/').length,0,'manual sync must not create a local backup');
 console.log('PASS '+mode+' on '+process.platform+' '+process.arch);
}finally{child.stdin.end();state?.close();}
