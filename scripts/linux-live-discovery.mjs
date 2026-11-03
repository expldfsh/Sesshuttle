// Exercise real /proc file descriptors and parent executables in the private Linux VM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {id} from '../core/util.mjs';
import {detectEnvironment} from '../core/discovery.mjs';
assert.equal((await fs.readFile('/run/sesshuttle-isolated-vm','utf8')).trim(),'loopback-only-fixture');
const binary=process.argv[2],root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-proc-live-'));
const app=path.join(root,'usr/lib/chatgpt/ChatGPT'),home=path.join(root,'history');
await fs.mkdir(path.dirname(app),{recursive:true});await fs.mkdir(home);await fs.copyFile('/bin/bash',app);
const proc=spawn(app,['-c','exec 3<&0; "$1" app-server <&3 & wait','test-desktop',binary],{cwd:root,env:{PATH:'/usr/bin',CODEX_HOME:home,LANG:'C.UTF-8'},stdio:['pipe','pipe','ignore']});
const lines=readline.createInterface({input:proc.stdout})[Symbol.asyncIterator]();
async function rpc(n,method,params){proc.stdin.write(JSON.stringify({id:n,method,params})+'\n');for(;;){const v=await lines.next();assert.ok(!v.done);const r=JSON.parse(v.value);if(r.id===n){assert.ok(!r.error,JSON.stringify(r.error));return r.result;}}}
try{
 await rpc(1,'initialize',{clientInfo:{name:'sesshuttle_lab',version:'0.2'},capabilities:{experimentalApi:true}});
 proc.stdin.write('{"method":"initialized"}\n');
 await rpc(2,'project/create',{name:'linux',roots:[{path:root}],idempotencyKey:id()});
 const report=await detectEnvironment({config:{},env:{PATH:''},userHome:root});
 const match=report.candidates.find(c=>c.entry==='desktop'&&c.app===app&&c.binary===binary&&c.home===home);
 assert.ok(match,'running desktop association unavailable');assert.equal(match.evidence,'liveDatabase');
 console.log(JSON.stringify({result:'PASS',desktopParentObserved:true,actualHistoryFromDatabase:true,runtime:match.runtime}));
}finally{proc.stdin.end();}
