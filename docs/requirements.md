# Sesshuttle 需求文档

> 本文是 Sesshuttle 唯一的需求与开发依据。已完成轮次的逐项任务和过程记录不再保留在本文中，需要时可从 git 历史查看。
>
> - 当前已发布版本：**0.7.1**（2026-11-08 用户验收通过；验收记录可从 git 历史查看）
> - 本轮开发目标：**0.7.2 —— Codex 程序路径与快速验证的报错引导**（第二部分），自验收记录见 [validation/0.7.2.md](validation/0.7.2.md)
> - 文档修订：2026-11-06 创建；2026-11-07 新增 0.7.1 轮次；2026-11-08 压缩 0.7.1 轮次，新增 0.7.2 轮次

## 0 文档使用规则

1. **第一部分「产品基线」长期有效**。任何轮次的改动都不得违反其中的约束。如果必须调整，先在第三部分记录理由，并由用户确认。
2. **第二部分是当前轮次的需求**。每一项都带复选框，开发者完成并自验收后勾选 `[x]`。做法与本文不同时，在第三部分「决策与偏差记录」写明原因。
3. **第三部分记录进度和决策**。每个阶段结束时更新阶段状态表。
4. 用户验收一个轮次后，把该轮压缩为第三部分「历史轮次摘要」中的一条；仍然长期有效的结论并入第一部分。然后新增下一轮的第二部分。
5. `docs/validation/` 只保留最新版本的验收记录，旧记录从 git 历史查看。

---

# 第一部分 产品基线（长期有效）

## 1 产品定位

Sesshuttle 是一个可安装的桌面应用。用户连接自己的 Cloudflare R2 Bucket，选择本机的 Codex 对话加密上传，然后在另一台电脑导入到 Codex 桌面端、CLI 或 VS Code 扩展，在正确的本机项目文件夹里继续同一条原生对话。

- 用户自备存储，不注册本产品账号，不部署数据库或服务器。
- 只有实际验证过的平台和 Codex 版本才能声明支持。当前支持：Apple Silicon Mac（dmg）、x86_64 Linux（tar.gz、deb，重点是 Arch）。Windows 尚未验收。
- 不负责：项目源码同步、依赖安装、终端进程迁移、Codex 登录迁移、运行中任务迁移。

## 2 不可违反的约束

### 2.1 所有数据操作由用户发起

- 启动、连接、打开页面、预览、文件变化和重启**都不得**触发备份、下载、导入、上传、同步、删除、清理、重试或续跑。
- 显示**已保存在本机的状态**可以直接进行，包括用户操作完成后重新读取本机已保存的状态。**重新扫描本机或查询云端**必须由用户点击刷新（或使用等价的快捷键）。
- 预览只读。确认只授权界面列明的动作、对象和目的地。范围或附件变化后必须重新预览。
- 导入、整份恢复、冲突处理、替换历史**都不隐式创建备份**。备份只能由用户在「备份与恢复」中单独创建。
- 无法安全完成时停止并说明原因，不扩大原范围，不猜测。

### 2.2 数据完整性

- 冲突保留两份分支，不按时间覆盖，不拼接两个独立对话。
- 不传播删除：本机删除不影响云端和其他设备；云端删除不向其他设备发送删除命令。
- 写入前再次核对预览后的版本、文件哈希、进程占用。任何不一致都以 `stale_plan`、`codex_running` 等明确错误停止。
- 上传成功只表示云端备份完成；只有目标应用原生验证通过，才可标为「可继续」。多目标导入按应用逐个报告结果，允许部分成功，只重试失败项。
- 缺失的普通本地图片可由用户逐项确认省略，导入副本中写入缺图说明。缺关键历史、缺父历史、未知资源、不安全路径不可绕过。

### 2.3 安全与隐私

- 正文、标题、路径等在上传前用 AES-256-GCM 加密（HKDF 派生，AAD 绑定空间和对象名）。对象名不泄露标题或路径。
- R2 凭据与空间密钥分开管理。凭据保存在系统凭据服务中（macOS 钥匙串、Linux Secret Service；KWallet 环境下使用 Electron safeStorage）。系统服务不可用时凭据只保留在内存，**绝不明文落盘**。
- 不同步 Codex 登录凭据或 API key。默认无遥测。诊断信息只含版本、平台、任务状态和错误码，导出前先预览。
- Sesshuttle 不向对话或模型上下文追加任何设备、目录或换机说明。换机交接由用户自己在原生对话中完成。
- 不放宽目标设备的权限和审批设置。原生验证在只读沙箱中进行。同步本身不发送任务，也不续跑旧命令。
- Electron 安全基线：contextIsolation、sandbox、禁用 nodeIntegration、CSP、禁止外部导航和权限请求、IPC 校验调用来源和参数。

### 2.4 界面基线

- 主题：Tokyo Night Moon，颜色只来自 `app/shared/themes.ts` 的语义变量。不新增其他主题。
- 字体：英文 Comic Neue，中文霞鹜文楷（LXGW WenKai），以 WOFF2 随安装包离线分发，字形与原 TTF 一致。
- 字号：正文 16px，表单与操作 15–16px，辅助文字不低于 13px。
- 语言：简体中文和英文。首次启动跟随系统，可在设置中切换。所有界面文字走 `app/renderer/i18n/messages.ts`；用户数据不翻译；错误码使用稳定标识。
- 状态不能只靠颜色或短暂提示表达。键盘可以完成所有操作，焦点清晰可见。
- 下拉菜单使用应用内的 `Select` 组件；弹窗统一使用基于原生 `<dialog>` 的 `Modal` 组件。

