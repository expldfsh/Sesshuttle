// Packaged-window acceptance. Start a test-mode app with scripts/ui-fixture.mjs and a loopback exchange from scripts/cross-device.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const [debugPort,storagePort,exchange,language,phase='first',root,binary]=process.argv.slice(2);
const tempParents=[await fs.realpath(os.tmpdir()),await fs.realpath('/tmp')];
assert.ok(tempParents.includes(path.dirname(root))&&path.basename(root).startsWith('sesshuttle-ui-')&&await fs.realpath(root)===root);
assert.equal(JSON.parse(await fs.readFile(path.join(root,'.sesshuttle-test.json'))).format,1);
assert.ok(path.isAbsolute(binary)&&['first','reopen'].includes(phase));
const exchangeDir=await fs.realpath(path.dirname(exchange));
assert.ok(tempParents.includes(path.dirname(exchangeDir))&&path.basename(exchangeDir).startsWith('sesshuttle-')&&path.basename(exchange)==='exchange.json');
for(const p of [debugPort,storagePort])assert.ok(/^\d+$/.test(p)&&Number(p)>1023&&Number(p)<=65535);
const exchangeData=JSON.parse(await fs.readFile(exchange));
const zh=language==='zh-CN',tr=(a,b)=>zh?a:b;
let ws,page;
for(let i=0;i<150;i++){try{page=(await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json()).find(p=>p.url.startsWith('file:')&&p.url.endsWith('index.html'));if(page)break;}catch{}await delay(400);}
assert.ok(page);
ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let seq=0;const wait=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);wait.get(m.id)?.(m);wait.delete(m.id);};
async function run(expression){const id=++seq;const promise=new Promise(r=>wait.set(id,r));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const result=(await promise).result;if(result?.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??'page exception');return result?.result?.value;}
async function until(expr){for(let i=0;i<170;i++){if(await run('Boolean('+expr+')'))return;await delay(160);}throw Error('Timed out: '+expr+'\n'+(await run('document.body.innerText')).slice(-2600));}
async function click(label,scope='document'){const expr='[...'+scope+'.querySelectorAll("button")].find(b=>!b.disabled&&b.textContent.trim().startsWith('+JSON.stringify(label)+'))';await until(expr);await run(expr+'.click()');}
try{
 await until("document.querySelector('.sidebar-bottom')?.innerText.includes('0.6.0')");
 const init=await run("window.sesshuttle.invoke('init')");assert.ok(init.data.testMode);
 assert.ok(init.data.config.sourceHomes.every(p=>p.startsWith(root+path.sep)),'debug port must belong to the isolated fixture');
 if(phase==='first'){
  const dest=path.join(root,'destination');
  const cfg={...init.data.config,language,sourceHomes:[dest],targets:{desktop:{binary,home:dest},cli:{binary,home:dest},ide:{binary:'',home:dest}},bindings:{[exchangeData.sourceProject]:path.join(root,'demo-project 中文')},nativeBindings:{}};
  const saved=await run('window.sesshuttle.invoke("saveConfig",'+JSON.stringify(cfg)+')');assert.ok(saved.ok);
 }
 const connect={mode:'join',remember:false,endpoint:'http://127.0.0.1:'+storagePort,bucket:'sesshuttle-ui',accessKeyId:'fixture',secretAccessKey:'fixture',key:exchangeData.key,space:exchangeData.space};
 const connected=await run('window.sesshuttle.invoke("connect",'+JSON.stringify(connect)+')');assert.ok(connected.ok,JSON.stringify(connected));
 await run("setTimeout(()=>location.reload(),50)");await delay(600);
 await until("document.querySelector('.connection-state.on')");
 await click(tr('刷新','Refresh'));await until("document.querySelector('tbody tr')");
 await run("document.querySelector('tbody tr').click()");
 await click(tr('导入到这台电脑','Import to this computer'));
 await until("document.querySelector('.entry-choices')");
 if(phase==='first'){
  await until("document.querySelector('.runtime-check')");
  assert.equal(await run("Boolean(document.querySelector('.detection-layer'))"),false);
  await click(tr('检测本机 Codex 环境','Detect local Codex'),"document.querySelector('.flow')");
  await until("document.querySelector('.detection-layer')");assert.equal(await run("Boolean(document.querySelector('.detection-layer .modal-actions .primary:disabled'))"),false);
  await click(tr('使用当前路径，继续导入','Use current paths and continue'),"document.querySelector('.detection-layer')");
  await click(tr('使用此目录，仅导入历史','Use this folder for history only'));
  await click(tr('快速验证此内核','Run quick check'));
  await click(tr('取消本次验证','Cancel check'));
  await until("document.querySelector('.runtime-check')?.innerText.includes("+JSON.stringify(tr('已取消验证','Check cancelled'))+")");
  await click(tr('重新快速验证','Retry quick check'));
  await until("document.querySelector('.runtime-ready')?.innerText.includes("+JSON.stringify(tr('本机验证已通过','Verified on this computer'))+")");
 }else{
  await until("document.querySelector('.runtime-ready')");
  assert.equal(await run("Boolean(document.querySelector('.runtime-check'))"),false);
 }
 await click(tr('查看本次清单','Review transfer'));
 await until("document.querySelector('.scope-item')");
 if(phase==='first'){
  await click(tr('确认导入到','Confirm import to'));
  const target=path.join(root,'destination');
  await until("document.querySelector('.task-feedback.attention')?.innerText.includes('sesshuttle_fixture')");
  assert.ok((await run("document.querySelector('.task-feedback').innerText")).includes(tr('模型服务','model provider')));
  const histories=await fs.readdir(path.join(target,'sessions'),{recursive:true}).catch(()=>[]);
  assert.ok(!histories.some(f=>f.endsWith('.jsonl')),'provider must be checked before writing the selected history');
  for(const file of (await fs.readdir(target)).filter(f=>/^state_.*sqlite$/.test(f))){
   const db=new DatabaseSync(path.join(target,file),{readOnly:true});
   try{assert.equal(db.prepare('select count(*) as n from threads where id=?').get(exchangeData.tid).n,0);}finally{db.close();}
  }
  await fs.writeFile(path.join(target,'config.toml'),'model_provider = "sesshuttle_fixture"\nmodel = "gpt-6.1-sol"\n[model_providers.sesshuttle_fixture]\nname = "Local sample"\nbase_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n');
  await click(tr('配置服务后重试导入','Retry after configuring the provider'));
  await until("document.querySelector('.runtime-ready')");assert.equal(await run("Boolean(document.querySelector('.runtime-check'))"),false);
  await click(tr('查看本次清单','Review transfer'));await click(tr('确认导入到','Confirm import to'));
  await until("document.querySelector('.task-feedback.success')");
  assert.ok((await run("document.querySelector('.task-feedback').innerText")).includes(tr('GPT 桌面端','GPT desktop')));
 }
 console.log('PASS packaged import ('+language+', '+phase+')');
}finally{ws.close();}
