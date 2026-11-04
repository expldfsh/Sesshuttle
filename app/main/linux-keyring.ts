// Use the desktop Secret Service directly. A provider's prompt belongs to the
// requesting bus connection, so keep it open from Unlock through Completed.
import {Message,MessageType,sessionBus,Variant} from 'dbus-next';
import {createCipheriv,createDecipheriv,createDiffieHellman,hkdfSync,randomBytes} from 'node:crypto';
import {Fault,requireThat} from '../../core/util.mjs';

const service='org.freedesktop.secrets', root='/org/freedesktop/secrets';
const iface='org.freedesktop.Secret.', daemon='org.freedesktop.DBus';
const daemonPath='/org/freedesktop/DBus';
const group2=Buffer.from('ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece65381ffffffffffffffff','hex');

type Call=(path:string,intf:string,method:string,signature?:string,body?:any[])=>Promise<any[]>;
type Prompt=(path:string)=>Promise<any>;
function localBusAddress(){
  const address=process.env.DBUS_SESSION_BUS_ADDRESS ?? ('unix:path='+(process.env.XDG_RUNTIME_DIR || '/run/user/'+process.getuid?.())+'/bus');
  for(const part of address.split(';')){
    const match=/^unix:(?:[^;]*,)?(path|abstract)=([^,;]+)/.exec(part);
    if(match)return 'unix:socket='+(match[1]==='abstract'?'\0':'')+decodeURIComponent(match[2]);
  }
  throw new Fault('credential_service_unavailable');
}

async function withProvider<T>(operation:(call:Call,prompt:Prompt,collection:string)=>Promise<T>):Promise<T>{
  const bus=sessionBus({busAddress:localBusAddress(),authMethods:['EXTERNAL']});
  let owner='',lost:(e:unknown)=>void=()=>{};
  const disconnected=new Promise<never>((_,reject)=>{lost=reject;});
  const unavailable=()=>lost(new Fault('credential_service_unavailable'));
  bus.on('error',unavailable);
  // dbus-next only forwards errors, not a clean EOF from the session bus.
  (bus as any)._connection.once('end',unavailable);
  const send=async(destination:string,path:string,intf:string,method:string,signature='',body:any[]=[])=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      // Ordinary method replies are bounded. A password prompt completes via a signal.
      return await Promise.race([bus.call(new Message({destination,path,interface:intf,member:method,signature,body})),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Fault('credential_service_timeout')),20000);})]);
    }finally{clearTimeout(timer);}
  };
  const call:Call=async(path,intf,method,signature='',body=[])=>{
    const reply=await send(owner,path,intf,method,signature,body);
    return reply!.body;
  };
  const match=(rule:string)=>send(daemon,daemonPath,daemon,'AddMatch','s',[rule]);
  const prompt:Prompt=async path=>{
    if(path==='/')return;
    await match("type='signal',sender='"+owner+"',path='"+path+"',interface='"+iface+"Prompt',member='Completed'");
    let receive:(msg:Message)=>void=()=>{};
    const done=new Promise<any>((resolve,reject)=>{
      receive=msg=>{
        if(msg.type!==MessageType.SIGNAL||msg.sender!==owner||msg.path!==path||msg.interface!==iface+'Prompt'||msg.member!=='Completed')return;
        if(msg.body[0])reject(new Fault('credential_cancelled'));else resolve(msg.body[1].value);
      };
      bus.on('message',receive);
    });
    try{return (await Promise.all([done,call(path,iface+'Prompt','Prompt','s',[''])]))[0];}
    finally{bus.off('message',receive);}
  };
  async function run(){
    await match("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='"+service+"'");
    bus.on('message',(m:Message)=>{
      if(owner&&m.sender===daemon&&m.interface===daemon&&m.member==='NameOwnerChanged'&&m.body[0]===service&&m.body[1]===owner)unavailable();
    });
    const alias=await send(service,root,iface+'Service','ReadAlias','s',['default']);
    owner=alias!.sender;
    return operation(call,prompt,alias!.body[0]);
  }
  try{return await Promise.race([run(),disconnected]);}
  catch(e:any){
    if(e instanceof Fault)throw e;
    if(!owner||/ServiceUnknown|NameHasNoOwner|Disconnected/.test(e.type??''))throw new Fault('credential_service_unavailable');
    if(/IsLocked/.test(e.type??''))throw new Fault('credential_locked');
    throw new Fault('credential_provider_failed');
  }finally{bus.disconnect();}
}