### 2.5 操作反馈原则

- 成功用 Toast 提示。警告和错误在触发位置（弹窗、详情区、任务面板、页面区块）就地显示，**保留到用户处理或主动关闭**。
- 失败提示必须交代三件事：**发生了什么**；**操作是否执行、执行到哪一步**（只陈述代码能保证的事实）；**可点击的恢复入口**。恢复入口来自 `app/renderer/errors.ts`。
- 任何一次 `work(..., place)` 的失败都必须有可见的展示位置。即使该位置的组件没有挂载（例如任务对象尚未建立或已被清除、用户已切换页面），也不能静默丢失。
- 用户完成一次会改变本机已保存状态的操作后，当前页面立即显示新状态和可用操作，不需要切换页面。只重新读取本机已保存的状态；云端数据不自动查询，只标明可能已过期，由用户刷新。
- 提示中提到的按钮、页面、选项名称必须与界面文案完全一致，并且在提示所在的位置可见或可达；能就地完成的修复直接以按钮给出，不让用户自己去找。
- 确定性错误（重试必然得到同样结果）不以「重试」作为主按钮。

### 2.6 开发与测试安全

- 测试只使用临时目录中的合成数据、本机模拟 S3（只监听回环地址）和本机应答服务。**绝不**读写用户真实的 `~/.codex`、真实项目或真实 R2。
- 应用测试模式由 `SESSHUTTLE_TEST_ROOT` 开启。该目录必须位于系统临时目录、以 `sesshuttle-` 开头，并带 `.sesshuttle-test.json`。

## 3 功能清单（截至 0.7.1）

| 区域 | 已有能力 |
| --- | --- |
| 本机发现 | 扫描 Codex 数据目录（rollout JSONL/zstd 和 SQLite 数据库）；识别 Desktop/CLI/VS Code/未知来源与后台子会话；识别原生项目归属；检测本机 Codex 应用、Codex 程序与数据目录（Linux 可读取运行中进程） |
| 连接 | 首次使用时选择「创建同步空间」或「导入连接文件」；字段即时校验；测试连接；导出/导入连接文件（含空间密钥与 Access Key ID，不含 Secret）；创建后提醒导出；记住连接（系统凭据服务）；断开 |
| 对话页 | 「开始使用」清单；位置、来源、后台子会话、项目、搜索、可点击的状态标签筛选；排序；虚拟滚动表格；底部悬浮多选操作栏；详情面板（主操作、⋯ 菜单、可折叠区块、对话气泡预览）；快捷键 |
| 传输 | 步骤式传输弹窗（导入三步、上传两步）：上传、导入到一个或多个应用、双向；检查清单（范围、依赖、附件、容量、上限、大批量确认）；附件授权、重新指定、逐项确认省略；冲突版本比较与选择；仅下载副本到普通文件夹 |
| 任务 | 顶栏任务指示器（确定性进度）与任务浮层；按条目和应用报告结果；修复入口；任务未能开始时保留失败记录并提供恢复入口（刷新并重新预览、重新查看删除清单等） |
| 继续 | 打开原生应用中的对应对话（Desktop/VS Code 用 URL scheme，CLI 生成启动脚本）；可选「以后不再提示」；Git 状态查看 |
| Codex 程序验证 | 对名单外版本做本机「快速验证」：在临时目录用合成对话完成导入和续聊，通过后记住结果 |
| 删除 | 本机 / 当前空间 / 两处 × 回收站 / 永久删除，共六种组合；本机和云端回收站的恢复与永久清理；中断后只重试未完成的一侧 |
| 备份与恢复 | 本机备份、本机回收站、云端回收站三个标签页；本机部分直接显示已保存状态，云端回收站手动刷新 |
| 同步记录 | 合并时间线、「需处理/全部」筛选、分页加载、选择清除或全部清除（不影响同步状态） |

## 4 状态与术语

### 4.1 对话同步状态

| 代码 | 中文 | English | 含义 |
| --- | --- | --- | --- |
| `local_only` | 仅本机存在 | Local only | 云端没有 |
| `remote_only` | 仅云端存在 | Cloud only | 本机没有 |
| `local_changes` | 本机有更新 | Local changes | 本机在共同版本上新增 |
| `remote_changes` | 云端有更新 | Cloud changes | 云端在共同版本上新增 |
| `synced` | 已同步 | Up to date | 两端版本相同 |
| `conflict` | 两边均有修改 | Conflicting changes | 分歧，保留两份等用户选择 |
| `busy`（附加） | 使用中 | In use | 无法取得一致快照 |

### 4.2 用户可见术语（0.7.0 起统一）

| 中文 | English | 指代 |
| --- | --- | --- |
| 应用 | App | Codex 桌面端、CLI、VS Code 扩展三者之一（不再使用「入口」） |
| Codex 程序 | Codex runtime | 实际执行的 `codex` 可执行文件（不再使用「内核」） |
| Codex 数据目录 | Codex data folder | `CODEX_HOME`，例如 `~/.codex` |
| 项目文件夹 | Project folder | 继续对话时的执行目录 |
| 同步空间 | Sync space | 云端的一组加密数据 |
| 连接文件 | Connection file | 导出的 JSON，含空间密钥 |
| 空间密钥 | Space key | 同步空间的解密密钥 |

代码内部标识（`desktop`、`cli`、`ide`、`entry`、`targets` 等）保持不变。

## 5 架构概览

