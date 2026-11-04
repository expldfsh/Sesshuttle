import {execFileSync} from 'node:child_process';
import {realpathSync,existsSync} from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
await build({entryPoints:['app/main/main.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist/main.cjs',external:['electron','usocket','x11'],logLevel:'info'});
await build({entryPoints:['app/main/preload.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist/preload.cjs',external:['electron'],logLevel:'info'});

if(process.platform==='darwin'){
  const headers=path.resolve(path.dirname(realpathSync(process.execPath)),'../include/node');
  if(!existsSync(path.join(headers,'node_api.h')))throw Error('macOS build requires the Node.js installation headers at '+headers);
  execFileSync('xcrun',['clang++','-std=c++17','-O2','-Wno-deprecated-declarations','-arch','arm64','-arch','x86_64','-mmacosx-version-min=13.0',
    '-bundle','-undefined','dynamic_lookup','-I'+headers,'-framework','Security','-framework','CoreFoundation',
    'app/main/macos-keychain.mm','-o','dist/macos-keychain.node'],{stdio:'inherit'});
}
