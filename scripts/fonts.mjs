// Reproducible, lossless WOFF2 conversion of the bundled fonts.
// Usage: node scripts/fonts.mjs <folder with the official TTF files> [--python=<path>]
// The Python interpreter needs fontTools and brotli: pip install fonttools brotli
// Each TTF must match its published SHA-256. After conversion every font table and
// every glyph outline is compared with the source; assets/fonts.json is rewritten.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCES = [
  {
    name: 'ComicNeue-Regular',
    family: 'Comic Neue',
    weight: 400,
    source:
      'https://raw.githubusercontent.com/google/fonts/main/ofl/comicneue/ComicNeue-Regular.ttf',
    sha256: 'a0ee5a37c8b27c4db0700137d928598b1e23b0089e1546a8961909176b779360',
  },
  {
    name: 'ComicNeue-Bold',
    family: 'Comic Neue',
    weight: 700,
    source: 'https://raw.githubusercontent.com/google/fonts/main/ofl/comicneue/ComicNeue-Bold.ttf',
    sha256: '3e7e5fccfd7e0788f317b43312151c1bd5cf058c9697a8d83eac3939050bd61e',
  },
  {
    name: 'LXGWWenKai-Regular',
    family: 'LXGW WenKai',
    weight: 400,
    source: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf',
    sha256: '2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b',
  },
  {
    name: 'LXGWWenKai-Medium',
    family: 'LXGW WenKai',
    weight: 500,
    source: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Medium.ttf',
    sha256: 'f4b8a34d1f838fe411540cb7c97b1c384ac9738a876c4104500bc42508b2312a',
  },
];

// Compares the decoded WOFF2 with the TTF: same tables (apart from DSIG), same glyph order and
// cmap, byte-identical glyph outlines and identical data for every other table.
const VERIFY = `
import sys
from fontTools.ttLib import TTFont
a, b = TTFont(sys.argv[1]), TTFont(sys.argv[2])
# A digital signature cannot survive re-encoding; WOFF2 drops DSIG and nothing else.
tables = lambda f: sorted(k for k in f.keys() if k != 'DSIG')
assert tables(a) == tables(b), 'tables differ'
assert a.getGlyphOrder() == b.getGlyphOrder(), 'glyph order differs'
assert a.getBestCmap() == b.getBestCmap(), 'cmap differs'
if 'glyf' in a:
    ga, gb = a['glyf'], b['glyf']
    for name in a.getGlyphOrder():
        x, y = ga[name], gb[name]
        x.expand(ga); y.expand(gb)
        assert x.compile(ga, recalcBBoxes=False) == y.compile(gb, recalcBBoxes=False), name
for tag in a.keys():
    if tag in ('GlyphOrder', 'head', 'glyf', 'loca', 'hmtx', 'DSIG'):
        continue
    assert a.getTableData(tag) == b.getTableData(tag), tag
assert a['hmtx'].metrics == b['hmtx'].metrics, 'hmtx differs'
for field in ('unitsPerEm', 'xMin', 'yMin', 'xMax', 'yMax', 'macStyle', 'indexToLocFormat'):
    assert getattr(a['head'], field) == getattr(b['head'], field), field
print(len(a.getGlyphOrder()))
`;

const [folder, ...options] = process.argv.slice(2);
if (!folder) throw Error('Usage: node scripts/fonts.mjs <folder with official TTF files>');
const python =
  options.find((o) => o.startsWith('--python='))?.slice('--python='.length) ?? 'python3';
const repo = path.resolve(import.meta.dirname, '..');
const out = path.join(repo, 'app/renderer/fonts');
const versions = execFileSync(
  python,
  ['-c', 'import fontTools, brotli; print(fontTools.version, brotli.__version__)'],
  { encoding: 'utf8' },
)
  .trim()
  .split(' ');
const sha = (data) => createHash('sha256').update(data).digest('hex');
await fs.mkdir(out, { recursive: true });
const fonts = [];
for (const font of SOURCES) {
  const ttf = path.join(folder, font.name + '.ttf');
  const original = await fs.readFile(ttf);
  if (sha(original) !== font.sha256) throw Error(font.name + ': not the official TTF');
  const woff2 = path.join(out, font.name + '.woff2');
  execFileSync(python, ['-m', 'fontTools.ttLib.woff2', 'compress', '-o', woff2, ttf], {
    stdio: 'inherit',
  });
  const glyphs = execFileSync(python, ['-c', VERIFY, ttf, woff2], { encoding: 'utf8' }).trim();
  const converted = await fs.readFile(woff2);
  fonts.push({
    file: path.relative(repo, woff2),
    family: font.family,
    weight: font.weight,
    glyphs: Number(glyphs),
    sha256: sha(converted),
    bytes: converted.length,
    source: font.source,
    sourceSha256: font.sha256,
    sourceBytes: original.length,
  });
  console.log(`${font.name}: ${original.length} → ${converted.length} bytes, ${glyphs} glyphs`);
}
await fs.writeFile(
  path.join(repo, 'assets/fonts.json'),
  JSON.stringify(
    {
      format: 1,
      license: 'SIL Open Font License 1.1',
      conversion: `由官方 TTF 无损转换为 WOFF2 / Losslessly converted from the official TTF to WOFF2 (fontTools ${versions[0]}, brotli ${versions[1]}, scripts/fonts.mjs)`,
      fonts,
    },
    null,
    2,
  ) + '\n',
);
