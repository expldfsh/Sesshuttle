Sync selected Codex conversations between macOS and Linux using your own Cloudflare R2 bucket. Upload a chat from one device, import it on the other, and continue in the desktop app, CLI or VS Code.

| Platform / 平台 | Download / 下载 |
| --- | --- |
| Apple Silicon Mac | `sesshuttle-0.5.0-mac-arm64.dmg` |
| Arch and other x86_64 Linux | `sesshuttle-0.5.0-linux-x64.tar.gz` |
| Debian / Ubuntu x86_64 | `sesshuttle-0.5.0-linux-amd64.deb` |

The Mac build is unsigned and unnotarized. File checksums are in `SHA256SUMS-0.5.0.txt`.

上传前可以核对对话、附件和预计用量。要在另一台电脑续聊，选择「导入到这台电脑」。本机备份需手动创建，清除同步记录会保留对话和同步状态。

[English guide](https://github.com/expldfsh/Sesshuttle/blob/v0.5.0/docs/guides/en/quick-start.md) · [中文使用指南](https://github.com/expldfsh/Sesshuttle/blob/v0.5.0/docs/guides/zh-CN/quick-start.md)

Native imports require a recognized destination Codex runtime. 0.5.0 recognizes 0.164.0, 0.166.0, 0.164.0-alpha.11.1 and 0.166.0-alpha.5.1. An update to an unrecognized runtime blocks native import until compatibility is validated.

导入到本机 Codex 需要目标内核版本在上述名单内。升级前请核对内核版本；云端已有备份会保留。
