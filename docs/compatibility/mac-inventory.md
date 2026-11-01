# Mac 开发环境与数据边界

调查日期：2026-11-01。以下为本机观察，不代表跨平台兼容承诺。

| 入口 | 应用 / 扩展版本 | 底层 Codex |
| --- | --- | --- |
| 桌面（当前 ChatGPT / Codex Work 宿主） | 26.1027.30824 (22943) | 0.166.0-alpha.5.1 |
| CLI | Homebrew 安装 | 0.164.0 |
| VS Code Codex 扩展 | 26.1021.22027 | 0.164.0-alpha.11.1 |

系统：macOS 27.0.1 (26A434)，arm64 / 用户提供的 M3。
Linux x86_64 与 Windows x86_64 的版本在候选版实际验收时补齐。

## 只读观察

- 已观察普通及归档 rollout 目录，以及 `state_5.sqlite` 和 `thread_history_1.sqlite`。数据库模式只读查看，不打开用户会话进行恢复，不修改数据库。
- `threads` 存储入口来源、originator、工作目录、权限及 history_mode 等。独立历史库包含 turns、items 和投影位置。不能假定删除数据库或只复制 JSONL 就能完整迁移。
- 桌面会话可标记为 `source=vscode`、`originator=codex_work_desktop`。优先结合 originator 分类，缺少可靠依据标为未知；子会话单独识别，不混成普通桌面对话。
- 源文件历史正文、账户标识、凭据、数据库内容及真实对话 ID 不进入仓库。头部计数工具只输出聚合信息，不宣称完整扫描完成。

## 接口依据

[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) 描述恢复、分页读取和按安装版本生成协议。研究实际使用各已安装二进制生成的 schema；其 `thread/resume.path` 标记为不稳定，`history` 明确为内部用途，不作为生产导入接口。

隔离进程观察到 `thread/turns/list` 可调用；`thread/items/list` 在桌面二进制返回 not supported yet。schema 的存在不能证明接口已经实现。必须验证分页、rollout 与历史库的联合行为。

## 安全运行

研究工具位于 `tools/codex_lab/`，只允许写入自身创建的系统临时目录。Codex 子进程额外受 macOS 文件与网络限制：禁止读取日常 `.codex`，只允许写入测试目录，不继承登录凭据或代理。默认禁止网络；后续若使用本机模拟模型，仅允许指定回环端口。无法建立隔离即失败，不退回普通进程。

此阶段使用 Python 标准库进行兼容性实验，不构成产品技术栈变更。
