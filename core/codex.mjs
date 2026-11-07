import {scanHistory} from './scanner.mjs';
export const KNOWN_VERSIONS=['0.166.0','0.164.0','0.164.0-alpha.11.1','0.166.0-alpha.5.1'];
export function sourceOf(meta){
 if(typeof meta.source==='object'&&meta.source?.subagent) return 'subagent';
 if(['codex_work_desktop','codex_desktop'].includes(meta.originator))return 'desktop';
 if(meta.source==='cli'||meta.source==='exec')return 'cli';
 if(meta.source==='vscode'&&['codex_vscode','codex_ide'].includes(meta.originator))return 'ide';
 return 'unknown';
}
export async function scan(homes) {return scanHistory(homes,{sourceOf});}
export function imageType(b){if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';if(/^GIF8[79]a$/.test(b.subarray(0,6).toString()))return 'gif';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'webp';return null;}
