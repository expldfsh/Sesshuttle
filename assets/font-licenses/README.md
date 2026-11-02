# Bundled fonts and palette

The renderer loads font files from its own installed resources with `@font-face`. There are no `local()` entries, remote font URLs or font downloads at runtime. This avoids dependence on fonts installed on the device. The full, unmodified TTF files include regular and emphasis weights; Chinese glyphs fall back from Comic Neue to LXGW WenKai. The system font is a final fallback for characters outside both fonts.

- [Comic Neue](https://github.com/google/fonts/tree/main/ofl/comicneue): Regular and Bold, SIL Open Font License 1.1. Source file identities and SHA-256 hashes are in `assets/fonts.json`.
- [LXGW WenKai v1.530](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530): Regular and Medium, SIL Open Font License 1.1. Both hashes match the release asset digests. Full glyph coverage is retained; no text subset is made.
- [Tokyo Night Moon palette](https://github.com/folke/tokyonight.nvim/blob/main/lua/tokyonight/colors/moon.lua): background `#222436`, panel `#1e2030`, foreground `#c8d3f5`, blue `#82aaff`. Secondary text uses a lighter `#a0a9cf` so small text remains readable on selected rows.

The package includes the font licenses and manifest, and `scripts/licenses.mjs` includes their notices in `THIRD_PARTY_NOTICES.txt`.

The interface uses 16px body text, 15–16px main controls, at least 13px supporting text and 1.55–1.8 line height. Measured text/background contrast: body 10.26:1, secondary text on selected rows 5.33:1, active navigation 5.37:1, success 8.74:1, warning 7.69:1, error 5.06:1, primary action 7.43:1. Disabled controls are intentionally dimmed. These checks do not assert full accessibility conformance.
