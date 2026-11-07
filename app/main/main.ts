import {clearActivity} from '../../core/activity.mjs';
import {backupSummary,deleteBackup,restoreReview} from '../../core/manual-backups.mjs';
import {readRecovery,writeRecovery} from '../../core/recovery-file.mjs';
import {Removals} from '../../core/removals.mjs';
import {changeCloud} from '../../core/cloud-trash.mjs';
import {bundleBytes} from '../../core/bundle.mjs';
import {credentialHealth,persistConnection,retrieveConnection} from './credentials';
import {detectEnvironment,liveLinuxTargets} from '../../core/discovery.mjs';
import {localProjects} from '../../core/local-projects.mjs';
import {runtimeInfo} from '../../core/runtime.mjs';
import {verifyRuntime} from '../../core/runtime-check.mjs';
import {assertCodexClosed} from '../../core/native.mjs';
import {Trash} from '../../core/trash.mjs';
import {downloadCopy} from '../../core/download-copy.mjs';
import {keepLocalCopy,inspectTarget} from '../../core/local-copies.mjs';
import {workspaceFolderName} from '../../core/workspace.mjs';
import { app,BrowserWindow,ipcMain,dialog,safeStorage,session,shell,Menu,nativeTheme } from 'electron';
import fs from 'node:fs/promises';import {realpathSync,readFileSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import { pathToFileURL } from 'node:url';import { execFile,spawn } from 'node:child_process';import { promisify } from 'node:util';
import { State } from '../../core/state.mjs';import { Engine } from '../../core/engine.mjs';import { R2Store } from '../../core/storage.mjs';import { Vault } from '../../core/vault.mjs';
import { newKey,parseKey } from '../../core/crypto.mjs';import { Fault,requireThat,publicError,id,atomic,exists,canonical,inside } from '../../core/util.mjs';import { Importer } from '../../core/importer.mjs';
import {getTheme,DEFAULT_THEME_ID} from '../shared/themes';
const exec=promisify(execFile);let window:BrowserWindow;let state:any,engine:any,trash:any,removals:any;let deletionActive=false;let secrets:any=null;let recovery:any=null;
const testRoot=process.env.SESSHUTTLE_TEST_ROOT;
if(testRoot){const canonicalRoot=realpathSync(testRoot);const tempRoots=[realpathSync(os.tmpdir()),realpathSync('/tmp')];requireThat(canonicalRoot===testRoot&&path.basename(testRoot).startsWith('sesshuttle-')&&tempRoots.some(p=>testRoot.startsWith(p+path.sep))&&JSON.parse(readFileSync(path.join(testRoot,'.sesshuttle-test.json'),'utf8')).format===1,'unsafe_path');app.setPath('userData',path.join(testRoot,'app-data'));}
const attachmentPicks = new Set<string>();
const renderer=path.join(__dirname,'renderer','index.html');
function updateMenu(){const zh=state?.get('config')?.language==='zh-CN';const text=(a:string,b:string)=>zh?a:b;
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{label:'sesshuttle',submenu:[{role:'about' as const,label:text('关于 sesshuttle','About sesshuttle')},{type:'separator' as const},{role:'quit' as const,label:text('退出 sesshuttle','Quit sesshuttle')}]}]:[]),
  {label:text('编辑','Edit'),submenu:[{role:'undo',label:text('撤销','Undo')},{role:'redo',label:text('重做','Redo')},{type:'separator'},{role:'cut',label:text('剪切','Cut')},{role:'copy',label:text('复制','Copy')},{role:'paste',label:text('粘贴','Paste')},{role:'selectAll',label:text('全选','Select all')}]},
  {label:text('窗口','Window'),submenu:[{role:'minimize',label:text('最小化','Minimize')},{role:'close',label:text('关闭','Close')}]}
 ]));
}
function updateTheme(){const theme=getTheme(state?.get('config')?.theme);nativeTheme.themeSource=theme.colorScheme;window?.setBackgroundColor(theme.colors.bg);}
async function discover(){
 const home=testRoot?path.join(testRoot,'codex'):path.join(os.homedir(),'.codex');
 return {theme:DEFAULT_THEME_ID,language:app.getLocale().startsWith('zh')?'zh-CN':'en',sourceHomes:[home],targets:Object.fromEntries(['desktop','cli','ide'].map(entry=>[entry,{home,binary:''}])),bindings:{},nativeBindings:{}};
}
async function loadSecrets(){
 try{
  if(testRoot||state.get('credentialMethod')==='session')return;
  const value=await retrieveConnection(state);
  if(!value)return;
  const cfg=state.get('connection');
  const vault=new Vault(new R2Store({...cfg,...value.credentials}),cfg.space,value.key,{installation:state.get('device').id,deviceName:state.get('device').name});
  await vault.open();secrets=value;engine.vault=vault;state.set('credentialError',null);
 }catch(e){state.set('credentialError',e instanceof Fault?e.code:'credential_restore_failed');}
 return {warning:state.get('credentialError')};
}
async function saveCurrentCredentials(){
 requireThat(secrets&&engine.vault,'storage_not_connected');
 try{await persistConnection(state,secrets,testRoot);state.set('credentialError',null);return {warning:null};}
 catch(e:any){const warning=e instanceof Fault?e.code:'credential_write_failed';state.set('credentialError',warning);return {warning};}
}
let activeProof:{id:string,controller:AbortController,done:Promise<any>}|null=null;
async function destinationInfo(targets:any){
 const output:any={};
 for(const entry of ['desktop','cli','ide']){
  const target=targets?.[entry]??{};const {home,binary}=target;
  const checked:any={home,binary,projects:[],supported:false};
  if(!binary)checked.error='entry_binary_missing';
  else if(!home)checked.error='entry_home_missing';
  else try{
   if(testRoot)await inside(testRoot,path.join(home,'probe'));
   requireThat((await fs.stat(home).catch(()=>null))?.isDirectory(),'entry_home_missing');
   checked.proof=await runtimeInfo(binary,state);
   checked.runtime=checked.proof.version;
   try{Object.assign(checked,await localProjects(await canonical(home)));}
   catch{checked.projectWarning='runtimeCatalogUnavailable';}
   checked.supported=checked.supported&&checked.proof.projects;
   if(entry!=='cli'){
     checked.manualOpen=await canonical(home)!==path.join(os.homedir(),'.codex');
     if(process.platform==='linux'){
       const scheme=entry==='desktop'?'codex':'vscode';
       const handler=await exec('xdg-mime',['query','default','x-scheme-handler/'+scheme],{timeout:2500}).then(v=>v.stdout.trim(),()=>'');
       checked.manualOpen ||= !handler;
     }
   }
  }catch(e:any){checked.error=e.code==='ENOENT'?'entry_home_missing':publicError(e).code;}
  output[entry]=checked;
 }
 return output;
}
async function saveConfig(input:any){requireThat(!engine.running,'task_running');requireThat(input&&['zh-CN','en'].includes(input.language)&&Array.isArray(input.sourceHomes)&&input.sourceHomes.length<=20,'invalid_settings');
 const cfg:any={theme:getTheme(input.theme).id,language:input.language,sourceHomes:[],targets:{},bindings:{},nativeBindings:{}};
 for(const p of input.sourceHomes.filter((x:any)=>x!=='')){requireThat(typeof p==='string'&&path.isAbsolute(p),'invalid_path');cfg.sourceHomes.push(p);}
 for(const entry of ['desktop','cli','ide']){const t=input.targets?.[entry]??{};for(const k of ['home','binary'])requireThat(typeof(t[k]??'')==='string'&&(!t[k]||path.isAbsolute(t[k])),'invalid_path');cfg.targets[entry]={home:t.home??'',binary:t.binary??''};}
 for(const [k,v]of Object.entries(input.bindings??{})){requireThat(/^[0-9a-f-]{36}$/i.test(k)&&typeof v==='string'&&path.isAbsolute(v),'invalid_path');cfg.bindings[k]=v;}
 for(const [source, homes] of Object.entries(input.nativeBindings??{}) as [string,any][]){
  requireThat(/^[0-9a-f-]{36}$/i.test(source)&&homes&&typeof homes==='object','invalid_settings');
  cfg.nativeBindings[source]={};
  for(const [home,projectId] of Object.entries(homes)){
   requireThat(path.isAbsolute(home)&&typeof projectId==='string'&&projectId.length<=256,'invalid_settings');
   cfg.nativeBindings[source][home]=projectId;
  }
 }
 if(testRoot){for(const p of cfg.sourceHomes)await inside(testRoot,path.join(p,'check'));for(const t of Object.values(cfg.targets) as any[])if(t.home)await inside(testRoot,path.join(t.home,'check'));}
 state.set('config',cfg);updateMenu();updateTheme();if(input.deviceName){requireThat(typeof input.deviceName==='string'&&input.deviceName.length<=80,'invalid_settings');state.set('device',{...state.get('device'),name:input.deviceName});}
 return cfg;
}
async function connect(input:any){requireThat(!engine.running,'task_running');const cfg={endpoint:String(input.endpoint??'').trim(),bucket:String(input.bucket??'').trim()};
 const credentials={accessKeyId:String(input.accessKeyId??''),secretAccessKey:String(input.secretAccessKey??'')};requireThat(credentials.accessKeyId&&credentials.secretAccessKey,'credentials_required');const store=new R2Store({...cfg,...credentials},testRoot?{allowLocal:true}:{});
 await store.test();if(input.mode==='test')return {status:'connected'};
 const loaded=input.mode==='join'&&input.recoveryToken?recovery:null;
 if(input.recoveryToken&&input.mode==='join')requireThat(loaded?.token===input.recoveryToken&&loaded.endpoint===cfg.endpoint&&loaded.bucket===cfg.bucket&&loaded.space===input.space,'recovery_target_changed');
 const space=input.mode==='create'?id():String(input.space??'');
 const key=input.mode==='create'?newKey():(loaded?.key??String(input.key??''));parseKey(key);
 const vault=new Vault(store,space,key,{installation:state.get('device').id,deviceName:state.get('device').name});if(input.mode==='create')await vault.create();else await vault.open();
 // If secure persistence is unavailable, keep the successful connection in memory
 // and return an explicit warning; never write plaintext credentials.
 await engine.clearDownloads();secrets={credentials,key};engine.vault=vault;state.set('connection',{...cfg,space,accessKeyId:credentials.accessKeyId});recovery=null;
 state.set('credentialMethod','session');
 state.set('credentialError',input.remember?'credential_save_pending':'credential_session_only');
 return {status:'connected',space};
}
async function projectInfo(project:string){await canonical(project);try{
 const options={cwd:project,timeout:5000,maxBuffer:65536};const [branch,commit,dirty]=await Promise.all([exec('git',['branch','--show-current'],options),exec('git',['rev-parse','HEAD'],options),exec('git',['status','--short'],options)]);
 return {branch:branch.stdout.trim(),commit:commit.stdout.trim(),changes:dirty.stdout.trim().split('\n').filter(Boolean).length};
 }catch{return {git:false};}}