export async function linuxKeyringHealth(){
  return withProvider(async(call,_prompt,collection)=>{
    if(collection==='/')return {service:true,locked:false,hasDefault:false};
    const [value]=await call(collection,'org.freedesktop.DBus.Properties','Get','ss',[iface+'Collection','Locked']);
    return {service:true,locked:!!value.value,hasDefault:true};
  });
}

async function unlock(call:Call,prompt:Prompt,path:string) {
  const [opened,dialog]=await call(root,iface+'Service','Unlock','ao',[[path]]);
  const after=await prompt(dialog);
  requireThat(opened.includes(path)||after?.includes(path),'credential_locked');
}

async function secretSession(call:Call){
  // Electron's crypto supports explicit RFC 2409 parameters rather than the modp2 alias.
  const dh=createDiffieHellman(group2,2);
  try{
    const [peer,path]=await call(root,iface+'Service','OpenSession','sv',['dh-ietf1024-sha256-aes128-cbc-pkcs7',new Variant('ay',dh.generateKeys())]);
    const shared=dh.computeSecret(Buffer.from(peer.value));
    const key=Buffer.from(hkdfSync('sha256',shared,Buffer.alloc(0),Buffer.alloc(0),16));
    shared.fill(0);
    return {path,key};
  }catch(e:any){
    // The Secret Service specification also supports plain transport over this
    // local, user-authenticated Unix socket. Storage is still owned by the keyring.
    if(!/NotSupported$/.test(e.type??''))throw e;
    const [,path]=await call(root,iface+'Service','OpenSession','sv',['plain',new Variant('s','')]);
    return {path,key:null};
  }
}

export async function linuxCredential(reference:string,input?:string):Promise<string>{
  return withProvider(async(call,prompt,collection)=>{
    const attributes={application:'sesshuttle',profile:reference};
    const [open,locked]=await call(root,iface+'Service','SearchItems','a{ss}',[attributes]);
    const item=open[0]??locked[0];
    if(!item&&input===undefined)throw new Fault('credential_item_missing');
    if(!item&&collection==='/'){
      const [created,dialog]=await call(root,iface+'Service','CreateCollection','a{sv}s',[{[iface+'Collection.Label']:new Variant('s','Login')},'default']);
      collection=await prompt(dialog)??created;
      requireThat(collection&&collection!=='/','credential_cancelled');
    }
    if(!item||!open.includes(item))await unlock(call,prompt,item??collection);
    const session=await secretSession(call);
    try{
      if(input===undefined){
        const [[path,iv,ciphertext]]=await call(item,iface+'Item','GetSecret','o',[session.path]);
        requireThat(path===session.path,'credential_restore_failed');
        if(!session.key)return Buffer.from(ciphertext).toString();
        const decipher=createDecipheriv('aes-128-cbc',session.key,Buffer.from(iv));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext)),decipher.final()]).toString();
      }
      const iv=session.key?randomBytes(16):Buffer.alloc(0);
      const cipher=session.key?createCipheriv('aes-128-cbc',session.key,iv):null;
      const bytes=cipher?Buffer.concat([cipher.update(input,'utf8'),cipher.final()]):Buffer.from(input);
      const secret=[session.path,iv,bytes,'text/plain'];
      if(item)await call(item,iface+'Item','SetSecret','(oayays)',[secret]);
      else{
        const [created,dialog]=await call(collection,iface+'Collection','CreateItem','a{sv}(oayays)b',[
          {[iface+'Item.Label']:new Variant('s','Sesshuttle R2'),[iface+'Item.Attributes']:new Variant('a{ss}',attributes)},secret,true]);
        requireThat((await prompt(dialog)??created)!=='/','credential_write_failed');
      }
      return '';
    }finally{session.key?.fill(0);}
  });
}
