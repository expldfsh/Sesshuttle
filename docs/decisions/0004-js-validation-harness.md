# 0004：验收脚本改用 JS 实现的原生 Lab

日期：2026-11-07。状态：已采用（0.7.0）。

0.6.0 时，`scripts/roundtrip.mjs`、`scripts/missing-image-roundtrip.mjs`、`scripts/real-copy-roundtrip.mjs` 和 `scripts/cross-device.mjs` 通过 Python bridge 子进程调用 `tools/codex_lab/`，只为在隔离目录里创建对话、发送一轮、读回历史和证明工作目录。这些能力与产品代码中的 `NativeClient` 和应用内快速验证重复，又多出一门语言、一套 stdin/stdout 协议和每个脚本里的重复样板。

现在改为进程内直接调用：

- `core/fixture-provider.mjs`：本机确定性 Responses 服务和指向它的 Codex 配置，应用内快速验证（`core/runtime-check.mjs`）与验收脚本共用；
- `scripts/lib/native-lab.mjs`：只在 `os.tmpdir()` 下以 `sesshuttle-lab-` 前缀创建并带所有权标记的 Lab，拒绝 Lab 外路径、符号链接、硬链接和真实 `~/.codex`；App Server 在 macOS `sandbox-exec`（写入限于 Lab、真实 `~/.codex` 不可读、网络只允许本机应答服务端口）或 Linux 一次性虚拟机中的 bubblewrap 里运行；拒绝一切授权请求；提供 `startThread`、`turn`、`turns`、`proveDirectory`、`historyEqual`、`comparableHistory`。

隔离规则与原 Python 实现逐条对应；4 个脚本的命令行参数和输出保持兼容。仓库中不再有 Python 代码（字体转换脚本仍需要本机 fontTools，与此无关）。
