import { app,BrowserWindow,ipcMain,dialog,safeStorage,session,shell,Menu } from 'electron';
import fs from 'node:fs/promises';import {realpathSync,readFileSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import { pathToFileURL } from 'node:url';import { execFile,spawn } from 'node:child_process';import { promisify } from 'node:util';
import { State } from '../../core/state.mjs';import { Engine } from '../../core/engine.mjs';import { R2Store } from '../../core/storage.mjs';import { Vault } from '../../core/vault.mjs';
import { newKey,parseKey } from '../../core/crypto.mjs';import { Fault,requireThat,publicError,id,atomic,exists,canonical,inside } from '../../core/util.mjs';import { Importer } from '../../core/importer.mjs';
const exec=promisify(execFile);let window:BrowserWindow;let state:any,engine:any;let secrets:any=null;let recovery:any=null;
const testRoot=process.env.SESSHUTTLE_TEST_ROOT;
if(testRoot){const canonicalRoot=realpathSync(testRoot);const tempRoots=[realpathSync(os.tmpdir()),realpathSync('/tmp')];requireThat(canonicalRoot===testRoot&&path.basename(testRoot).startsWith('sesshuttle-')&&tempRoots.some(p=>testRoot.startsWith(p+path.sep))&&JSON.parse(readFileSync(path.join(testRoot,'.sesshuttle-test.json'),'utf8')).format===1,'unsafe_path');app.setPath('userData',path.join(testRoot,'app-data'));}
const renderer=path.join(__dirname,'renderer','index.html');
function updateMenu(){const zh=state?.get('config')?.language==='zh-CN';const text=(a:string,b:string)=>zh?a:b;
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{label:'sesshuttle',submenu:[{role:'about' as const,label:text('关于 sesshuttle','About sesshuttle')},{type:'separator' as const},{role:'quit' as const,label:text('退出 sesshuttle','Quit sesshuttle')}]}]:[]),
  {label:text('编辑','Edit'),submenu:[{role:'undo',label:text('撤销','Undo')},{role:'redo',label:text('重做','Redo')},{type:'separator'},{role:'cut',label:text('剪切','Cut')},{role:'copy',label:text('复制','Copy')},{role:'paste',label:text('粘贴','Paste')},{role:'selectAll',label:text('全选','Select all')}]},
  {label:text('窗口','Window'),submenu:[{role:'minimize',label:text('最小化','Minimize')},{role:'close',label:text('关闭','Close')}]}
 ]));
}
async function discover(){const home=testRoot?path.join(testRoot,'codex'):path.join(os.homedir(),'.codex');const targets:any={desktop:{home,binary:''},cli:{home,binary:''},ide:{home,binary:''}};
 const candidates=process.platform==='darwin'?['/opt/homebrew/bin/codex','/usr/local/bin/codex']:process.platform==='win32'?[]:['/usr/local/bin/codex',path.join(os.homedir(),'.local/bin/codex')];
 for(const p of (process.env.PATH??'').split(path.delimiter).filter(p=>path.isAbsolute(p)))candidates.push(path.join(p,process.platform==='win32'?'codex.exe':'codex'));
 for(const p of candidates)if(await exists(p)){targets.cli.binary=p;break;}
 if(process.platform==='darwin')for(const p of ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex','/Applications/Codex.app/Contents/Resources/codex'])if(await exists(p)){targets.desktop.binary=p;break;}
 try{const extensions=path.join(os.homedir(),'.vscode/extensions');const folders=(await fs.readdir(extensions)).filter(x=>x.startsWith('openai.chatgpt-')).sort().reverse();
  for(const folder of folders){const sub=process.platform==='darwin'?'macos-aarch64':process.platform==='win32'?'windows-x86_64':'linux-x86_64';const bin=path.join(extensions,folder,'bin',sub,process.platform==='win32'?'codex.exe':'codex');if(await exists(bin)){targets.ide.binary=bin;break;}}
 }catch{}
 return {language:app.getLocale().startsWith('zh')?'zh-CN':'en',sourceHomes:[home],targets,bindings:{}};
}
async function saveSecrets(value:any){requireThat(!testRoot,'test_mode');requireThat(await safeStorage.isAsyncEncryptionAvailable(),'secure_storage_unavailable');
 if(process.platform==='linux')requireThat(safeStorage.getSelectedStorageBackend()!=='basic_text','secure_storage_unavailable');
 const encrypted=await safeStorage.encryptStringAsync(JSON.stringify({...value,connection:state.get('connection')}));
 await atomic(path.join(state.root,'connection-secret.bin'),encrypted);
}
async function loadSecrets(){try{const cfg=state.get('connection');if(!cfg||!await exists(path.join(state.root,'connection-secret.bin')))return;
 const value=JSON.parse((await safeStorage.decryptStringAsync(await fs.readFile(path.join(state.root,'connection-secret.bin')))).result);
 requireThat(JSON.stringify(value.connection)===JSON.stringify(cfg),'secure_storage_unavailable');
 secrets={credentials:value.credentials,key:value.key};engine.vault=new Vault(new R2Store({...cfg,...value.credentials}),cfg.space,value.key);
 }catch{state.set('credentialError','secure_storage_unavailable');}}
async function saveConfig(input:any){requireThat(!engine.running,'task_running');requireThat(input&&['zh-CN','en'].includes(input.language)&&Array.isArray(input.sourceHomes)&&input.sourceHomes.length<=20,'invalid_settings');
 const cfg:any={language:input.language,sourceHomes:[],targets:{},bindings:{}};
 for(const p of input.sourceHomes.filter((x:any)=>x!=='')){requireThat(typeof p==='string'&&path.isAbsolute(p),'invalid_path');cfg.sourceHomes.push(p);}
 for(const entry of ['desktop','cli','ide']){const t=input.targets?.[entry]??{};for(const k of ['home','binary'])requireThat(typeof(t[k]??'')==='string'&&(!t[k]||path.isAbsolute(t[k])),'invalid_path');cfg.targets[entry]={home:t.home??'',binary:t.binary??''};}
 for(const [k,v]of Object.entries(input.bindings??{})){requireThat(/^[0-9a-f-]{36}$/i.test(k)&&typeof v==='string'&&path.isAbsolute(v),'invalid_path');cfg.bindings[k]=v;}
 if(testRoot){for(const p of cfg.sourceHomes)await inside(testRoot,path.join(p,'check'));for(const t of Object.values(cfg.targets) as any[])if(t.home)await inside(testRoot,path.join(t.home,'check'));}
 state.set('config',cfg);updateMenu();if(input.deviceName){requireThat(typeof input.deviceName==='string'&&input.deviceName.length<=80,'invalid_settings');state.set('device',{...state.get('device'),name:input.deviceName});}
 return cfg;
}
async function connect(input:any){requireThat(!engine.running,'task_running');const cfg={endpoint:String(input.endpoint??'').trim(),bucket:String(input.bucket??'').trim()};
 const credentials={accessKeyId:String(input.accessKeyId??''),secretAccessKey:String(input.secretAccessKey??'')};requireThat(credentials.accessKeyId&&credentials.secretAccessKey,'credentials_required');const store=new R2Store({...cfg,...credentials},testRoot?{allowLocal:true}:{});
 await store.test();if(input.mode==='test')return {status:'connected'};
 const space=input.mode==='create'?id():(recovery?.space??String(input.space??''));const key=input.mode==='create'?newKey():(recovery?.key??String(input.key??''));parseKey(key);
 const vault=new Vault(store,space,key);if(input.mode==='create')await vault.create();else await vault.open();
 // If secure persistence is unavailable, keep the successful connection in memory
 // and return an explicit warning; never write plaintext credentials.
 secrets={credentials,key};engine.vault=vault;state.set('connection',{...cfg,space});recovery=null;
 let warning=null;try{await saveSecrets(secrets);state.set('credentialError',null);}catch(e){warning='secure_storage_unavailable';state.set('credentialError',warning);}
 return {status:'connected',space,warning};
}
async function projectInfo(project:string){await canonical(project);try{
 const options={cwd:project,timeout:5000,maxBuffer:65536};const [branch,commit,dirty]=await Promise.all([exec('git',['branch','--show-current'],options),exec('git',['rev-parse','HEAD'],options),exec('git',['status','--short'],options)]);
 return {branch:branch.stdout.trim(),commit:commit.stdout.trim(),changes:dirty.stdout.trim().split('\n').filter(Boolean).length};
 }catch{return {git:false};}}
async function continueEntry({logicalId,entry}:any){requireThat(['desktop','cli','ide'].includes(entry),'invalid_selection');const record=state.get('entries/'+engine.scope()+'/'+logicalId,{})[entry];requireThat(record&&record.status==='verified','not_verified');await canonical(record.project);
 const cfg=engine.config(),target=cfg.targets[entry];requireThat(target?.home===record.home&&target.binary===record.binary&&cfg.bindings[state.get('association/'+logicalId)?.projectId]===record.project,'stale_plan');
 // Open the native entry without submitting a prompt or executing a historical command.
 if(entry==='desktop'||entry==='ide')requireThat(await canonical(record.home)===await canonical(path.join(os.homedir(),'.codex')),'custom_home_launcher');
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
async function request(method:string,args:any){switch(method){
 case 'init':return {config:engine.config(),device:state.get('device'),connection:state.get('connection'),connected:!!engine.vault,credentialError:state.get('credentialError'),version:app.getVersion(),testMode:!!testRoot,jobs:state.keys('job/').map((k:string)=>state.get(k)).sort((a:any,b:any)=>b.startedAt.localeCompare(a.startedAt)).slice(0,10)};
 case 'saveConfig':return saveConfig(args);
 case 'refresh':return engine.refresh();
 case 'pickDirectory':{const r=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];}
 case 'pickBinary':{const r=await dialog.showOpenDialog(window,{properties:['openFile']});return r.canceled?null:r.filePaths[0];}
 case 'connect':return connect(args);
 case 'disconnect':requireThat(!engine.running,'task_running');engine.vault=null;secrets=null;state.set('connection',null);return {status:'disconnected'};
 case 'importRecovery':{const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'sesshuttle',extensions:['json']}]});if(r.canceled)return null;
  const stat=await fs.stat(r.filePaths[0]);requireThat(stat.size<16384,'invalid_key');const x=JSON.parse(await fs.readFile(r.filePaths[0],'utf8'));requireThat(x.format===1&&typeof x.space==='string','invalid_key');parseKey(x.key);recovery=x;return {space:x.space,endpoint:x.endpoint,bucket:x.bucket};}
 case 'exportRecovery':{requireThat(secrets&&engine.vault,'storage_not_connected');const r=await dialog.showSaveDialog(window,{defaultPath:'sesshuttle-recovery.json'});if(r.canceled||!r.filePath)return null;
  await atomic(r.filePath,JSON.stringify({format:1,...state.get('connection'),key:secrets.key},null,2));return {saved:true};}
 case 'preview':return engine.preview(args);
 case 'execute':return engine.execute(args.token);
 case 'cancel':engine.cancel();return {status:'pausing'};
 case 'backups':return {backups:state.keys('backup/').map((k:string)=>state.get(k)),imports:state.keys('import/').map((k:string)=>state.get(k))};
 case 'restore':requireThat(!engine.running,'task_running');engine.running=true;try{return await engine.importer.restore(args.id);}finally{engine.running=false;}
 case 'projectInfo':return projectInfo(args.project);
 case 'continue':requireThat(!engine.running,'task_running');return continueEntry(args);
 case 'diagnostics':return {version:app.getVersion(),platform:process.platform,arch:process.arch,scanErrors:engine.local.errors.map((e:any)=>({code:e.code})),jobs:state.keys('job/').slice(-10).map((k:string)=>{const j=state.get(k);return {startedAt:j.startedAt,status:j.status,items:j.items.map((i:any)=>({action:i.action,status:i.status,error:i.error?.code}))};})};
 default:throw new Fault('invalid_action');
}}
app.whenReady().then(async()=>{
 if(testRoot){await fs.mkdir(testRoot,{recursive:true});requireThat(await canonical(testRoot)===testRoot,'unsafe_path');await fs.mkdir(path.join(testRoot,'codex'),{recursive:true});}
 state=new State(app.getPath('userData'));if(!state.get('config'))state.set('config',await discover());
 const importer=new Importer(state,(testRoot?{testRoot,processGuard:async()=>{}}:{}) as any);
 for(const k of state.keys('job/')){const j=state.get(k);if(j.status==='running')state.set(k,{...j,status:'interrupted'});}
 for(const k of state.keys('import/')){const task=state.get(k);if(['prepared','validating'].includes(task.status))state.set(k,{...task,status:'needs_recovery'});}
 engine=new Engine(state,{importer,onProgress:(data:any)=>window?.webContents.send('sesshuttle:progress',data)} as any);await loadSecrets();
 updateMenu();
 session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 window=new BrowserWindow({width:1320,height:860,minWidth:980,minHeight:680,title:'sesshuttle',backgroundColor:'#f5f6f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(renderer).href)event.preventDefault();});
 ipcMain.handle('sesshuttle:request',async(event,method,args)=>{try{requireThat(event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(renderer).href,'invalid_action');requireThat(typeof method==='string'&&JSON.stringify(args).length<256000,'invalid_action');return {ok:true,data:await request(method,args)};}catch(e){return {ok:false,error:publicError(e)};}});
 window.on('close',event=>{if(engine.running){event.preventDefault();engine.cancel();window.webContents.send('sesshuttle:closePending');}});
 await window.loadFile(renderer);
});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{try{state?.close();}catch{}});