async function continueEntry({logicalId,entry}:any){requireThat(['desktop','cli','ide'].includes(entry),'invalid_selection');const record=state.get('entries/'+engine.scope()+'/'+logicalId,{})[entry];requireThat(record&&record.status==='verified','not_verified');await canonical(record.project);
 const cfg=engine.config(),target=cfg.targets[entry];requireThat(target?.home===record.home&&target.binary===record.binary&&cfg.bindings[state.get('association/'+logicalId)?.projectId]===record.project,'stale_plan');
 // Open the native entry without submitting a prompt or executing a historical command.
 if(entry==='desktop'||entry==='ide'){
   const home=await canonical(record.home);
   if(process.platform==='linux'){
     const live=(await liveLinuxTargets()).filter(c=>c.entry===entry && c.evidence==='liveDatabase');
     const matching=live.filter(c=>c.home===home);
     requireThat(live.length ? matching.length===live.length : home===path.join(os.homedir(),'.codex'),'custom_home_launcher');
     const scheme=entry==='desktop'?'codex':'vscode';
     const handler=await exec('xdg-mime',['query','default','x-scheme-handler/'+scheme],{timeout:3000}).then(v=>v.stdout.trim(),()=>'');
     requireThat(!!handler,'no_protocol_handler');
   }else requireThat(home===await canonical(path.join(os.homedir(),'.codex')),'custom_home_launcher');
 }
 if(entry==='desktop'){await shell.openExternal('codex://threads/'+encodeURIComponent(logicalId));return {status:'opened'};}
 if(entry==='ide'){await shell.openExternal('vscode://openai.chatgpt/local/'+encodeURIComponent(logicalId));return {status:'opened'};}
 // A launcher script contains only individually quoted paths and a UUID. The user
 // starts the native CLI explicitly; there is no task prompt on the command line.
 requireThat(/^[0-9a-f-]{36}$/i.test(logicalId),'invalid_selection');
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 const file=path.join(state.root,'launchers',logicalId+(process.platform==='win32'?'.cmd':'.command'));
 if(process.platform==='win32')throw new Fault('manual_cli_required');
 await atomic(file,`#!/bin/sh\nexport CODEX_HOME=${quote(record.home)}\nexec ${quote(target.binary)} --cd ${quote(record.project)} resume ${quote(logicalId)}\n`);await fs.chmod(file,0o700);
 if(process.platform==='linux'){
  const choices=[['x-terminal-emulator',['-e',file]],['gnome-terminal',['--',file]],['konsole',['-e',file]],['xfce4-terminal',['--command',file]],['xterm',['-e',file]]] as [string,string[]][];
  for(const [command,args]of choices){const found=(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,command));for(const bin of found)if(await exists(bin)){await new Promise<void>((resolve,reject)=>{const child=spawn(bin,args,{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});return {status:'opened'};}}throw new Fault('terminal_required');
 }
 const error=await shell.openPath(file);requireThat(!error,'open_failed');return {status:'opened'};
}
// Settings can display the identifier of the credentials already unlocked on this device.
function connectionForSettings(connection:any, activeSecrets:any){
 if(!connection)return null;
 return {...connection,accessKeyId:activeSecrets?.credentials?.accessKeyId??connection.accessKeyId??''};
}
async function request(method:string,args:any){switch(method){
 case 'init':return {config:engine.config(),device:state.get('device'),connection:connectionForSettings(state.get('connection'),secrets),connected:!!engine.vault,canRestore:!!state.get('connection')&&!testRoot&&state.get('credentialMethod')!=='session',credentialMethod:state.get('credentialMethod'),credentialError:state.get('credentialError'),version:app.getVersion(),testMode:!!testRoot,removalJobs:removals.jobs(),jobs:state.keys('job/').map((k:string)=>state.get(k)).sort((a:any,b:any)=>b.startedAt.localeCompare(a.startedAt))};
 case 'saveConfig':return saveConfig(args);
 case 'detectPaths':return detectEnvironment({config:engine.config(),testRoot} as any);
 case 'destinationInfo':return destinationInfo(args.targets??engine.config().targets);
 case 'verifyRuntime':{
  requireThat(!activeProof,'runtime_busy');
  requireThat(typeof args.id==='string'&&/^[a-f0-9-]{36}$/i.test(args.id)&&typeof args.binary==='string'&&path.isAbsolute(args.binary),'invalid_selection');
  const controller=new AbortController();
  const done=verifyRuntime(args.binary,state,{signal:controller.signal,onStage:(stage:string)=>{
   if(!window.isDestroyed())window.webContents.send('sesshuttle:runtime',{id:args.id,stage});
  }} as any);
  activeProof={id:args.id,controller,done};
  try{return await done;}finally{activeProof=null;}
 }
 case 'cancelRuntimeCheck':if(activeProof?.id===args.id)activeProof?.controller.abort();return true;
 case 'versionDetails':{
  const head=engine.remote.find((h:any)=>h.logicalId===args.id);requireThat(engine.vault,'storage_not_connected');requireThat(head,'cloud_version_missing');
  return Promise.all(head.tips.map(async(v:string)=>{const p=await engine.vault.version(v);return {id:v,title:p.title,device:p.device?.name,at:p.uploadedAt,bytes:bundleBytes(p),files:p.files.length,lastMessage:p.messages?.at(-1)?.text?.slice(0,180)};}));
 }
 case 'checkClosed':if(!testRoot)await assertCodexClosed();return true;
 case 'validateFolders':for(const projectId of args.projectIds??[]){
   const folder=engine.config().bindings?.[projectId];requireThat(folder && (await fs.stat(folder).catch(()=>null))?.isDirectory(),'working_folder_missing',folder??'');
  }return true;
 case 'createWorkspace':{
   const row=engine.rows?.find((r:any)=>r.projectId===args.projectId);
   requireThat(row&&/^[0-9a-f-]{36}$/i.test(args.projectId),'invalid_selection');
   const base=testRoot??app.getPath('documents');
   if(!await exists(base)){await inside(os.homedir(),base);await fs.mkdir(base,{recursive:true,mode:0o700}).catch(()=>{throw new Fault('workspace_create_failed');});}
   const documents=await canonical(base);
   const dest=await inside(documents,path.join(documents,'Sesshuttle Workspaces',workspaceFolderName(row.originProject?.name,args.projectId)));
   await fs.mkdir(dest,{recursive:true,mode:0o700}).catch(()=>{throw new Fault('workspace_create_failed');});return canonical(dest);
 }
 case 'restoreConnection':requireThat(!secrets,'invalid_action');return loadSecrets();
 case 'credentialHealth':return credentialHealth();
 case 'retryCredentialSave':return saveCurrentCredentials();
 case 'refresh':{
  const result=await engine.refresh();
  if(testRoot)await atomic(path.join(testRoot,'launch-check.json'),JSON.stringify({version:app.getVersion(),platform:process.platform,arch:process.arch,rendererReady:true,rows:result.rows.length,scanErrors:result.errors.length}));
  return result;
 }
 case 'pickDirectory':{const r=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];}
 case 'pickBinary':{const r=await dialog.showOpenDialog(window,{properties:['openFile']});return r.canceled?null:r.filePaths[0];}
 case 'pickImage':{
  const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','gif','webp']}]});
  if(r.canceled)return null;attachmentPicks.add(r.filePaths[0]);return r.filePaths[0];
 }
 case 'connect':return connect(args);
 case 'disconnect':requireThat(!engine.running,'task_running');await engine.clearDownloads();engine.vault=null;secrets=null;recovery=null;state.set('credentialError',null);state.set('connection',null);return {status:'disconnected'};
 case 'importRecovery':{const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'sesshuttle',extensions:['json']}]});if(r.canceled)return null;
  const stat=await fs.stat(r.filePaths[0]);requireThat(stat.size<16384,'invalid_recovery_file');
  const x=readRecovery(await fs.readFile(r.filePaths[0],'utf8'),connectionForSettings(state.get('connection'),secrets));
  // Validate the destination with the same endpoint policy as the connection before showing it.
  new R2Store(x,testRoot?{allowLocal:true}:{});
  const token=id();recovery={...x,token};
  return {space:x.space,endpoint:x.endpoint,bucket:x.bucket,accessKeyId:x.accessKeyId,recoveryToken:token};}
 case 'exportRecovery':{requireThat(secrets&&engine.vault,'storage_not_connected');const text=writeRecovery(state.get('connection'),secrets);
  const r=await dialog.showSaveDialog(window,{defaultPath:'sesshuttle-recovery.json'});if(r.canceled||!r.filePath)return null;
  await atomic(r.filePath,text);return {saved:true};}
 case 'preview':
  requireThat(Object.values(args.replacements??{}).every(p=>typeof p==='string'&&attachmentPicks.has(p)),'invalid_selection');
  return engine.preview(args);
 case 'discardPlan':return engine.discardPlan(args.token);
 case 'execute':return engine.execute(args.token,{confirmLarge:args.confirmLarge===true,acceptedByItem:args.acceptedByItem??{},onlyEligible:args.onlyEligible===true});
 case 'cancel':engine.cancel();return {status:'pausing'};
 case 'downloadCopy':{
   requireThat(!engine.running,'task_running');requireThat(engine.vault,'storage_not_connected');
   const picked=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});
   if(picked.canceled||!picked.filePaths[0])return null;
   requireThat(!engine.running,'task_running');engine.running=true;
   try{return await downloadCopy(engine.vault,args.logical,args.version,picked.filePaths[0]);}finally{engine.running=false;}
 }
 case 'inspectTarget':return inspectTarget(engine,args.entry,args.logical);
 case 'keepLocalCopy':return keepLocalCopy(engine,args);
 case 'reviewRemoval':return removals.preview(args);
 case 'retryRemovalPlan':return removals.retryPlan(args.id);
 case 'reviseRemovalPlan':return removals.revise(args.id);
 case 'executeRemoval':deletionActive=true;try{await engine.clearDownloads();return await removals.execute(args.token,args);}finally{deletionActive=false;}
 case 'finishCloudRemoval':{
   requireThat(engine.vault&&args.storageKey===removals.storageKey(),'space_changed');
   deletionActive=true;engine.running=true;
   try{await changeCloud(engine.vault,null,null,args.id);return true;}finally{engine.running=false;deletionActive=false;}
 }
 case 'clearActivity':return clearActivity(state,args.keys);
 case 'backupBins':return {...await removals.bins(),storageKey:removals.storageKey()};
 case 'backups':return {backups:await Promise.all(state.keys('backup/').map((k:string)=>backupSummary(state,state.get(k)))),imports:state.keys('import/').map((k:string)=>state.get(k))};
 case 'reviewRestore':{const info=state.get('backup/'+args.id);requireThat(info,'backup_not_found');return restoreReview(info);}
 case 'createBackup':
 case 'deleteBackup':
 case 'restore':{
   requireThat(!engine.running,'task_running');engine.running=true;
   try{
    if(method==='restore')return await engine.importer.restore(args.id,args.token);
    if(method==='deleteBackup'){await deleteBackup(state,args.id);return true;}
    const cfg=engine.config();requireThat([...cfg.sourceHomes,...Object.values(cfg.targets).map((t:any)=>t.home)].includes(args.home),'invalid_path');
    return (await engine.importer.backup(args.home)).id;
   }finally{engine.running=false;}
 }
 case 'projectInfo':return projectInfo(args.project);
 case 'continue':requireThat(!engine.running,'task_running');return continueEntry(args);
 case 'diagnostics':return {version:app.getVersion(),platform:process.platform,arch:process.arch,scanErrors:engine.local.errors.map((e:any)=>({code:e.code})),jobs:state.keys('job/').map((k:string)=>state.get(k)).sort((a:any,b:any)=>b.startedAt.localeCompare(a.startedAt)).slice(0,10).map((j:any)=>{return {startedAt:j.startedAt,status:j.status,items:j.items.map((i:any)=>({action:i.action,status:i.status,stage:i.stage,error:i.error?.code,targets:Object.fromEntries(Object.entries(i.targets??{}).map(([entry,r]:any)=>[entry,{status:r.status,stage:r.stage,error:r.error?.code}]))}))};})};
 default:throw new Fault('invalid_action');
}}
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
if(primaryInstance)app.whenReady().then(async()=>{
 if(testRoot){await fs.mkdir(testRoot,{recursive:true});requireThat(await canonical(testRoot)===testRoot,'unsafe_path');await fs.mkdir(path.join(testRoot,'codex'),{recursive:true});}
 state=new State(app.getPath('userData'));for(const name of ['staging','downloads']){const root=path.join(state.root,name);if(await exists(root))for(const entry of await fs.readdir(root))if(/^[0-9a-f-]{36}$/.test(entry))await fs.rm(path.join(root,entry),{recursive:true,force:true});}if(!state.get('config'))state.set('config',await discover());
 const importer=new Importer(state,(testRoot?{testRoot,processGuard:async()=>{}}:{}) as any);
 for(const k of state.keys('job/')){const j=state.get(k);if(j.status==='running')state.set(k,{...j,status:'interrupted'});}
 for(const k of state.keys('import/')){const task=state.get(k);if(['prepared','validating'].includes(task.status))state.set(k,{...task,status:task.backup?'needs_recovery':'interrupted'});}
 trash=new Trash(state,importer);for(const info of trash.list())if(['prepared','removing','restoring'].includes(info.status))await trash.mark(info,'needs_recovery');
 engine=new Engine(state,{importer,onProgress:(data:any)=>window?.webContents.send('sesshuttle:progress',data)} as any);removals=new Removals(engine,trash,{onProgress:(job:any)=>window?.webContents.send('sesshuttle:progress',{kind:'removal-progress',job})} as any);
 updateMenu();updateTheme();
 session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 window=new BrowserWindow({width:1320,height:860,minWidth:780,minHeight:600,title:'sesshuttle',backgroundColor:getTheme(state.get('config')?.theme).colors.bg,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(renderer).href)event.preventDefault();});
 let modifying=false;
 const exclusive=new Set(['createBackup','deleteBackup','clearActivity','downloadCopy','keepLocalCopy','execute','preview','refresh','discardPlan','saveConfig','connect','disconnect','retryCredentialSave','restoreConnection','reviewRemoval','retryRemovalPlan','reviseRemovalPlan','executeRemoval','finishCloudRemoval','restore']);
 ipcMain.handle('sesshuttle:request',async(event,method,args)=>{try{requireThat(event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(renderer).href,'invalid_action');requireThat(typeof method==='string'&&JSON.stringify(args).length<256000,'invalid_action');const guarded=exclusive.has(method);if(guarded){requireThat(!modifying,'task_running');modifying=true;}try{return {ok:true,data:await request(method,args)};}finally{if(guarded)modifying=false;}}catch(e){return {ok:false,error:publicError(e)};}});
 window.on('close',event=>{if(activeProof){event.preventDefault();activeProof.controller.abort();void activeProof.done.catch(()=>{}).then(()=>{if(!window.isDestroyed())window.close();});return;}if(engine.running){event.preventDefault();if(!deletionActive)engine.cancel();window.webContents.send('sesshuttle:closePending',deletionActive);}});
 await window.loadFile(renderer);
}).catch(error=>{dialog.showErrorBox('sesshuttle',publicError(error).code);app.quit();});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{try{state?.close();}catch{}});