```
app/main/            Electron 主进程
  main.ts            启动流程
  ipc-handlers.ts    全部 IPC 方法实现（方法表见 app/shared/ipc.ts）
  context.ts         主进程共享状态
  continue.ts        打开原生应用 / CLI 启动脚本
  credentials.ts     凭据保存（macos-keychain.mm、linux-keyring.ts）
  menu.ts window.ts preload.ts
app/shared/          主进程与界面共用：ipc.ts（方法名与互斥标记）、themes.ts
app/renderer/        React 界面（Vite 构建）
  App.tsx            外壳、全局状态、全局弹窗、PageMessages / PlaceError
  pages/             对话、项目与应用、设置、备份与恢复、同步记录、首次使用清单
  transfer/          步骤式传输弹窗
  components/        Modal、ErrorNotice、StatusBadge、Toast、Icon、Stepper 等
  hooks/             useApi（call / useWork）、useNotice、useConfirm
  store/progress.ts  任务进度（独立于 React state，避免表格重渲染）
  i18n/              messages.ts（key: [zh, en]）与 I18n 提供者
  errors.ts          错误码 → 严重程度与修复动作
  styles/            base / layout / components / pages / responsive
core/                与框架无关的业务模块（.mjs）：扫描、打包、加密、存储、同步引擎、导入、删除、备份
scripts/             构建、检查、基准、验收、界面走查与截图脚本（scripts/lib 为共用库）
tests/core/          node:test 单元测试；tests/helpers 为测试数据与 MemoryStore
```

- **云端布局**：`sesshuttle/v1/<space>/` 下有：
  - `space`：空间标记，format 2，含写入锁和待完成的删除事务；
  - `heads/<logicalId>`：对话头，含 tips、版本列表、回收站；
  - `versions/<sha256>`：不可变的版本清单；
  - `blobs/<sha256>`：不超过 4 MiB 的加密分块。
- **版本格式**：只支持 bundle format 2。早期测试版留下的 format 1 版本只能在删除流程中被识别和删除。
- **其他格式标识**：空间标记 format 1/2、对话头 `format:1`、连接文件 `format:1`、测试根标记的 `format:1` 保持不变。注意不要和 bundle format 混淆。
- **本机状态**：`userData/sesshuttle.sqlite`（KV 表），另有 `staging/`、`downloads/`、`backups/`、`trash/`、`recovered/`、`launchers/` 目录。

## 6 验收基线

每个版本发布前都需满足以下各条（具体用例写在当轮的验收清单里）：

1. Mac 与 Linux 安装包可以通过图标启动独立窗口，不需要浏览器或开发工具。
2. A 上传 → B 导入并在原生应用中继续 → B 上传 → A 导入并继续；重复同步不产生重复对话。
3. 冲突时保留双方；断网、凭据错误、数据损坏、Codex 进程占用、导入中断都不损坏原记录。
4. 中英文全流程无缺失翻译、无布局遮挡；状态不只靠颜色表达。
5. 远端内容加密，凭据不明文落盘，诊断不含对话内容。
6. 已验证的平台和 Codex 版本、已知限制写入当版验收记录和用户指南。

## 7 开发流程规则（每轮通用）

### 7.1 流程

- 从 `main` 创建本地分支 `dev/<版本号>` 进行开发。**不 push、不开 PR、不合并、不部署**，由用户验收后自行处理。
- **一轮完成全部阶段**，中途不停下来等用户确认。每个阶段结束时按该阶段的「自验收」逐条检查，全部通过后更新第三部分的阶段状态，再进入下一阶段。
- 遇到本文没有覆盖的细节时，按第一部分的约束和现有代码风格做出合理决定，记入第三部分后继续。只有某项需求会违反第一部分的约束时才停止，并在最终报告中说明。
- **频繁提交**：每完成一个可独立说明的小步骤就提交一次。提交信息用英文祈使句，末尾必须带：

  ```
  Co-authored-by: expldfsh <expldfsh@gmail.com>
  ```

- 纯格式化必须单独提交，并把提交哈希写入 `.git-blame-ignore-revs`。
- 修复缺陷时，先写出能稳定复现的检查（单元测试或测试模式下的界面脚本），确认它在修复前失败、修复后通过。

### 7.2 通用自验收

每个阶段结束时都必须满足：

- `npm test` 全部通过（Linux 专属用例在 Mac 上跳过时须注明）
- `npm run check`（tsc 与文案检查）、`npm run lint`、`npm run format:check`、`npm run check:links` 通过
- `npm run build` 成功
- 涉及界面时，`scripts/ui-walkthrough.mjs` 通过（无水平滚动、无原始键名、打开页面和弹窗不触发扫描或云端请求）
- 没有读写真实 `~/.codex`、真实项目或真实 R2
- 工作区干净，所有改动已提交

### 7.3 发版收尾

- 更新 `package.json` 版本号、README（中英文）、用户指南中的版本与链接。
- 新建 `docs/validation/<版本号>.md`，删除上一版的验收记录，并更新所有指向它的链接。
- `npm run package:mac`、`npm run package:linux` 打包，生成 `release/SHA256SUMS-<版本号>.txt`。`release/` 中只保留当前版本和上一版的安装包，并删除 electron-builder 的中间产物（`linux-unpacked/`、`mac-arm64/`、`*.yml`、`builder-debug.yml`）。
- 用 `scripts/smoke.mjs <安装包中的程序> --ui` 做冒烟检查。
- 在对话中给用户一份验收报告：完成内容、偏差、测试结果、安装包位置、需要用户亲自验收的步骤。

---

