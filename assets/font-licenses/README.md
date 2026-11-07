# Bundled fonts and palette

The renderer loads font files from its own installed resources with `@font-face`. There are no `local()` entries, remote font URLs or font downloads at runtime. This avoids dependence on fonts installed on the device. The fonts ship as WOFF2 files losslessly converted from the official TTF releases: every glyph, weight and table is kept (only the TTF's digital signature table `DSIG`, which cannot survive re-encoding, is dropped). Regular and emphasis weights are included; Chinese glyphs fall back from Comic Neue to LXGW WenKai. The system font is a final fallback for characters outside both fonts.

To reproduce the WOFF2 files, download the four official TTFs listed below into one folder and run:

```bash
pip install fonttools brotli
node scripts/fonts.mjs <folder with the TTF files> --python=python3
```

The script checks each TTF against its published SHA-256, converts it with `fontTools.ttLib.woff2`, compares every table and glyph outline of the result with the source, and rewrites `assets/fonts.json` with the source and output hashes. The bundled files were produced with fontTools 4.68.0 and brotli 1.2.1; the output is byte-for-byte reproducible with those versions.

- [Comic Neue](https://github.com/google/fonts/tree/main/ofl/comicneue): Regular and Bold, SIL Open Font License 1.1. Source URLs, source and output SHA-256 hashes are in `assets/fonts.json`.
- [LXGW WenKai v1.530](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530): Regular and Medium, SIL Open Font License 1.1. Both source hashes match the release asset digests. Full glyph coverage is retained; no text subset is made.
- [Tokyo Night Moon palette](https://github.com/folke/tokyonight.nvim/blob/main/lua/tokyonight/colors/moon.lua): background `#222436`, panel `#1e2030`, foreground `#c8d3f5`, blue `#82aaff`. Secondary text uses a lighter `#a0a9cf` so small text remains readable on selected rows.

The package includes the font licenses and manifest, and `scripts/licenses.mjs` includes their notices in `THIRD_PARTY_NOTICES.txt`.

The interface uses 16px body text, 15–16px main controls, at least 13px supporting text and 1.55–1.8 line height. Measured text/background contrast: body 10.26:1, secondary text on selected rows 5.33:1, active navigation 5.37:1, success 8.74:1, warning 7.69:1, error 5.06:1, primary action 7.43:1. Disabled controls are intentionally dimmed. These checks do not assert full accessibility conformance.
