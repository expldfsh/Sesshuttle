# Sesshuttle

在 Mac 和 Linux 之间接着做同一个 Codex 对话。把选中的对话加密备份到自己的 Cloudflare R2，再导入另一台电脑的 GPT 桌面端、CLI 或 VS Code。

## 安装 0.2.0

| 电脑 | 本地安装包 | 打开方式 |
| --- | --- | --- |
| Apple Silicon Mac（包括 M3） | `release/sesshuttle-0.2.0-mac-arm64.dmg` | 打开镜像，将 Sesshuttle 拖到“应用程序”。本地构建未做 Developer ID 签名和公证。 |
| Arch 等 x86_64 Linux | `release/sesshuttle-0.2.0-linux-x64.tar.gz` | 解压，在图形桌面启动其中的 `sesshuttle`。 |
| Debian / Ubuntu x86_64 | `release/sesshuttle-0.2.0-linux-amd64.deb` | 用系统软件安装器安装。 |

升级时退出旧版并替换应用，保留应用数据。两台电脑沿用已有 Bucket、同步空间和恢复文件。Comic Neue 和霞鹜文楷已内置。

## 第一次同步

1. **连接存储。** 首台电脑在「设置」连接私有 R2，创建空间并导出恢复文件。另一台电脑填写 R2 凭据、导入恢复文件，选择加入已有空间。已经看到「已加入同步空间」时，直接点「查看云端对话」。
2. **在 Mac 上传。** 点一个本机对话的标题 →「上传到云端…」，核对标题、附件和新增用量，确认上传。批量操作从勾选后的固定操作栏进入。后台子会话可选，必需的父对话会逐条列出。
3. **在 Linux 导入。** 点云端对话标题 →「导入到本机…」→「GPT 桌面端」。在同一窗口选择 Linux 本机项目和工作目录。原生项目即使没有本地对话也可以选择。没有工作目录时可创建专用目录。
4. **继续对话。** 退出正在使用历史的 Codex，核对清单并确认导入。看到目标入口的验证结果后点「继续」，到原生应用打开同一标题。你可以亲自告诉 Codex 已换电脑，并提供本机文件夹。

如果 Linux 提示本次凭据只保留在内存，当前连接仍可同步。在「设置 → 检查凭据存储」查看原因，解锁系统密钥环后点「重新保存凭据」。

[中文配置和操作指南](docs/guides/zh-CN/quick-start.md) · [用已有云端对话在 Arch 验收](docs/guides/zh-CN/linux-acceptance.md) · [English guide](docs/guides/en/quick-start.md) · [支持范围](docs/compatibility/0.2.0.md)

## 本地开发

```sh
npm ci
npm run check
npm test
npm run build
npm start
```

开发写入测试使用独立测试目录、合成历史和本机存储服务。`npm run package:mac` 和 `npm run package:linux` 生成本地安装包。[0.2.0 验证记录](docs/validation/0.2.0.md)