# 第二部分 0.7.2：Codex 程序路径与快速验证的报错引导

## 8 本轮目标与非目标

**目标**：用户为某个应用填的「Codex 程序」指向启动脚本、程序不可用或快速验证失败时，界面要做到三点：

1. 尽量不让问题发生；
2. 发生时说清是哪个路径出了什么问题；
3. 在提示所在的位置直接给出能完成修复的按钮。

同时，让所有提示里引用的按钮和页面名称都与界面一致，并对快速验证的全部错误做同类排查。

**非目标**：

- 不放宽对启动脚本的限制：快速验证和原生导入仍只信任真实的可执行文件，验证结果仍绑定到该文件的身份。
- 不新增自动扫描、自动执行快速验证或任何数据操作。
- 不改变同步格式。

## 9 问题现状

### 9.1 用户看到的情况（0.7.1 验收后反馈）

在「本机应用与项目」的应用卡片里，快速验证区块（标题「本机导入能力」）显示：

> 此路径指向启动脚本。请在「编辑路径」中选择该安装实际使用的 Codex 可执行文件，再验证。

下面唯一的按钮是「重新快速验证」。用户不知道这是什么意思，也找不到「编辑路径」。

### 9.2 已定位的原因

1. **自动检测把用户带进了死路**。`core/discovery.mjs` 为 GPT 桌面端推荐 `<Resources>/codex-cli/bin/codex` 等候选路径。在 macOS 的 ChatGPT.app 中它是启动脚本，真实程序在 `<Resources>/codex-cli/CodexCLI.app/Contents/MacOS/codex`（见第三部分的长期技术决策）。`core/runtime.mjs` 的 `executable()` 只会把 npm 安装的 `codex.js` 解析成真实程序，不认识这种布局。
2. **问题发现得太晚**。路径是否为脚本，只在点击快速验证后由 `verifyRuntime` 报出（`runtime_launcher`）。检测结果、`appStatus`、路径输入框都不提示。
3. **提示引用了不存在的按钮**：
   - 文案写「编辑路径」，但传输弹窗中的按钮实际叫「更改路径 · 应用」（`editPaths`）；
   - 「本机应用与项目」页上根本没有这个按钮，路径输入框就在同一张卡片上方，名为「Codex 程序」。

   全部文案中用「」引用界面名称的共 17 处，有 4 处与真实文案不符：

   | 文案键 | 引用 | 实际名称 |
   | --- | --- | --- |
   | `runtime_launcher` | 「编辑路径」 | 「更改路径」，且只在传输弹窗中存在 |
   | `runtimeCatalogUnavailable` | 「仅导入历史」 | 「仅导入本机历史」 |
   | `project_assignment_unsupported` | 「仅导入历史」 | 「仅导入本机历史」 |
   | `onboardTransferHint` | 「上传」「导入」 | 「上传到云端…」「导入到这台电脑…」 |

   英文对应文案同样不一致（例如 "Edit the path"、"Choose history only"）。
4. **快速验证的错误没有修复入口**：
   - `app/renderer/RuntimeCheck.tsx` 只把错误码翻译成一段文字，没有使用 `ErrorNotice`，不显示被检查的路径；
   - 唯一的主按钮是「重新快速验证」。对 `runtime_launcher`、`binary_not_codex`、`runtime_protocol` 这类确定性错误，重试必然得到同样结果；
   - `app/renderer/errors.ts` 中没有 `runtime_*` 系列错误码，它们落到默认的「重试」。
5. **文件选择进不了应用包内部**。`pickBinary` 只用 `properties: ['openFile']`。在 macOS 上 `.app` 被当作单个文件，用户无法浏览到 `CodexCLI.app/Contents/MacOS/codex`。选择窗口也不会定位到当前路径所在的目录。

## 10 要求

### 10.1 根因：识别已知启动脚本并改用真实程序

- [x] `core/runtime.mjs` 的 `executable()` 增加对已验证布局的解析：配置的路径是 macOS ChatGPT.app（以及同布局的 Codex.app）中的 `Contents/Resources/codex-cli/bin/codex` 时，改用 `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`。只有同时满足以下条件才采用：
  - 目标文件存在且是普通文件；
  - 不以 `#!` 开头；
  - 位于同一应用包内（`realpath` 后检查）。

  不满足时保持原样，让后续检查报出 `runtime_launcher`。开发者须先在本机查看真实的 ChatGPT.app 布局和脚本内容，确认对应关系（只读，不运行脚本以外的任何东西），把结论写进第三部分。
- [x] 解析后的身份（`identity.file`、`key`、`script`）基于真实程序，与 npm `codex.js` 的处理方式一致。用户配置中的路径保持不变。
- [x] 界面上凡是显示 Codex 程序路径的地方（应用卡片、传输弹窗第一步、检测结果），当实际使用的程序与配置路径不同时，加一行「实际使用：<真实路径>」。
- [x] `core/discovery.mjs` 对候选路径按同一规则解析：检测结果直接推荐真实程序，证据中注明「由启动脚本解析」；同一真实程序的多个候选只保留一个。
- [x] Linux 的 GPT 桌面端（例如 `/usr/lib/chatgpt/resources/…`）**只解析已经验证过的布局**。开发环境无法验证时不加规则，在第三部分和验收报告中列为「待用户在 Arch 上确认」。
- [x] 单元测试：在临时目录中构造假的应用包布局（脚本 + 真实程序替身），检查以下情况：
  - 能正确解析；
  - 真实程序缺失、是脚本、通过符号链接指向包外时不解析；
  - 解析后的 `key` 与直接配置真实程序时一致。

