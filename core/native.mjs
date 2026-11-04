import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Fault,requireThat,canonical } from './util.mjs';
import { requireRuntime,readVersion } from './runtime.mjs';
const exec=promisify(execFile);
export async function assertCodexClosed(home){
 let output;
 const windows=process.platform==='win32';
 try{output=(await exec(windows?'tasklist':'ps',windows?['/FO','CSV','/NH']:['-axo','pid=,comm='],{timeout:8000,maxBuffer:4*1024*1024})).stdout;}catch{throw new Fault('process_check_failed');}
 for(const line of output.split('\n')){
  if(!/(?:^|[\/\\\s"])(?:codex(?:\.exe)?|codex-app-server|codex-app-serve)(?:[\s",]|$)/i.test(line))continue;
  // Linux exposes the launch environment per PID. An explicitly separate
  // data directory is evidence a different instance may stay open.
  const pid=line.trim().match(/^(\d+)\s/)?.[1];
  if(process.platform==='linux'&&pid&&home){
   try{
    const env=(await fs.readFile('/proc/'+pid+'/environ','utf8')).split('\0');
    const configured=env.find(v=>v.startsWith('CODEX_HOME='))?.slice(11);
    if(configured&&path.isAbsolute(configured)&&await canonical(configured)!==home)continue;
   }catch(e){if(e.code==='ENOENT'&&!await fs.stat('/proc/'+pid).catch(()=>null))continue;}
  }
  throw new Fault('codex_running',home??'');
 }
}
export const binaryVersion=readVersion;
export class NativeClient{
 constructor(binary,home,project,{confine=true,disabledServers=[],fixture}={}){this.next=0;this.waiting=new Map();this.closed=false;
  const args=['app-server','-c','analytics.enabled=false','-c','cli_auth_credentials_store="file"','-c','mcp_servers={}','-c','hooks={}','-c','features.plugins=false','-c','features.shell_snapshot=false'];
  for(const event of ['PreModelRequest','PostModelRequest','PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','SessionStart','SessionEnd','UserPromptSubmit','SubagentStart','SubagentStop','Stop','Interrupt'])args.push('-c',`hooks.${event}=[]`);
  if(disabledServers.length)args.push('-c','mcp_servers={'+disabledServers.map(server=>JSON.stringify(server)+'={enabled=false,required=false}').join(',')+'}');
  args.push('-c','otel.exporter="none"','-c','otel.trace_exporter="none"','-c','features.remote_plugin=false');
  let command=binary,all=args;
  if(process.platform==='darwin'&&confine){command='/usr/bin/sandbox-exec';
   const quote=JSON.stringify;let profile=`(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow ipc-posix*)(allow file-read*)${home!==path.join(os.homedir(),'.codex')?'(deny file-read* (subpath '+quote(path.join(os.homedir(),'.codex'))+'))':''}(allow file-write* (subpath ${quote(home)}) (literal "/dev/null"))`;
   if(fixture)profile+='(allow network-outbound (remote ip "localhost:'+fixture.port+'"))';
   all=['-p',profile,binary,...args];
  }
  const env={PATH:process.env.PATH??'/usr/bin:/bin',CODEX_HOME:home,TMPDIR:home,LANG:process.env.LANG??'en_US.UTF-8',RUST_LOG:'off',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',ALL_PROXY:'http://127.0.0.1:9',NO_PROXY:''};
  if(fixture){
   Object.assign(env,{HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,XDG_STATE_HOME:home,NO_PROXY:'127.0.0.1',no_proxy:'127.0.0.1'});
   fixture.signal.throwIfAborted();
  }
  this.process=spawn(command,all,{cwd:project,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.exited=new Promise(resolve=>this.process.once('close',resolve));
  const stop=()=>this.process.kill('SIGKILL');
  fixture?.signal.addEventListener('abort',stop,{once:true});
  this.process.once('close',()=>fixture?.signal.removeEventListener('abort',stop));
  this.process.stdin.on('error',()=>this.fail());
  this.process.stderr.on('data',()=>{});
  this.reader=readline.createInterface({input:this.process.stdout});
  this.reader.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
   if(m.method&&m.id!==undefined){this.send({id:m.id,error:{code:-32603,message:'Permission requests are disabled during migration'}});return;}
   if(m.method&&m.id===undefined){fixture?.notify?.(m);return;}
   const w=this.waiting.get(m.id);if(w){clearTimeout(w.timer);this.waiting.delete(m.id);m.error?w.reject(new Fault(m.error.code===-32601?'native_method_missing':'native_error',(w.method+' · '+(m.error.message??'')).slice(0,300))):w.resolve(m.result);}
  });
  this.process.on('error',()=>this.fail());this.process.on('exit',()=>this.fail());
 }
 send(x){if(!this.process.stdin.destroyed)this.process.stdin.write(JSON.stringify(x)+'\n');}
 fail(){this.closed=true;for(const w of this.waiting.values()){clearTimeout(w.timer);w.reject(new Fault('native_unavailable'));}this.waiting.clear();}
 rpc(method,params){requireThat(!this.closed,'native_unavailable');const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiting.delete(id);reject(new Fault('native_timeout'));},20000);this.waiting.set(id,{resolve,reject,timer,method});this.send({id,method,params});});}
 async init(home){const r=await this.rpc('initialize',{clientInfo:{name:'sesshuttle',version:'0.1.0'},capabilities:{experimentalApi:true}});requireThat(await canonical(r.codexHome)===home,'unsafe_path');this.send({method:'initialized'});}
 async close(){
  this.process.stdin.end();
  const timer=setTimeout(()=>this.process.kill('SIGKILL'),1500);
  try{await this.exited;}finally{clearTimeout(timer);this.reader.close();this.fail();}
 }
}
export async function prepareNative({binary,home,project,files,logicalId,nativeProjectId,authorize=requireRuntime,fixture}){
 const identity=await authorize(binary);binary=identity.file;home=await canonical(home);project=await canonical(project);
 // Read effective target configuration without creating/resuming a thread. Empty
 // tables merge with user configuration, so every configured server needs an
 // explicit disabled flag. Hook arrays are explicitly replaced in both clients.
 let targetConfig;const probe=new NativeClient(binary,home,project,{fixture});
 try{await probe.init(home);targetConfig=(await probe.rpc('config/read',{includeLayers:false})).config;}finally{await probe.close();}
 const client=new NativeClient(binary,home,project,{fixture,disabledServers:Object.keys(targetConfig.mcp_servers??{})});
 try{await client.init(home);
  const effective=(await client.rpc('config/read',{includeLayers:false})).config;
  requireThat(Object.values(effective.mcp_servers??{}).every(s=>s.enabled===false)&&Object.values(effective.hooks??{}).every(items=>Array.isArray(items)&&items.length===0),'unsafe_native_config');
  for(const f of files){
   if(f.artifacts&&!f.artifacts.some(a=>a.kind==='rollout'))continue; // database-only dependencies remain preserved; never claim native continuation
   const wasArchived=f.placementArchived??f.archived;await client.rpc('thread/list',{modelProviders:[],archived:wasArchived,limit:100});
   if(wasArchived)await client.rpc('thread/unarchive',{threadId:f.id});
   const r=await client.rpc('thread/resume',{threadId:f.id,cwd:project,runtimeWorkspaceRoots:[project],modelProvider:targetConfig.model_provider??'openai',...(targetConfig.model?{model:targetConfig.model}:{}),sandbox:'read-only',approvalPolicy:'on-request',excludeTurns:true});
   requireThat(r.thread?.id===f.id&&r.cwd===project&&r.sandbox?.type==='readOnly','native_verification_failed');
   await client.rpc('thread/settings/update',{threadId:f.id,cwd:project,approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly',networkAccess:false}});
   // Assign native metadata only. The user decides when to describe the new environment.
   if (nativeProjectId && f.id === logicalId) {
     await client.rpc('thread/metadata/update', {threadId: f.id, projectId: nativeProjectId});
     const read = await client.rpc('thread/read', {threadId: f.id, includeTurns: false});
     requireThat(read.thread?.projectId === nativeProjectId, 'project_assignment_failed');
   }
   if(f.archived)await client.rpc('thread/archive',{threadId:f.id});
   let cursor=null,count=0,seen=new Set();do{const p=await client.rpc('thread/turns/list',{threadId:f.id,limit:1,itemsView:'full',cursor});count+=p.data.length;cursor=p.nextCursor;
    requireThat(!cursor||!seen.has(cursor),'native_verification_failed');if(cursor)seen.add(cursor);requireThat(seen.size<10000,'space_too_large');
   }while(cursor);
   requireThat(count>=(f.turnCount??1),'native_verification_failed');
  }
  return {status:'verified',cwd:project};
 }finally{await client.close();}
}
