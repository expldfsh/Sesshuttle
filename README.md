# sesshuttle

在多台电脑之间同步 Codex 对话，保留上下文，回到原生 Codex 继续工作。历史加密保存在你自己的 Cloudflare R2 Bucket 中，不需要额外部署数据库或服务器。

当前版本：**0.1.0-rc.1，M4 安装验收候选版**。Mac 隔离开发验证已完成；真实 R2、Linux 和实际 Codex 界面的最终验收仍待完成。Windows 后续单独验收。

## 安装

安装包位于本地 `release/`，尚未发布到 GitHub。

- **Mac Apple Silicon（M1/M2/M3 等）**：打开 `sesshuttle-0.1.0-rc.1-mac-arm64.dmg`，将 sesshuttle 拖入“应用程序”。候选版未做 Developer ID 签名和公证。
- **Linux x86_64**：Debian/Ubuntu 使用 `.deb` 安装包；其他发行版可解压 `.tar.gz` 后运行其中的 `sesshuttle`。Linux 包已构建，尚未在 Linux 实机运行验收。

安装后通过应用图标打开，不需要 Node、Python、Rust 或开发服务器。Comic Neue 和霞鹜文楷已内置，用户无需安装字体，离线也能正常显示。

## 开始使用

1. 在“设置”中检查 Codex 数据目录，确认 Desktop、CLI、VS Code 来源分类。
2. 在 Cloudflare 创建一个私有 R2 Bucket，为它创建 Object Read & Write 凭据。
3. 在 sesshuttle 填写 S3 地址、Bucket、Access Key ID、Secret Access Key，测试连接并创建同步空间。立即导出恢复文件。
4. 第一台电脑选择对话，使用“上传备份”。第二台电脑填写 R2 凭据并导入恢复文件，选择“加入已有空间”。
5. 在第二台电脑的“项目与入口”绑定本机项目目录和已安装入口。退出 Codex 后，选择对话、同步方向和一个或多个目标入口，预览后执行。
6. 确认各入口状态，再打开原生 Codex 验证历史与工作目录。下一轮工作完成后可以反向同步。

[中文配置指南](docs/guides/zh-CN/quick-start.md) · [Linux 集中验收步骤](docs/guides/zh-CN/linux-acceptance.md) · [English guide](docs/guides/en/quick-start.md)

## 当前功能

- 按 Desktop、CLI、VS Code、子会话或未知来源查看、筛选、选择历史。
- 上传、下载、双向同步；一次选择多个目标，共享历史不重复复制，各入口单独显示结果。
- 加密版本、并发保护、分歧保留与明确选择版本；失败入口重试、暂停和自动备份恢复。
- 本机项目路径绑定、中英文界面、系统凭据保护与恢复文件。
- Tokyo Night Moon 配色、内置字体和应用内下拉菜单，支持键盘操作。

“已同步”描述本机与云端的内容关系；“内核已验证”描述导入检查结果，仍需在实际 Codex 入口确认可见和可继续。未知版本、缺失资源或不可读取的数据不会强行导入。

[兼容范围与限制](docs/compatibility/rc1.md) · [开发验证记录](docs/validation/m4-candidate.md)

## 本地开发

```sh
npm ci
npm run check
npm test
npm run build
npm start
```

`npm start` 默认只读扫描本机历史。开发写入测试须使用项目中的隔离测试工具，不能指向日常 Codex 数据。打包使用 `npm run package:mac` 或 `npm run package:linux`；均不会发布。