### 10.2 提前发现：选择或填写路径时就检查

- [x] 新增只读 IPC `inspectBinary({path})`，返回：
  - 是否存在、是否可执行；
  - 是否为脚本；
  - 解析后的真实路径（如有）；
  - 版本（复用 `runtime.mjs` 的身份缓存）；
  - 已保存的验证状态。

  只读取文件头并运行 `--version`，与现有检测一致，不做任何数据操作。
- [x] 应用卡片和传输弹窗中，「Codex 程序」输入框在选择文件后、或输入框失焦后调用它，并在输入框下方就地显示结果：
  - 正常：版本号，加上「已验证 / 需要快速验证」；
  - 解析成功：「实际使用：…」；
  - 无法解析的启动脚本：说明这是启动脚本，给出 10.3 中的修复按钮；
  - 不存在、不可执行、不是 Codex 程序：分别说明。
- [x] `appStatus` 增加状态 `launcher`（无法解析的启动脚本），应用卡片的状态标签显示「需要选择 Codex 程序」。

### 10.3 报错与就地修复

- [x] `RuntimeCheck` 改用 `ErrorNotice` 展示失败，内容包括：
  - 标题：重写后的说明，见 10.5；
  - 被检查的路径，以代码块显示，可复制；
  - 修复按钮，见下表；
  - 技术细节折叠区，包含阶段、错误码和 detail。
  - 确定性错误不再显示「重新快速验证」作为主按钮。等用户改了路径（`RuntimeCheck` 按 `binary` 重新挂载）后，才恢复「开始快速验证」。
- [x] `errors.ts` 新增修复动作，并为所有快速验证和 Codex 程序相关的错误码配置规则。建议如下，开发者可调整，调整处记入第三部分：

  | 错误码 | 修复入口 |
  | --- | --- |
  | `runtime_launcher`、`binary_not_codex`、`binary_unavailable`、`binary_required` | 「选择 Codex 程序…」（主按钮）；能解析出候选时，加「改用 <真实路径>」（一键写入当前草稿，不自动保存，不自动验证） |
  | `runtime_timeout`、`runtime_start_failed`、`runtime_reply_unavailable`、`runtime_unfinished`、`runtime_changed` | 「重新快速验证」 |
  | `runtime_temp_denied`、`disk_space` | 说明需要的权限或空间，提供「重新快速验证」 |
  | `runtime_protocol`、`runtime_schema`、`runtime_history_mismatch`、`runtime_isolation` | 「选择 Codex 程序…」；在传输弹窗中另提供「改用其他应用」和「仅下载副本到文件夹」（沿用现有入口） |
  | `runtime_cancelled` | 信息提示，提供「开始快速验证」 |
  | `runtime_busy` | 信息提示：另一项快速验证正在进行，不提供按钮 |

- [x] 「选择 Codex 程序…」就是这个应用的「Codex 程序」字段对应的选择操作：选中后写入该应用的路径草稿，并立即执行 10.2 的检查。
  - 在「本机应用与项目」页，写入卡片里的字段，底部出现「未保存」栏；
  - 在传输弹窗中，自动展开该应用的路径编辑区（现在的「更改路径」），写入草稿。
- [x] `pickBinary` 接受可选的 `defaultPath`（主进程校验为绝对路径），并在 macOS 上加 `treatPackageAsDirectory`，让用户能进入 `.app` 内部。默认定位规则：
  - 当前路径所在的目录；
  - 没有路径时，GPT 桌面端定位到已检测到的应用包的 `Contents/Resources`；
  - 其他情况不指定。
- [x] 区块标题「本机导入能力」改为更直白的「快速验证 Codex 程序」，标题下显示当前被验证的路径。说明文字保留「用临时测试对话验证续聊，无需登录，通过后这台电脑会记住结果」的含义。

### 10.4 文案引用界面名称的机制

- [x] 文案中引用按钮、页面、标签页、选项名称时，不再手写，改为占位引用另一条文案，例如 `'请在{@editPaths}中…'`。`t()` 在显示时替换为同一语言的那条文案（中文加「」，英文用该语言的引号或加粗约定，由开发者定一种并全局统一）。这样改名时提示会自动跟着变。
- [x] 把现有 17 处「」引用全部改为占位引用，并修正 9.2 表中的 4 处错误。对应的英文文案同样改为引用。
- [x] `scripts/check-locales.mjs` 增加检查：
  - `{@key}` 引用的键必须存在；
  - 中文文案中不得再出现手写的「」引用，除非引用的是用户数据或系统名称，这类情况用允许列表声明；
  - 中英文的引用集合一致。
- [x] **引用必须在当前位置可见**。说明修复办法的错误文案，不得指向当前位置不存在的按钮。同一错误码在不同位置（应用卡片、传输弹窗）需要不同说法时，用 `ErrorNotice` 的修复按钮表达操作，文案只说明原因。

### 10.5 文案重写

- [x] 重写 `runtime_launcher`，例如：

  > 这个路径是 GPT 桌面端或其他安装附带的启动脚本，不是 Codex 程序本身，快速验证无法确认它实际运行的是哪个程序。请选择该安装里真正的 Codex 程序。

  最终措辞由开发者定，但必须交代：是什么、为什么不能用、下一步做什么。中英文同步改。
- [x] 逐条检查所有 `runtime_*`、`binary_*` 文案，确保每条都交代了以上三点，并与 10.3 的按钮一致。

### 10.6 同类排查

