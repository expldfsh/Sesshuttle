# Sesshuttle

[English](README.md) · 简体中文

在另一台电脑上继续同一个 Codex 对话。在 Mac 上选中对话，把历史加密上传到自己的 Cloudflare R2，再在 Linux 导入，接着聊。同步哪些对话、何时传输都由你决定。支持 GPT 桌面端中的 Codex、CLI 和 VS Code。

![勾选对话后，在操作栏点击标出的「上传到云端」](docs/images/zh-CN-upload.png)

## 安装

从 [GitHub Releases](https://github.com/expldfsh/Sesshuttle/releases) 下载适合你系统的 0.7.3 安装包。

| 平台 | 安装包 |
| --- | --- |
| Apple Silicon Mac | `sesshuttle-0.7.3-mac-arm64.dmg` |
| Arch 等 x86_64 Linux | `sesshuttle-0.7.3-linux-x64.tar.gz` |
| Debian / Ubuntu x86_64 | `sesshuttle-0.7.3-linux-amd64.deb` |

## 第一次把对话从 Mac 带到 Linux

每台电脑「对话」页顶部的「开始使用」清单会列出第一次传输前还差的准备：检测本机 Codex 应用、连接云端存储、刷新对话列表、完成第一次上传或导入。全部完成后，清单不再显示。

1. **连接两台电脑。** 在 Mac 打开「设置」，选「这是第一台电脑：创建同步空间」，填入自己的私有 R2 Bucket，然后导出连接文件。在 Linux 选「已有同步空间：导入连接文件」，输入 R2 Secret Access Key，加入同一空间。[从创建 Bucket 到连接两台电脑](docs/guides/zh-CN/quick-start.md#配置-r2-和连接文件)
2. **在 Mac 上传。** 点「刷新」，勾选对话，点「上传到云端…」。先看选项，再看检查清单，点写有对话数量的「确认上传」按钮。[查看标注过的检查清单](docs/guides/zh-CN/quick-start.md#在-mac-上传)
3. **在 Linux 导入。** 点「刷新」，点开云端对话，点「导入到这台电脑…」。弹窗分三步：选择应用、项目与文件夹、检查清单。验证通过后点「继续」。如果要接着改代码，项目文件也要放到 Linux 上。[查看导入步骤](docs/guides/zh-CN/quick-start.md#导入到-linux)
4. **把新消息带回 Mac。** 在 Linux 聊完后上传更新。回到 Mac，刷新并导入到原来的应用。如果两台电脑各自续写过，先比较版本，再决定导入哪一份。

## 整理历史

- **删除对话…** 先选位置（仅本机、仅云端或两者）和方式（移入回收站或彻底删除），确认前会列出受影响的每份副本。其他电脑保留各自的本机对话。
- **同步记录** 把传输和删除任务排成一条时间线。可筛选「需处理」、重试未完成的部分，或清除已结束的记录；对话和同步状态都会保留。
- **备份与恢复** 分为本机手动备份、本机回收站和云端回收站三个标签页。导入和恢复都不会自动创建备份。

[完整指南与常见问题](docs/guides/zh-CN/quick-start.md) · [验收记录](docs/validation/0.7.3.md)
