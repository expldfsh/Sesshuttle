import { contextBridge, ipcRenderer } from 'electron';
const methods=new Set(['init','detectPaths','refresh','saveConfig','pickDirectory','pickBinary','connect','disconnect','importRecovery','exportRecovery','preview','discardPlan','execute','cancel','backups','previewDelete','removeLocal','restoreDeleted','restore','diagnostics','projectInfo','continue']);
contextBridge.exposeInMainWorld('sesshuttle',{
 invoke:(method:string,args:unknown={})=>{if(!methods.has(method))throw new Error('Unknown action');return ipcRenderer.invoke('sesshuttle:request',method,args);},
 onClosePending:(callback:()=>void)=>{const listener=()=>callback();ipcRenderer.on('sesshuttle:closePending',listener);return()=>ipcRenderer.removeListener('sesshuttle:closePending',listener);},
 onProgress:(callback:(data:unknown)=>void)=>{const listener=(_:unknown,data:unknown)=>callback(data);ipcRenderer.on('sesshuttle:progress',listener);return()=>ipcRenderer.removeListener('sesshuttle:progress',listener);}
});