- [x] 检查其他「只有文字、没有修复入口」或「主按钮是必然失败的重试」的错误展示：
  - 检测面板（`DetectionPanel`）中候选的 `error`；
  - 传输弹窗第一步各应用的 `now.error`；
  - 连接表单的测试结果；
  - 凭据存储检查结果。

  发现的问题一并修复，记入第三部分。

## 11 自验收

- [ ] 单元测试覆盖 10.1 的解析规则和 10.2 的 `inspectBinary`（脚本、可解析的脚本、不存在、不可执行、非 Codex 程序）。
- [ ] `scripts/ui-regressions.mjs` 新增检查（测试模式，在测试根目录构造假的 ChatGPT.app 布局）：
  1. 应用路径指向可解析的启动脚本：应用卡片显示「实际使用：…」，状态不是「需要选择 Codex 程序」。
  2. 应用路径指向无法解析的启动脚本：
     - 输入框下方就地提示，状态标签为「需要选择 Codex 程序」；
     - 快速验证失败后，`ErrorNotice` 显示路径和「选择 Codex 程序…」，不显示「重新快速验证」主按钮；
     - 点击「选择 Codex 程序…」后（在 Playwright 中替换 `dialog.showOpenDialog` 返回替身程序路径），字段被更新，提示消失，出现「开始快速验证」和「未保存」栏。
  3. 传输弹窗第一步中的同一流程：点击修复按钮后自动展开路径编辑区并写入草稿。
  4. `pickBinary` 收到的参数包含 `treatPackageAsDirectory`（macOS）和正确的 `defaultPath`（在主进程侧记录调用参数检查）。

  先提交检查并确认修复前失败，再提交修复。
- [ ] `npm run check` 的新文案规则生效：故意写一个手写的「」引用或不存在的 `{@key}`，检查失败；撤回后通过。
- [ ] 第 7.2 节通用自验收全部通过；`scripts/ui-walkthrough.mjs` 中「打开页面和弹窗不触发扫描或云端请求」的检查仍然通过。`inspectBinary` 只在用户选择或编辑路径后调用，不在打开页面时调用。
- [ ] 在开发机上用本机真实的 ChatGPT.app（只读）运行一次 `scripts/check-runtime.mjs <ChatGPT.app 里的 codex-cli/bin/codex>`，确认解析到真实程序并通过快速验证。快速验证只使用临时目录和本机应答服务。

## 12 发版与文档

- [ ] 版本号改为 0.7.2，按第 7.3 节收尾：新建 `docs/validation/0.7.2.md`，删除 `0.7.1.md` 并更新链接。
- [ ] 中英文快速入门中有关「检测本机 Codex 环境」和快速验证的段落：说明 GPT 桌面端会自动改用真实程序，以及遇到「需要选择 Codex 程序」时怎么做。`linux-acceptance.md` 补一步：在 Arch 上检查检测结果是否为真实程序。
- [ ] 本文第三部分更新阶段状态和决策记录。验收报告中列出需要用户在真实环境确认的事项：
  - macOS 文件选择窗口能进入 `.app`；
  - 真实 ChatGPT.app 的自动解析；
  - Arch 上的 GPT 桌面端布局。

---

# 第三部分 进度与决策记录

## 阶段状态（0.7.2）

| 阶段 | 状态 | 提交范围 | 备注 |
| --- | --- | --- | --- |
| 10.1 识别启动脚本 | 已完成 | 721df3d… | 单元测试 6 项新增；界面显示「实际使用」 |
| 10.2 提前发现 | 已完成 | | `inspectBinary` 只在用户选择或编辑路径后调用 |
| 10.3 报错与就地修复 | 已完成 | | `ui-regressions --only=paths` 修复前 1/7、修复后 7/7 |
| 10.4–10.5 文案引用机制与重写 | 已完成 | | 实际共 19 条文案（需求表 17 处之外还有 `import_needs_recovery` 用了“ ”，以及 `runtime_launcher`） |
| 10.6 同类排查 | 已完成 | | `ui-regressions --only=sweep` 修复前 1/3（另有 `npm run check` 报缺文案）、修复后 3/3 |
| 12 发版与文档 | 未开始 | | |

## 决策与偏差记录（0.7.2）

