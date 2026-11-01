import { build } from 'esbuild';
await build({entryPoints:['app/main/main.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist/main.cjs',external:['electron'],logLevel:'info'});
await build({entryPoints:['app/main/preload.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist/preload.cjs',external:['electron'],logLevel:'info'});
