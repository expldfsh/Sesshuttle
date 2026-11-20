// LLVM-MinGW supports both native builds and cross-compiling the same x64 executable.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';

const dir = path.resolve('dist/windows-build');
await fs.mkdir(dir, { recursive: true });
const svg = await fs.readFile('assets/icon.svg');
const sizes = [16, 32, 48, 256];
const images = sizes.map((value) =>
  new Resvg(svg, { fitTo: { mode: 'width', value } }).render().asPng(),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, png] of images.entries()) {
  const entry = 6 + 16 * i;
  header[entry] = header[entry + 1] = sizes[i] % 256;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
await fs.writeFile(path.join(dir, 'icon.ico'), Buffer.concat([header, ...images]));
await fs.copyFile('app/launcher/windows.manifest', path.join(dir, 'launcher.manifest'));
// What Windows shows for the program in its properties and in Task Manager.
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const copyright = (await fs.readFile('LICENSE', 'utf8')).match(/^Copyright .+$/m)?.[0] ?? '';
const numbers = pkg.version
  .split(/[.+-]/)
  .slice(0, 3)
  .map((part) => Number(part) || 0)
  .concat(0)
  .join(',');
const text = (value) =>
  '"' +
  String(value)
    .replace(/[^\x20-\x7e]/g, '?')
    .replaceAll('"', '""') +
  '"';
const details = {
  CompanyName: pkg.author.name,
  FileDescription: 'Sesshuttle',
  FileVersion: pkg.version,
  InternalName: 'Sesshuttle',
  LegalCopyright: copyright,
  OriginalFilename: 'Sesshuttle.exe',
  ProductName: 'Sesshuttle',
  ProductVersion: pkg.version,
};
await fs.writeFile(
  path.join(dir, 'launcher.rc'),
  [
    '1 ICON "icon.ico"',
    '1 24 "launcher.manifest"',
    '1 VERSIONINFO',
    'FILEVERSION ' + numbers,
    'PRODUCTVERSION ' + numbers,
    'FILEOS 0x40004',
    'FILETYPE 0x1',
    'BEGIN',
    '  BLOCK "StringFileInfo"',
    '  BEGIN',
    '    BLOCK "040904b0"',
    '    BEGIN',
    ...Object.entries(details).map(([name, value]) => `      VALUE "${name}", ${text(value)}`),
    '    END',
    '  END',
    '  BLOCK "VarFileInfo"',
    '  BEGIN',
    '    VALUE "Translation", 0x409, 1200',
    '  END',
    'END',
    '',
  ].join('\n'),
);
const tool = (name) =>
  path.join(process.env.SESSHUTTLE_MINGW_BIN || '', 'x86_64-w64-mingw32-' + name);
execFileSync(tool('windres'), ['launcher.rc', '-O', 'coff', '-o', 'launcher.o'], {
  cwd: dir,
  stdio: 'inherit',
});
execFileSync(
  tool('g++'),
  [
    '-O2',
    '-std=c++17',
    '-static',
    '-municode',
    '-mwindows',
    'app/launcher/windows.cpp',
    path.join(dir, 'launcher.o'),
    '-lshell32',
    '-lole32',
    '-luuid',
    '-o',
    'dist/Sesshuttle.exe',
  ],
  { stdio: 'inherit' },
);