| 日期 | 决定 | 来源 |
| --- | --- | --- |
| 2026-11-08 | 启动脚本仍不能作为快速验证和导入的身份；只对已验证的应用包布局自动解析到真实程序，配置中的路径保持用户所填 | 需求制定 |
| 2026-11-08 | 修复按钮只改写路径草稿，不自动保存、不自动运行快速验证；检查程序（`inspectBinary`）只在用户选择或编辑路径后进行 | 需求制定 |
| 2026-11-08 | 文案引用界面名称改为占位引用另一条文案，由检查脚本保证引用存在且中英文一致 | 需求制定 |
| 2026-11-08 | 已只读核实本机 ChatGPT.app（26.1103.41825，附带 `codex-cli` 版本 `0.167.0-alpha.3.2`）：`Contents/Resources/codex-cli/bin/codex` 是 328 字节的 POSIX sh 脚本，解析自身符号链接后执行 `exec "$bin_dir/../CodexCLI.app/Contents/MacOS/codex" "$@"`；`CodexCLI.app/Contents/MacOS/codex` 是 Mach-O arm64，`CFBundleIdentifier` 为 `com.openai.codex.cli`。`codex-package.json` 写明 `layoutVersion: 1`、`entrypoint: bin/codex`。本机没有 `/Applications/Codex.app`，「同布局的 Codex.app」按相同规则处理但未实机验证 | 开发时核实 |
| 2026-11-08 | 解析只认 `ChatGPT.app`、`Codex.app` 两个包名和 `Contents/Resources/codex-cli/bin/codex` 这一确切位置，且启动脚本本身必须以 `#!` 开头。规则按路径形状匹配，不按 `process.platform` 限定：Linux 上不存在这种 `.app/Contents` 结构，单元测试也因此能在两个平台上运行 | 开发时决定 |
| 2026-11-08 | Linux 的 GPT 桌面端：开发机无法验证，不加解析规则，列为「待用户在 Arch 上确认」。在 Linux 上若 `codex` 候选是脚本且版本不在支持名单内，检测结果显示 `runtime_launcher` 且不可勾选 | 开发时决定 |
| 2026-11-08 | 「实际使用」按字面规则显示：只要真实文件与配置路径不同就显示，包括符号链接（如 Homebrew 的 `/opt/homebrew/bin/codex`）和 npm 的 `codex.js` | 开发时决定 |
| 2026-11-08 | `appStatus` 不运行程序，因此「未检查过且是脚本」的路径直接显示 `launcher`。这可能把版本在支持名单内的自写包装脚本也标为「需要选择 Codex 程序」，用户点一次「开始快速验证」（复用名单结果）或在输入框触发检查后恢复正常。`scripts/ui-fixture.mjs` 的替身脚本为此预先记录「已见版本」，`--binary` 指定的路径不预记录 | 开发时决定 |

| 2026-11-08 | `inspectBinary` 复用 `runtimeInfo`，会记录「这个文件的已见版本」这一项缓存（与检测、`destinationInfo` 相同），不写验证结果，也不做任何数据操作；这样保存路径后 `appStatus` 能显示正确状态 | 开发时决定 |
| 2026-11-08 | 新增错误码 `binary_missing`（路径没有文件）和 `binary_not_executable`（没有执行权限），使「不存在」「不可执行」「不是 Codex 程序」能分别说明；`identity` 同样报告 `binary_not_executable` | 开发时决定 |
| 2026-11-08 | 输入框失焦时只有内容相对获得焦点时发生变化才检查，单纯按 Tab 经过不运行程序 | 开发时决定 |
| 2026-11-08 | 「改用 <真实路径>」的候选来自 `inspectBinary` 和 `appStatus`：同样布局但包名未验证（例如 `Other.app`）时给出 `CodexCLI.app` 内的程序，需要用户点击确认，从不自动采用 | 开发时决定 |

| 2026-11-08 | `errors.ts` 用独立字段 `runtime`（`chooseRuntime`/`retryRuntime`/`startRuntime`/`null`）描述快速验证区块的就地修复，原有 `fix` 只服务页面级恢复入口，两者互不影响；未列出的错误码回退为「重新快速验证」，避免出现没有恢复入口的失败 | 开发时决定 |
| 2026-11-08 | `runtime_busy` 按需求不给按钮，但提示可以关闭，关闭后恢复「开始快速验证」，否则用户只能切换页面才能再次尝试 | 开发时决定 |
| 2026-11-08 | 「开始快速验证」的按钮文案由「快速验证此 Codex 程序」改为「开始快速验证」，与需求一致；文案中的引用用 `{@startRuntimeCheck}`，随按钮改名 | 开发时决定 |
| 2026-11-08 | `runtime_protocol`/`runtime_schema`/`runtime_history_mismatch`/`runtime_isolation` 在传输弹窗中沿用下方已有的「仅导入到已配置的应用」和「仅下载到普通文件夹」入口，不在 `ErrorNotice` 内重复 | 开发时决定 |

| 2026-11-08 | 引用的显示约定：中文用「」，英文用 “ ”，由 `t()` 统一加上。`check-locales` 把中文的 `「」“”` 都视为手写引用，`import_needs_recovery` 的“备份与恢复”一并修正；`QUOTE_ALLOWED` 目前为空，引用用户数据或系统名称的文案以后可以在此声明 | 开发时决定 |
| 2026-11-08 | 引用的键必须是纯字符串（无占位变量、无复数），否则检查失败 | 开发时决定 |
| 2026-11-08 | `runtime_*`、`binary_*` 文案只说明原因和下一步，修复动作由 `ErrorNotice` 的按钮表达；不再提「选择其他应用」「下载副本」，这些入口只在传输弹窗存在（10.4 引用必须在当前位置可见） | 开发时决定 |

| 2026-11-08 | 同类排查结果：**检测面板候选的 `error`** 原本只有文字，新增修复按钮（页面上为「本机应用与项目」，传输弹窗中为「选择 Codex 程序…」并展开路径编辑区）；**传输弹窗第一步的 `now.error`** 已有路径编辑区和「重新检查」，无需新增，但发现 `entry_binary_missing` 没有文案（界面露出原始键名），已补文案，并让 `scripts/lib/error-codes.mjs` 也收集 `error: '…'` / `.error = '…'` 形式的错误码；**连接表单的测试结果** 就在表单字段和「测试」按钮旁，修复入口即字段本身，只补了 `storage_write_permission` 的下一步说明；**凭据存储检查结果** 的提示点名了当前状态下不存在的按钮，已按「已连接 / 已保存待解锁 / 需重新连接」三种状态分别说明 | 开发时决定 |
| 2026-11-08 | `entry_home_missing`、`noCandidate` 的文案不再手写「点击检测」「应用卡片」，改用 `{@detectEnvironment}` 或不依赖位置的说法 | 开发时决定 |

## 长期有效的技术决策

