// Run the same proof as the UI, then re-open the private state to check reuse.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {State} from '../core/state.mjs';
import {verifyRuntime} from '../core/runtime-check.mjs';
import {runtimeInfo} from '../core/runtime.mjs';
const binary=process.argv[2],root=await fs.mkdtemp(path.join(os.tmpdir(),'sesshuttle-proof-test-'));
let state=new State(root);
try{
 assert.equal((await runtimeInfo(binary,state)).status,'untested');
 const start=Date.now(),onStage=s=>console.log(s,Date.now()-start);
 const result=await verifyRuntime(binary,state,{onStage});assert.equal(result.status,'verified');
 console.log(JSON.stringify({version:result.version,platform:process.platform,arch:process.arch,elapsedMs:Date.now()-start,projects:result.projects,requiresSourceProvider:result.requiresSourceProvider}));
 state.close();state=new State(root);
 const repeat=await verifyRuntime(binary,state,{onStage:()=>assert.fail('cached result reran')});
 assert.ok(repeat.reused);console.log('PASS persisted proof');
} catch(e){console.error(e.code,e.detail);throw e;} finally{state.close();await fs.rm(root,{recursive:true,force:true});}
