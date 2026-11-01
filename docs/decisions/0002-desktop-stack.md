# 0002：Electron 桌面实现

2026-11-01，按用户授权的自主实现与可调整技术栈范围执行。

采用 Electron、React、TypeScript；主进程负责本机操作和 R2，界面只通过受限 IPC 请求；同步核心与桌面框架解耦。使用 Node 标准加密、SQLite 和 AWS S3 SDK。相较候选 Tauri/Rust，可复用同一种语言完成协议、桌面及测试，并直接在当前 Mac 构建；代价是安装包体积较大。用户安装后无需 Node、Python、Rust 或开发服务器。

安全基线：隔离上下文、禁用渲染器 Node、仅打包本地页面、禁止外部导航和权限请求、严格 IPC 参数与调用来源校验、React 纯文本呈现历史。系统凭据不可用时不存明文；Linux basic_text 后端不接受持久保存秘密。

依据：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)。实际版本锁定在 package-lock.json。