**数据与格式**
- 云端不再兼容 bundle format 1。`vault.version(id, {legacy:true})` 是唯一能读到旧清单的入口，只用于云端删除目录和 `publishLocked` 的分支比较。
- 删除预览的版本描述缓存在本机状态 `version-desc/<space>/<id>` 中；一次传输任务内只列一次空间对象，空间标记的 `completed` 变化时重新列出。
- 扫描缓存键为「路径 + 大小 + mtime + ctime」，数据库还包括 `-wal` 与 inode；读取失败从不缓存。写入前的 `checkUnchanged` 重新扫描必须保留。
- `engine.execute` 和 `removals.execute` 被拒绝时只执行过只读检查；任务建立之后仍然抛出的错误由 core 标记 `started: true`，界面据此说明「可能已处理部分条目」。

**界面**
- 任务类失败（传输、删除、打开应用、检查目标、读取删除任务）存放在 `store/progress.ts`，每类只保留最新一条。只在用户关闭、使用恢复入口或同类任务成功开始时清除；不写入同步记录，不跨重启。
- `PlaceError` 挂载时登记自己的 place（`useLayoutEffect`）；没有登记的 place 的错误在页面顶部显示。
- 用户操作结束后（无论结果如何）调用 `localChanged()`，递增 `localRevision`，涉及云端时另递增 `cloudRevision`，并重新读取 `init`。云端列表只标记「可能已过期」并禁用其中的操作。有未保存的修改时，重新读取只更新应用状态，保留正在编辑的设置。
- Electron 45（Chromium 156）中 `scrollIntoView` 返回 Promise。effect 中调用它时不能把返回值当作清理函数返回，否则组件卸载时整个窗口变成空白。
- `Modal` 基于 `<dialog>.showModal()`；`Select` 的菜单挂到所在的 dialog 内。

**工程**
- 测试数据用 `tests/helpers/bundles.mjs`（真实扫描 + `captureBundle`）生成；`MemoryStore` 位于 `tests/helpers/memory-store.mjs`。
- 类型检查用 TypeScript 7（`typescript-native`，`npm run check`）；lint 解析用 TypeScript 6.0.3（typescript-eslint 的要求）。
- 格式化提交记录在 `.git-blame-ignore-revs`。Prettier 会删除 JSX 文本中的全角空格，需要时写成 `{'　'}`。
- 字体为 fontTools 无损转换的 WOFF2（只去掉 `DSIG` 表），转换可由 `scripts/fonts.mjs` 复现。
- 主进程共享状态集中在 `app/main/context.ts`；IPC 的 `Handlers` 类型由 `IpcMethod` 映射而来，漏写或多写 handler 都是类型错误。
- 文案检查（`scripts/check-locales.mjs`）的错误码来源由 `scripts/lib/error-codes.mjs` 从源码收集；core 产生、界面直接显示的状态值在 `DATA_VALUES` 中声明。
- 测试模式的界面脚本共用 `scripts/lib/test-app.mjs`；`scripts/ui-fixture.mjs` 默认生成只报告版本 0.166.0 的替身 Codex 程序，不执行本机真实程序。`scripts/ui-regressions.mjs` 支持 `--app=<安装包中的程序>`，发版时在安装包上再跑一遍。
- ChatGPT 桌面端自带的 `codex-cli/bin/codex` 是启动脚本，真实可执行程序在 `codex-cli/CodexCLI.app/Contents/MacOS/codex`。
- 验收脚本（`roundtrip`、`missing-image-roundtrip`、`real-copy-roundtrip`、`cross-device`）使用 `scripts/lib/native-lab.mjs` 的隔离 Lab，拒绝真实 `~/.codex`。

## 历史轮次摘要

- **0.1.0-rc.1 – rc.5**：核心接续验证、R2 同步、GiB 级分块、附件授权与缺图接续。
- **0.2.0**：原生项目归属、跨应用导入。
- **0.3.0**：本机/云端 × 回收站/永久删除六种组合。
- **0.4.x**：连接文件换机、系统密码库授权、操作反馈改版。
- **0.5.0**：所有数据操作改为用户发起；手动备份；同步记录清除。
- **0.6.0**：名单外 Codex 程序的本机快速验证；冲突目录中的换机续聊；缺少模型服务的预检。
- **0.7.0**（2026-11-07 验收）：
  - 清理：删除无用文件、死代码、bundle format 1 与 Python 研究工具（移植为 JS）；修复工作区文件夹名和删除备份按钮样式；
  - 重构：Prettier/ESLint、主进程与渲染层拆分、IPC 单一来源、统一错误映射与 Modal；
  - 性能：云端刷新 7.4 倍，删除预览缓存后快 23 倍，`app.asar` 从 54.7 MB 降到 19.0 MB，5,000 行虚拟滚动；
  - 界面改版：首次使用清单、筛选重做、步骤式传输、备份三标签页、术语统一、视觉层次；
  - 测试 79 项，文案 732 条。
- **0.7.1**（2026-11-08 验收）：
  - 任务未能开始时保留失败记录，说明未执行，并提供「刷新并重新预览」「重新查看删除清单」等恢复入口；
  - 打开原生应用失败时就地显示；没有显示位置的错误统一在页面顶部兜底；
  - 用户操作结束后立即重新读取本机已保存状态，云端列表标记为可能已过期；
  - 顺带修复错误提示关闭时窗口变空白、重新读取覆盖未保存修改等同类问题；
  - 新增 `scripts/ui-regressions.mjs`（13 项）；测试 80 项，文案 751 条。
