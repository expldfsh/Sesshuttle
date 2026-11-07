import { contextBridge, ipcRenderer } from 'electron';
import { isIpcMethod } from '../shared/ipc';

function subscribe<T>(channel: string, callback: (data: T) => void) {
  const listener = (_: unknown, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sesshuttle', {
  invoke: (method: string, args: unknown = {}) => {
    if (!isIpcMethod(method)) throw new Error('Unknown action');
    return ipcRenderer.invoke('sesshuttle:request', method, args);
  },
  onClosePending: (callback: (removal: boolean) => void) =>
    subscribe('sesshuttle:closePending', callback),
  onRuntimeStage: (callback: (data: unknown) => void) => subscribe('sesshuttle:runtime', callback),
  onProgress: (callback: (data: unknown) => void) => subscribe('sesshuttle:progress', callback),
});
