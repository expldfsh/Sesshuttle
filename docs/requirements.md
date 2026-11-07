# Sesshuttle 需求文档

> 本文是 Sesshuttle 唯一的需求与开发依据。旧的 `requirements-v1.md`、`development-plan-v1.md` 及各版本兼容/验收记录已删除，需要时可从 git 历史查看。
>
> - 当前已发布版本：0.6.0（验收记录：[validation/0.6.0.md](validation/0.6.0.md)）
> - 本轮开发目标：**0.7.0 —— 清理、重构、性能与体验改版**（第二部分）
> - 文档修订：2026-11-06 创建

## 0 文档使用规则

1. **第一部分「产品基线」长期有效**。任何轮次的改动都不得违反其中的约束；如必须调整，先在第三部分记录理由并由用户确认。
2. **第二部分是当前轮次的需求**。每一项都带复选框，开发者完成并自验收后勾选 `[x]`。做法与本文不同时，在第三部分「决策与偏差记录」写明原因。
3. **第三部分记录进度和决策**。每个阶段结束时更新阶段状态表。
4. 用户提出后续需求时，新增一个「第 N 轮」章节（第二部分之后），已完成的轮次压缩为摘要保留在第三部分。

---

# 第一部分 产品基线（长期有效）

## 1 产品定位

Sesshuttle 是一个可安装的桌面应用。用户连接自己的 Cloudflare R2 Bucket，选择本机 Codex 对话加密上传，在另一台电脑导入到 Codex 桌面端、CLI 或 VS Code 扩展，并在正确的本机项目目录里继续同一条原生对话。

- 用户自备存储，不注册本产品账号，不部署数据库或服务器。
- 只实际验证过的平台和 Codex 版本才可声明支持。当前：Apple Silicon Mac（dmg）、x86_64 Linux（tar.gz、deb，重点是 Arch）。Windows 未验收。
- 不负责：项目源码同步、依赖安装、终端进程迁移、Codex 登录迁移、运行中任务迁移。

## 2 不可违反的约束

### 2.1 所有数据操作由用户发起

- 启动、连接、打开页面、预览、文件变化和重启**都不得**触发备份、下载、导入、上传、同步、删除、清理、重试或续跑。
- 显示**已保存在本机的状态**可以直接进行；**重新扫描本机或查询云端**必须由用户点击刷新（或使用等价的快捷键）。
- 预览只读。确认只授权界面列明的动作、对象和目的地。范围或附件变化后必须重新预览。
- 导入、整份恢复、冲突处理、替换历史**都不隐式创建备份**；备份只能由用户在「备份与恢复」单独创建。
- 无法安全完成时停止并说明原因，不扩大原范围，不猜测。

### 2.2 数据完整性

- 冲突保留两份分支，不按时间覆盖，不拼接两个独立对话。
- 不传播删除：本机删除不影响云端和其他设备；云端删除不向其他设备发送删除命令。
- 写入前再次核对预览后的版本、文件哈希、进程占用；任何不一致都以 `stale_plan`、`codex_running` 等明确错误停止。
- 上传成功只表示云端备份完成；只有目标应用原生验证通过，才可标为「可继续」。多目标导入逐个应用报告，允许部分成功，只重试失败项。
- 缺失的普通本地图片可由用户逐项确认省略（导入副本写入缺图说明）；缺关键历史、父历史、未知资源、不安全路径不可绕过。

### 2.3 安全与隐私

- 正文、标题、路径等在上传前用 AES-256-GCM 加密（HKDF 派生，AAD 绑定空间和对象名）。对象名不泄露标题或路径。
- R2 凭据与空间恢复密钥分开管理。凭据保存在系统凭据服务（macOS 钥匙串、Linux Secret Service，KWallet 环境下使用 Electron safeStorage）；不可用时只保留在内存，**绝不明文落盘**。
- 不同步 Codex 登录凭据或 API key。默认无遥测。诊断信息只含版本、平台、任务状态和错误码，导出前先预览。
- Sesshuttle 不向对话或模型上下文追加任何设备、目录或换机说明；换机交接由用户自己在原生对话中完成。
- 目标设备的权限和审批设置不被放宽；原生验证以只读沙箱进行；同步本身不发送任务、不续跑旧命令。
- Electron 安全基线：contextIsolation、sandbox、禁用 nodeIntegration、CSP、禁止外部导航和权限请求、IPC 校验调用来源和参数。

### 2.4 界面基线

- 主题：Tokyo Night Moon，颜色只来自 `app/shared/themes.ts` 的语义变量。不新增其他主题。
- 字体：英文 Comic Neue，中文霞鹜文楷（LXGW WenKai），随安装包离线分发。字形不变（允许更换为等价压缩格式）。
- 字号：正文 16px，表单与操作 15–16px，辅助文字不低于 13px。
- 语言：简体中文和英文，首次启动跟随系统，可在设置中切换。所有界面文字走翻译资源；用户数据不翻译；错误码使用稳定标识。
- 状态不能只靠颜色或短暂提示表达；键盘可完成所有操作，焦点清晰可见。
- 下拉菜单使用应用内的 `Select` 组件（combobox/listbox 语义，支持完整键盘操作）。

### 2.5 开发与测试安全

- 测试只使用临时目录中的合成数据、本机模拟 S3（只监听回环地址）和本机应答服务。**绝不**读写用户真实的 `~/.codex`、真实项目或真实 R2。
- 应用测试模式由 `SESSHUTTLE_TEST_ROOT` 开启（必须位于系统临时目录且以 `sesshuttle-` 开头，并带 `.sesshuttle-test.json`）。

## 3 功能清单（截至 0.6.0）

| 区域 | 已有能力 |
| --- | --- |
| 本机发现 | 扫描 Codex 数据目录（rollout JSONL/zstd 和 SQLite 数据库）；识别 Desktop/CLI/VS Code/未知来源与后台子会话；识别原生项目归属；检测本机 Codex 应用、Codex 程序与数据目录（Linux 可读取运行中进程） |
| 连接 | 创建或加入同步空间；导出/导入连接（恢复）文件，含空间密钥与 Access Key ID，不含 Secret；测试连接；记住连接（系统凭据服务）；断开 |
| 对话列表 | 状态比较（仅本机、仅云端、本机有更新、云端有更新、已同步、冲突、使用中）；按来源、项目、状态筛选和搜索；单选与多选操作；详情显示各应用导入状态、云端版本、最近消息 |
| 传输 | 上传、导入到一个或多个应用、双向；预览清单（范围、依赖、附件、容量、上限、大批量确认）；附件授权、重新指定、逐项确认省略；冲突版本比较与选择；仅下载副本到普通文件夹 |
| 继续 | 打开原生应用的对应对话（Desktop/VS Code 用 URL scheme，CLI 生成启动脚本）；Git 状态查看 |
| Codex 程序验证 | 名单外版本的本机「快速验证」：在临时目录用合成对话完成导入和续聊，通过后记住结果 |
| 删除 | 本机 / 当前空间 / 两处 × 回收站 / 永久删除，共六种组合；本机和云端回收站的恢复与永久清理；中断后只重试未完成的一侧 |
| 备份 | 手动创建、恢复、删除整个数据目录的备份 |
| 记录 | 同步与删除任务记录，可选择清除或全部清除（不影响同步状态） |

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

| 旧说法（停止使用） | 新说法 中文 | English | 指代 |
| --- | --- | --- | --- |
| 入口 / entry | 应用 | App | Codex 桌面端、CLI、VS Code 扩展三者之一 |
| 内核 / kernel | Codex 程序 | Codex runtime | 实际执行的 `codex` 可执行文件 |
| 历史目录 / 数据目录（混用） | Codex 数据目录 | Codex data folder | `CODEX_HOME`，例如 `~/.codex` |
| 本机项目目录 / 工作目录（混用） | 项目文件夹 | Project folder | 继续对话时的执行目录 |
| 同步空间 | 同步空间 | Sync space | 不变 |
| 恢复文件 / 连接文件（混用） | 连接文件 | Connection file | 导出的 JSON，含空间密钥 |

代码内部标识（`desktop`、`cli`、`ide`、`entry`、`targets` 等）保持不变，只改界面文字和文档。

## 5 架构概览

```
app/main/        Electron 主进程：IPC 路由、凭据（macOS 钥匙串 .mm、Linux Secret Service）
app/renderer/    React 界面（Vite 构建）
app/shared/      主进程与界面共用：主题，0.7.0 起加入 IPC 方法表与校验规则
core/            与框架无关的业务模块（.mjs）：扫描、打包、加密、存储、同步引擎、导入、删除、备份
scripts/         构建、检查、验收脚本
tests/core/      node:test 单元测试
```

- **云端布局**：`sesshuttle/v1/<space>/` 下有 `space`（空间标记，format 2，含写入锁与待完成删除事务）、`heads/<logicalId>`（对话头，含 tips、版本列表、回收站）、`versions/<sha256>`（不可变版本清单）、`blobs/<sha256>`（不超过 4 MiB 的加密分块）。
- **版本格式**：只支持 bundle format 2（rollout、数据库记录、附件分别拆成分块存储）。0.7.0 起移除 format 1。
- **其他格式标识（不要和 bundle format 混淆）**：空间标记 format 1/2、对话头 `format:1`、连接文件 `format:1`、测试根标记 `.sesshuttle-test.json` 的 `format:1`，全部保持不变。
- **本机状态**：`userData/sesshuttle.sqlite`（KV 表），另有 `staging/`、`downloads/`、`backups/`、`trash/`、`recovered/`、`launchers/` 目录。

## 6 验收基线

每个版本发布前都需满足（具体用例写在当轮的验收清单里）：

1. Mac 与 Linux 安装包可通过图标启动独立窗口，无需浏览器或开发工具。
2. A 上传 → B 导入并在原生应用继续 → B 上传 → A 导入并继续；重复同步不产生重复对话。
3. 冲突保留双方；断网、凭据错误、数据损坏、Codex 进程占用、导入中断都不损坏原记录。
4. 中英文全流程无缺失翻译、无布局遮挡；状态不只靠颜色表达。
5. 远端内容加密，凭据不明文落盘，诊断不含对话内容。
6. 已验证的平台和 Codex 版本、已知限制写入当版验收记录和用户指南。

---

# 第二部分 0.7.0：清理、重构、性能与体验

## 7 本轮目标与非目标

**目标**：在不改变第一部分任何约束和既有功能语义的前提下：

1. 删除无用文件、死代码和 bundle format 1 旧链路。
2. 修复已知 bug。
3. 让代码可读：统一格式、拆分巨型组件、消除重复。
4. 提升刷新、传输、删除预览、列表渲染和安装包体积方面的性能。
5. 全面改版 UI/UX：按钮位置、引导、报错、视觉层次、术语。
6. 把 Python 研究工具移植为 JS 后删除。
7. 更新文档、截图，发布 0.7.0 安装包。

**非目标**：新增同步后端、Windows 支持、新主题、自动同步、改变加密或云端格式（除删除 format 1 外）、改变删除/备份/导入的安全语义。

## 8 本轮开发规则

### 8.1 流程

- 在本地新分支 `dev/0.7.0` 上开发（从 `main` 创建）。**不 push、不开 PR、不合并、不部署。**
- **一轮完成全部阶段**（P0–P10），中途不停下来等用户确认。每个阶段结束时按该阶段的「自验收」逐条检查，全部通过后更新第三部分的阶段状态，再进入下一阶段。
- 遇到本文没有覆盖的细节，按第一部分的约束和现有代码风格做出合理决定，记入第三部分「决策与偏差记录」后继续。只有在某项需求会违反第一部分约束时才停止，并在最终报告中说明。
- **频繁提交**：每完成一个可独立说明的小步骤就提交一次。提交信息用英文祈使句（沿用现有风格，例如 "Remove the legacy format 1 import path"），末尾必须带：

  ```
  Co-authored-by: expldfsh <expldfsh@gmail.com>
  ```

- 纯格式化必须是单独的提交，并把它的哈希写入 `.git-blame-ignore-revs`。

### 8.2 每个阶段的通用自验收

除各阶段的专属标准外，每个阶段结束时都必须满足：

- [ ] `npm test` 全部通过（Linux 专属的进程占用测试在 Mac 上跳过时须注明）
- [ ] `npm run check`（tsc 与文案检查）通过
- [ ] `npm run build` 成功
- [ ] P2 之后 `npm run lint` 无错误
- [ ] 没有读写真实 `~/.codex`、真实项目或真实 R2
- [ ] 工作区干净，所有改动已提交

---

## P0 准备与基线

- [x] 创建分支 `dev/0.7.0`。工作区里已有一批未提交的文档整理（删除旧文档、新增本文），把它们作为本分支的第一个提交（"Consolidate requirements into a single maintained document"）。
- [x] 运行 `npm test`、`npm run check`、`npm run build`，记录基线结果。当前约 60 个测试用例。（基线：64 个用例，63 通过，1 个 Linux 专属用例在 Mac 跳过；check 通过 717 条双语文案；build 成功，main.cjs 2.0 MB）
- [x] 新建 `scripts/bench.mjs`，用确定性的合成数据测量下列基线，结果写入第三部分「性能基线」表：
  - 本机扫描：2,000 条合成 rollout（含 200 条带数据库记录），首次扫描和第二次扫描耗时；
  - 云端刷新：300 条对话头，存储模拟每个请求 40ms 延迟（包装 `MemoryStore`），`engine.refresh()` 耗时；
  - 删除预览：空间内 300 个版本时 `cloudRemovalPlan` 耗时；
  - 上传：50 MiB 合成历史在模拟延迟存储上的耗时；
  - 打包体积：`app.asar` 和 dmg、tar.gz 的大小（取自现有 0.6.0 产物）。

**自验收**：基线数字已记录，bench 脚本可重复运行。

## P1 清理与修复

### P1.1 本地文件（不在 git 中）

- [x] 删除 `release/` 中 0.6.0 以外的全部旧产物（rc.1–rc.5、0.2.0–0.5.0 的 dmg/deb/tar.gz/blockmap/manifest/SHA256SUMS、`RELEASE-NOTES-0.5.0.md`、`builder-debug.yml`、`linux-unpacked/`、`mac-arm64/`），只保留 `sesshuttle-0.6.0-*` 和 `SHA256SUMS-0.6.0.txt`。
- [x] 删除 `dist/`、所有 `__pycache__/`、`.DS_Store`。

### P1.2 Bug

- [x] `app/main/main.ts` 的 `createWorkspace`：正则 `/[^\\p{L}\\p{N} _-]/gu` 多转义了一层，"My Project 中文" 会变成 `"__ _______ __"`。改为 `/[^\p{L}\p{N} _-]/gu`，并为文件夹名生成逻辑补一个单元测试（把它提成可测试的纯函数）。
- [x] `app/renderer/ManualBackups.tsx`：「删除备份」按钮用了不存在的 `className="danger"`，改为 `danger-button`。

### P1.3 死代码（均已核实无引用）

- [x] 未使用的 import：
  - `main.ts`：`safeStorage`
  - `core/bundle.mjs`：`imageType`、`atomic`、`inside`、`exists`、`Fault`、`records`、`databaseSummary`
  - `core/codex.mjs`：`walk`、`exists`
  - `core/engine.mjs`：`normalized`、`capture`、`relation`、`Fault`
  - `core/import-bundle.mjs`：`writeStream`、`Fault`
  - `core/importer.mjs`：`walk`、`Fault`
  - `scripts/archive-integration.mjs`、`scripts/native-config.mjs`：`capture`
  - `scripts/roundtrip.mjs`、`scripts/real-copy-roundtrip.mjs`：`databaseRecords`（**保留**：两个脚本都在比对数据库记录时调用它，见决策记录）
  - `tests/core/missing-images.test.mjs`：`omittedImageText`
- [x] `core/scanner.mjs` 的 `scanHistory` 接收但从不使用 `parseRollout`、`knownVersions`，删除这两个参数及 `codex.scan` 中的传参。
- [x] 只在模块内部使用的导出改为非导出：`artifactData`（bundle）、`resourceReferences`（attachments）、`RECORD_LIMIT`（stream）。
- [x] IPC 方法 `checkClosed` 渲染层从不调用，从 preload 白名单和 main 路由中删除。
- [x] 渲染层的 `notice.go` 按钮从未被设置，删除。
- [x] `MemoryStore` 只被测试和脚本使用，移到 `tests/helpers/memory-store.mjs`（脚本从这里引用），`core/storage.mjs` 只保留 `R2Store`。

### P1.4 移除 bundle format 1

用户已确认云端不需要兼容 rc 早期的 format 1 版本。

- [x] 删除 `core/codex.mjs` 中的 `capture`、`mapResources`、`validatePayload`、`relation`、`parseRollout`（`KNOWN_VERSIONS`、`sourceOf`、`imageType`、`scan` 保留）。
- [x] 删除整个 `core/receipts.mjs`；删除 `importer.import` 中的 format 1 分支和 `record()` 的旧分支，`Importer.import` 只接受 format 2（其余格式抛 `legacy_format_unsupported`）。
- [x] `vault.version()`、`vault.publishLocked()` 只处理 format 2。`publishLocked` 中旧版的 `relation()` 比较逻辑删除，只保留 `bundleIdentity` 和 `baseVersion` 判断。
- [x] `bundleBytes`、`cloud-trash.describe`、`download-copy` 删除 format 1 分支。
- [x] **云端仍可能残留 format 1 版本时，必须能被删除**：`cloud-trash` 的目录读取遇到非 format 2 版本时，把它当作不透明版本（只有大小，没有文件和附件列表，标记 `legacy`），允许移入回收站或永久删除；预览中显示「早期测试版格式，无法导入，可删除」。其他路径（导入、比较、下载副本）遇到时给出 `legacy_format_unsupported` 错误和对应文案。
- [x] `importer.restore` 和 `trash.invalidate` 中清理 `receipt/` 前缀的代码删除，只保留 `bundle-receipt/`。
- [x] 改写用到 format 1 构造数据的测试（`sync`、`import`、`recovery`、`cloud-trash`、`attachments`、`missing-images`）：
  - 测的是 format 1 专属行为的，删除；
  - 测的是通用行为（恢复、冲突、删除、附件策略）的，改为用 `captureBundle` 生成 format 2 数据，保持覆盖面不减少。
- [x] 新增测试：遇到 legacy 版本时导入报 `legacy_format_unsupported`；legacy 版本在删除预览中可见且可永久删除。

**自验收**：

- `grep -rn "format===1\|format:1\|format === 1" core` 只剩空间标记、对话头、连接文件相关的位置；
- 通用自验收全部通过；
- 测试数量的增减已在第三部分说明。

## P2 格式化与静态检查

- [x] 新增开发依赖（精确版本号）：`prettier`、`eslint`、`@eslint/js`、`typescript-eslint`、`eslint-plugin-react-hooks`。
- [x] Prettier 配置：2 空格缩进、单引号、分号、`printWidth: 100`。
- [x] ESLint 配置：至少开启 `no-unused-vars`、`react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps`（warn）。
- [x] 新增 npm 脚本：`format`、`format:check`、`lint`；把已有但未登记的 `scripts/icon.mjs`、`scripts/licenses.mjs` 登记为 `icon`、`licenses`。
- [x] 对 `app/`、`core/`、`scripts/`、`tests/` 全量格式化，**单独一个提交**，哈希写入 `.git-blame-ignore-revs`。`app/renderer/locale.ts` 在 P6 重写，这里可以跳过。
- [x] 修完 lint 报出的所有问题（不改行为）。

**自验收**：`npm run format:check` 与 `npm run lint` 通过；格式化提交中除空白和换行外没有任何逻辑改动（用 `git diff -w --stat` 抽查）。

## P3 core 与主进程重构

目标是减少重复和超长函数，行为不变。

- [x] 新建 `core/guards.mjs`，集中重复逻辑：
  - `ensureFreeSpace(dir, bytes)`：替换 8 处 `disk.bavail*disk.bsize > x + 256MiB` 检查（download-copy、import-bundle、manual-backups、removals、trash ×2、vault ×2）；
  - `hasPendingImport(state, home)`（另有 `pendingImports(state)`）：替换 importer、import-bundle、local-copies、manual-backups 中 5 处 `['prepared','validating','needs_recovery']` 判断。
- [x] 新建 `core/history-items.mjs`，合并重复的解析逻辑：
  - `messageFromItem(item)`：合并 `scanner.mjs`、`catalog.databaseSummary` 和旧 `parseRollout` 中 3 份消息提取逻辑；
  - `visitLocalImages(value, fn)`：合并 `attachments.resourceReferences`、`remap-history.change` 等处的 `localImage`/`local_image` 遍历。
- [x] `core/storage.mjs` 的 `list()` 与 `inventory()` 合并为一个分页遍历函数。
- [x] `Engine.execute`（约 80 行的单函数）拆成：校验与准备、`uploadItem`、`importItem`（含多应用分组）、收尾。语义和状态记录保持完全一致。
- [x] `Engine.refresh` 中组装单行数据的部分抽成 `buildRow(local, head)`。
- [x] **IPC 单一来源**：新建 `app/shared/ipc.ts`，定义方法名列表与「互斥」标记。
  - `app/main/main.ts` 的 `switch` 改为 `handlers` 对象（每个方法一个函数），互斥集合从这张表读取；
  - `preload.ts` 的白名单从同一张表生成；
  - 新增或删除方法只需改一处。
- [x] `main.ts` 拆分：`app/main/ipc-handlers.ts`（各 handler）、`app/main/menu.ts`、`app/main/continue.ts`（打开原生应用与 CLI 启动脚本）、`app/main/window.ts`。`main.ts` 只负责启动流程。

**自验收**：

- core 中不再出现上述重复片段（grep 验证）；
- `main.ts` 不超过约 150 行（格式化后）；
- preload 白名单与 handlers 由同一来源生成；
- 通用自验收全部通过。

## P4 后端性能

所有并发改动都必须保持现有顺序保证：**分块先于版本清单，版本清单先于对话头**；`writeBudget` 和 `onBytes` 计数在并发下仍然准确；空间写锁语义不变。

- [x] **字体**：四个 TTF 转为 WOFF2（字形和字重不变，Regular 与 Medium 都保留）。
  - 更新 `style.css` 的 `@font-face`、`assets/fonts.json`（新文件名、sha256、bytes、来源说明「由官方 TTF 无损转换」）、`assets/font-licenses/README.md`；
  - 转换工具推荐 `fonttools`（`pip install fonttools brotli`），把转换命令写进 `scripts/fonts.mjs` 或 README，保证可复现；
  - 删除仓库中的 TTF 文件。
- [x] **云端刷新并发**：`vault.allHeads()` 改为限制并发（默认 8）的并行读取，结果顺序稳定。实现一个不依赖第三方库的小型并发工具（`core/concurrency.mjs`，例如 `mapLimit`）。
- [x] **删除预览的版本缓存**：`cloud-trash` 的 `catalog()` 每次都会下载并解密空间内所有版本清单。版本按内容寻址、不可变，因此把 `describe()` 结果按 `space + versionId` 缓存到本机状态（`version-desc/<space>/<id>`），只下载缓存里没有的版本。缓存并发读取同样限制为 8。
- [x] **分块传输并发**：
  - `vault.uploadChunks` 用 `mapLimit`（默认 4）并发上传；
  - 每次任务只获取一次空间清单，同一任务内多条对话共用，并在上传后更新；
  - `artifactData`/`materialize` 下载分块时预取（并发 4），写入顺序保持不变。
- [x] **扫描缓存**：`databaseSummary` 结果按「数据库文件及其 `-wal` 的 size+mtime 均未变化 + 线程 id」缓存（与 `fileDigest` 的缓存方式一致）。只要任一数据库文件变化就重新计算，不能因缓存漏掉变化。`catalog.databaseRecords` 中每张表的 `PRAGMA table_info` 每个 catalog 只查一次。
- [x] **去掉 O(n²) 查找**：`engine.refresh`、`engine.preview`、`scanner`（`parentTitle`）、`relatedRows`（找子会话）、`TaskFeedback` 等处循环内的 `rows.find`/`filter` 改用预先建好的 Map。（core 部分在 P4 完成；渲染层的 `TaskFeedback`、已选行等随 P5 重写一并改为 Map/Set）
- [x] **减少重复全量扫描**：`importBundle` 中第三次扫描（`recordBundle` 内）复用写入后的扫描结果。写入前的 `checkUnchanged` 重新扫描**必须保留**，不得为了性能削弱写入前的安全检查。
- [x] **主进程包**：`scripts/build.mjs` 开启 esbuild `minify`，保留 sourcemap 用于诊断。
- [x] **同步记录分页**：`init` 只返回最近 50 条任务；新增 IPC `activityPage({before, limit})`。

**自验收**：

- 用 `scripts/bench.mjs` 重新测量并与 P0 基线对比，写入第三部分：云端刷新（300 条、40ms 延迟）至少快 4 倍，未变化时的第二次本机扫描明显更快，安装包 `app.asar` 明显减小；
- 新增测试覆盖：并发上传后字节计数和上限检查准确；版本描述缓存命中与失效；扫描缓存在数据库变化后重新计算；
- 通用自验收全部通过。

## P5 渲染层重构与前端性能

- [x] **拆分 `app/renderer/main.tsx`**（现在是约 36KB、约 40 个 state 的单一组件）：
  - `app/renderer/App.tsx`：外壳、导航、全局任务；
  - `pages/ConversationsPage.tsx`、`ProjectsPage.tsx`、`SettingsPage.tsx`、`BackupsPage.tsx`、`ActivityPage.tsx`；
  - `hooks/useApi.ts`（`call`、`work`、busy/phase 锁）、`hooks/useNotice.ts`、`hooks/useConfirm.ts`；
  - `main.tsx` 只负责挂载。
- [x] **共享组件**（`app/renderer/components/`）：
  - `Modal`：基于原生 `<dialog>`，支持 Esc（处理中时禁止关闭）、焦点圈定、打开时聚焦标题、恢复原焦点；替换全部 7 处手写 `.modal-backdrop`，`RemovalFlow` 也改用它；
  - `StatusBadge`、`ErrorNotice`（见 P7.9）、`Field`、`Stepper`、`Toast`、`EmptyState`、`Icon`（内置 SVG，见 P7.10）。
- [x] **列表性能**：
  - 对话表格做虚拟滚动（不引入第三方库，用固定行高的窗口化渲染）；超过 100 行时启用，保持键盘导航和全选语义；
  - 筛选和统计用 `useMemo`，搜索输入用 `useDeferredValue`；
  - 已选项改用 `Set`；行组件用 `React.memo`；
  - `Intl.DateTimeFormat` 按语言缓存。
- [x] **进度事件隔离**：传输进度（每 150ms 一次）只更新任务面板组件的状态，不触发对话页和表格重渲染（独立 store 或 context，配合 `useSyncExternalStore`）。
- [x] 删除 CSS 中的死选择器：`.sync-controls`、`.target-options`、`.progress-bar`、`.path-field`、`.detected-path`、`.path-block`、`.working span`、`.topbar .actions`，以及 P5/P7 后不再使用的选择器。
- [x] 合并 CSS 中的重复规则：`.persistent-task` 两次定义且定位冲突、`.modal-actions` 两次 sticky、`.actions` 三次 flex-wrap、`.search-row` 两处。
- [x] `.removal-dialog::backdrop` 的硬编码 rgba 改用 `--backdrop`。
- [x] `style.css` 按区块重新组织（基础 / 布局 / 组件 / 页面 / 响应式），或拆成多个 CSS 文件由入口导入。

**自验收**：

- 5,000 行合成数据（测试模式）滚动流畅，输入搜索无明显卡顿；用 React Profiler 或 Performance 面板确认传输进度更新时表格不重渲染（记录在第三部分）；
- 全部弹窗按 Esc 可关闭（处理中除外），焦点不会跑到背景；
- 通用自验收全部通过。

## P6 文案资源重组

- [x] `app/renderer/locale.ts`（约 95KB，`zh`/`en` 两个大对象加 5 段追加覆盖）重写为 `app/renderer/i18n/messages.ts`：一张表 `key: [zh, en]`，按功能分组，每个键只定义一次。
- [x] 删除 `en = {...zh}` 的回退（它会让缺失的英文悄悄显示成中文）。
- [x] 删除从未使用的键（已核实约 70 个，删除前逐个再 grep 一次，注意 `t(code)` 动态引用的错误码和 `attachment_`、`projectMatch_`、`trashStatus_`、`assetDecision_`、`trash_` 等前缀拼接）。候选：

  `deleteLocal trashHint includeDependents trashRetainedSize trashFiles retainedAttachments moveToTrash trashSpaceHint restoreDeleted restoreDeletedConfirm trashEmpty trashDone localDestination planBlockedHint confirmUpload uploadPreviewHint detectHint useDetected currentPath recoveryLoaded brandTagline workContext subtitle sync updated saving direction allTargets scopeHint confirmSync action already_imported retryHint projectHint storageHint importKey security securityText backupsHint createdAt scanErrors notVerified noSelection backup_too_large secure_storage_unavailable test_mode empty_state resolvePreview connectionNeedsCredentials saveCredentialsAgain serviceReachable serviceUnconfirmed unlockSystemStore kwalletHelp secretServiceHelp archSteps archGuide removeOnlyLocal movingToTrash taskRestoring chooseMatchingApp selectChatHint assignmentVerified waitingForApp entrySetup restoredLocal fillConnectionFields preservingVersion cloud_removed importNeedsApp`

  （`languageSaved` 通过属性访问使用，**保留**。）
- [x] 15 个被重复定义的键（`projects`、`desktop`、`both`、`incomplete`、`previewHint`、`versionHint`、`keyHint`、`noBackups`、`restoreConfirm`、`duplicate_identity`、`codex_running`、`scan_incomplete`、`project_required`、`operation_failed`、`launchManualHint`）只保留当前生效的最终文案。
- [x] 按第 4.2 节统一术语，中英文同步改。
- [x] 英文复数改用 `Intl.PluralRules`，不再用 "N conversations" 式的字符串拼接（至少覆盖对话数、附件数、文件数、版本数）。
- [x] 增强 `scripts/check-locales.mjs`，以下情况任一出现即失败：
  - 中文或英文为空；
  - 英文中含汉字；
  - 界面用到但未定义的键；
  - 定义了但从未使用的键（用允许列表声明动态前缀和错误码来源：从 core 中收集 `Fault('...')` 与 `requireThat(..., '...')` 的错误码）；
  - 重复定义的键。

**自验收**：`npm run check` 通过且新检查生效（故意加一个未使用的键能让检查失败，验证后撤回）；中英文界面无原始键名外露。

## P7 UI/UX 改版

保持 Tokyo Night Moon 语义色和现有字体；遵守第 2.1 节（任何新入口都不得自动触发扫描或云端查询）。所有新增文字走翻译资源。

### P7.1 全局框架

- [x] **顶栏**：
  - 左侧为页面标题；
  - 右侧依次为：连接状态标签（圆点 + 状态 + 空间 ID 前 8 位，点击跳到设置的存储区）、当前页主操作（对话页是「刷新」按钮，旁边显示「上次检查 HH:mm」，悬停显示完整日期时间和时区）、全局任务指示器（运行中显示阶段和进度，点击展开任务面板）；
  - 测试模式徽章保留；
  - **语言选择从顶栏移到「设置 → 本机设置」**。
- [x] **侧边栏**：
  - 每项加图标；
  - 加数字角标：对话 = 本机有更新 + 云端有更新 + 冲突的数量（只基于已刷新的数据）；同步记录 = 需处理任务数；备份与恢复 = 待恢复/待收尾数；
  - 窗口宽度 ≤ 980px 时只显示图标（带 tooltip 和 aria-label）；
  - 底部显示设备名和版本。
- [x] **布局**：去掉 `.workspace` 的 `height: calc(100vh - 322px)`，改为 flex 列布局撑满主区域，避免出现双重滚动条；横幅、操作栏出现时不挤动表格。
- [x] **反馈分层**：
  - 成功提示用右下角 Toast，5 秒后自动消失，可手动关闭，屏幕阅读器可读出；
  - 警告和错误在触发位置（弹窗内、详情区、任务面板）就地显示，保留到用户处理或关闭；
  - 页面顶部横幅只用于整页级问题（如云端检查失败）。
- [x] **快捷键**（在帮助菜单或设置中列出）：
  - ⌘/Ctrl+R：刷新（对话页，空闲时）；
  - ⌘/Ctrl+F：聚焦搜索；
  - Esc：关闭最上层弹窗；
  - ↑/↓：在列表中移动并显示详情；
  - 空格：勾选当前行；
  - ⌘/Ctrl+A：列表聚焦时全选当前视图。
  - 除刷新外，快捷键不得触发任何数据操作。

### P7.2 首次使用引导

- [x] 在对话页顶部显示「开始使用」清单卡片，替代现在堆叠的「连接横幅 + 手动刷新提示」。四步，每步显示完成状态和对应按钮：
  1. 检测本机 Codex 应用（任一应用已配置 Codex 程序和数据目录即完成）→「检测」
  2. 连接云端存储（`init.connected`）→「去连接」
  3. 刷新对话列表（有 `checkedAt`）→「刷新」
  4. 完成第一次上传或导入（存在已完成的任务）→ 显示提示文字，不提供自动操作
- [x] 四步全部完成后清单自动收起；也可手动「隐藏」。隐藏状态保存在本机配置（`config.onboardingDismissed`），并同步更新 `saveConfig` 的校验白名单。
- [x] 各页面的空状态都要具体说明情况并给出对应按钮：未检测到 Codex →「检测」；未连接 →「连接存储」；筛选后为空 →「清除筛选」；云端为空 → 说明如何上传。

### P7.3 对话页

- [x] **筛选重构**：
  - 位置分段控件：全部 / 本机 / 云端（按 `r.local`、`r.remote`）；
  - 来源标签，可多选：GPT 桌面端 / CLI / VS Code / 来源未知；
  - 开关「显示后台子会话」，默认关闭，等同现在的「主对话」视图；
  - 保留项目选择和搜索；
  - 去掉状态下拉菜单：统计数字行改为**可点击的状态标签**（全部、仅本机、仅云端、本机有更新、云端有更新、两边均有修改、已同步，各带数量），选中的高亮，再点一次取消；
  - 有任何筛选生效时显示「清除筛选」；
  - 筛选状态在切换页面后保留。
- [x] **表格列**：勾选、对话（标题 + 项目 + 归档标记）、来源、位置（两个小图标表示本机/云端是否有副本，带 aria-label）、大小、状态徽章。可按更新时间（默认）、标题、大小排序。
- [x] **多选操作栏**：从表格上方移到列表区底部，悬浮固定，不挤动布局。内容包括：已选数、筛选外的已选数、操作按钮（沿用现有「先导入还是先上传」的主按钮逻辑）、「查看所选」弹出清单、清除选择。
- [x] **详情面板**：
  - 顶部固定：来源标签、标题、状态徽章、一个主操作按钮、次操作按钮，以及「⋯」菜单（收纳删除、双向同步、保存云端副本到文件夹、比较版本）；
  - 内容分为可折叠区块：概览（时间、设备、大小、项目）、各应用状态、云端版本、历史预览；
  - 历史预览改为对话气泡：用户消息靠右、用 highlight 底色；Codex 消息靠左、用 panel 底色；工具输出默认折叠成一行「工具输出 · N 行」，可展开。
- [x] 打开原生应用前的确认弹窗增加「以后不再提示」选项（保存在本机配置）。

### P7.4 传输流程（合并 TransferFlow 与 SyncPlan）

- [x] 合并为一个带步骤条的 `TransferDialog`：
  - 导入：① 选择应用 → ② 项目与文件夹 → ③ 检查清单；
  - 上传：① 选项（包含后台子会话、上传上限、允许仅备份不完整对话）→ ② 检查清单；
  - 步骤条显示当前步、已完成的步；可返回上一步，已填内容保留；
  - 关闭时如果已有预览计划，调用 `discardPlan`；
  - 点击最终确认后关闭弹窗，进度在任务面板显示。
- [x] 「下一步」不可用时，按钮旁直接写出原因（沿用现有的 `invalid` 文案）。
- [x] 检查清单中，条目只包含一个会话且与条目同名时，不重复显示标题。
- [x] 上传、导入、双向的按钮和清单条目都带方向图标（上传：电脑 → 云；导入：云 → 电脑）。
- [x] 最终确认按钮保留明确文案（「确认上传 N 条对话」「确认导入到 GPT 桌面端」等）。
- [x] 路径检测面板作为嵌套的 `Modal` 保留。

### P7.5 删除流程

- [x] `RemovalFlow` 改用共享的 `Modal`，逻辑不变。
- [x] 第一步的「删除位置」和「删除方式」改为卡片式单选，每张卡片下用一句话说明影响。
- [x] 永久删除的最终按钮用 danger 样式，文案写明位置与数量（沿用 `ConfirmationLabel`）。

### P7.6 设置页

- [x] **未连接时**：
  - 先显示两张选择卡片：「这是第一台电脑：创建同步空间」和「已有同步空间：导入连接文件」，下方小字链接「手动填写」；
  - 字段加占位示例：Endpoint 为 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，Bucket 为 `my-sesshuttle`；
  - 失焦时即时校验 endpoint 和 bucket 格式。规则与 `R2Store` 完全一致：把规则抽到无 Node 依赖的 `core/connection-rules.mjs`，主进程和界面共用；
  - 字段下方显示具体错误；「测试连接」结果显示在按钮旁；
  - 加 Cloudflare R2 凭据文档链接（用 `shell.openExternal`，只允许该域名）。
- [x] **创建空间成功后**：显示醒目的「下一步：导出连接文件」卡片，直到导出成功（在本机状态记录 `recoveryExportedAt`）。
- [x] **本机设置**：设备名称、界面语言（从顶栏移来）、扫描位置；修改后在页面底部出现固定的「有未保存的更改 [放弃] [保存]」栏，替代顶栏的保存按钮。
- [x] **诊断弹窗**：增加「复制」按钮，通过新增的主进程 IPC `copyText` 使用 Electron `clipboard`（渲染层权限请求一律拒绝，因此不能用 `navigator.clipboard`）。

### P7.7 项目与应用页

- [x] 「检测本机 Codex 环境」作为页首主按钮。
- [x] 每个应用卡片顶部显示状态标签：已配置并验证 / 需要快速验证 / 缺少 Codex 程序 / 缺少数据目录。
- [x] 保存改为底部固定的未保存更改栏（同 P7.6）。
- [x] 项目绑定行显示当前绑定的有效性：文件夹存在时打勾；不存在时显示警告。只做本机 `stat`，不访问云端。

### P7.8 备份与恢复页、同步记录页

- [x] **备份与恢复**分为三个标签页：本机备份 / 本机回收站 / 云端回收站。
  - 本机回收站读的是本机已保存的状态，进入页面即可显示，不需要点刷新。新增 IPC `localBins`，只读本机状态；
  - 云端回收站仍需手动「刷新」，并显示上次检查时间。
- [x] 恢复和删除备份的确认改用结构化确认弹窗：摘要、可折叠的文件清单、危险操作用红色按钮并写明对象，取代现在用 `\n` 拼接的纯文本。
- [x] **同步记录**改为单一时间线列表：
  - 筛选「需处理 / 全部」；
  - 每条任务可折叠，复选框放在行首；
  - 工具栏提供「清除所选 / 全部清除」；
  - 底部「加载更多」（使用 P4 的分页 IPC）。

### P7.9 统一报错与修复动作

- [x] 新建 `app/renderer/errors.ts`，一张表定义每个错误码的严重程度（error/warning/info）和修复动作（打开设置、打开备份、展开扫描问题、刷新并重试、比较版本、检查副本、打开项目与应用、重试）。
- [x] 用这张表替换现有的 4 套映射：
  - `main.tsx` 的 `fix()`；
  - `TaskFeedback` 的 `repairLabel`；
  - `RemovalFlow` 的错误按钮；
  - `TransferFlow` 的 issue 按钮。
- [x] `ErrorNotice` 组件的结构：
  - 标题：翻译后的错误说明；
  - 可选的具体对象：路径或对话名，以代码块显示，可复制；
  - 修复按钮；
  - 「技术细节」折叠区：错误码、detail、发生阶段，附「复制」按钮。
- [x] 不新增任何「数据未修改」之类的安全承诺，除非代码路径能保证（只沿用现有文案中已有的表述）。
- [x] 所有 core 可能抛出的错误码都有中英文文案。P6 的检查脚本会核对这一点。

### P7.10 视觉层次

- [x] **状态徽章**：圆点或图标加文字，完整使用语义色：
  - success：已同步、已验证、已上传、已完成、已导入；
  - accent：进行中、本机有更新、云端有更新；
  - warning：部分完成、需处理、使用中、待处理、缺附件；
  - danger：失败、冲突、受阻；
  - 中性：仅本机、仅云端、未导入。
- [x] **内置 SVG 图标集**（`app/renderer/components/Icon.tsx`，不引入第三方库）：upload、download、cloud、laptop、refresh、trash、settings、folder、check、alert、chevron、more、copy、info、history、activity、backup、app。16 和 20px 两种尺寸，stroke 1.75，颜色用 `currentColor`。
- [x] **层次**：基于现有 `--shadow`、`--panel`、`--highlight` 定义三级阴影（卡片、浮层、弹窗），用 CSS 变量表达，不新增颜色。弹窗打开时有 120ms 淡入加轻微缩放；`prefers-reduced-motion` 下关闭动画（现有规则保留）。
- [x] **进度条**：任务面板用确定性进度条（`当前条目 / 总数`；已知总字节时显示字节进度）；切到其他页面时顶栏的任务指示器显示迷你进度。
- [x] 删除与永久操作统一使用 danger 样式（P1.2 修复的按钮也一样）。

**P7 自验收**：

- [x] 在测试模式（`scripts/ui-fixture.mjs` + `scripts/ui-storage.mjs`）中逐页走查中英文两种语言，在 1320×860 和 780×600 两种窗口尺寸下截图自查（截图不提交，只在第三部分写走查结论）：对话、项目与应用、设置（未连接 / 已连接）、备份三个标签、同步记录、导入三步、上传两步、删除两步、错误示例、首次使用清单；
- [x] 无布局遮挡、无水平滚动、无原始键名外露；
- [x] 键盘可完成主要流程，焦点可见；
- [x] 打开任何页面或弹窗都不会触发扫描或云端请求（在测试模式下记录请求，验证只有用户点击后才发生）；
- [x] 通用自验收全部通过。

## P8 Python 研究工具移植为 JS 并删除

背景：`tools/codex_lab/`（约 65KB）是最早期验证换机续聊用的 Python 实验装置，现在只剩 4 个验收脚本通过 bridge 进程调用它。核心能力已经由 `core/native.mjs`（`NativeClient`）和 `core/runtime-check.mjs`（本机应答服务）以 JS 实现。

| 脚本 | 依赖的 bridge | bridge 用到的能力 |
| --- | --- | --- |
| `scripts/cross-device.mjs`（Mac ↔ Arch 换机验收，0.6.0 用过） | `device_bridge.py` | Lab 隔离、Client、FixtureProvider、`turn`、`turns`、`prove_directory` |
| `scripts/roundtrip.mjs` | `product_bridge.py` | 同上，加 `history_equal` |
| `scripts/missing-image-roundtrip.mjs` | `missing_image_bridge.py` | 同上，加 `comparable_history`、`IMAGE` |
| `scripts/real-copy-roundtrip.mjs` | `real_copy_bridge.py` | Lab、Client、FixtureProvider、`turn` |

- [x] 把 `runtime-check.mjs` 中的 `provider()` 和 `setupHome()` 抽到 `core/fixture-provider.mjs`；runtime-check 改为引用它，行为不变。
- [x] 新建 `scripts/lib/native-lab.mjs`，提供：
  - 隔离 Lab：只在 `os.tmpdir()` 下以 `sesshuttle-lab-` 前缀创建；拒绝任何不在 Lab 内的路径；拒绝真实 `~/.codex`；
  - `startThread`、`turn`（发送一轮并等待 `turn/completed`）、`turns`（分页读回）、`proveDirectory`（让 Codex 在只读沙箱里确认工作目录）、`historyEqual`、`comparableHistory`。
- [x] 4 个脚本改为在进程内直接调用这些函数，不再启动 Python 子进程。命令行参数和用途保持兼容，在每个脚本开头注释写明用法。
- [x] 删除 `tools/`、`tests/test_lab.py`、`tests/test_bundle.py`。
- [x] 在 `docs/decisions/0001-isolated-adapter-research.md` 末尾追加「0.7.0 起研究工具已移植为 JS，Python 实现已删除」；新增 `docs/decisions/0004-js-validation-harness.md` 简述理由。
- [x] 把 4 个脚本中重复的 bridge 样板代码（spawn、readline 队列、`next()`）全部去掉。

**自验收**：

- 在 Mac 上用本机已安装的 Codex 程序运行 `scripts/roundtrip.mjs` 和 `scripts/missing-image-roundtrip.mjs`，使用合成数据并通过；运行前确认使用的是临时 Lab；
- 如本机没有可用的 Codex 程序，在第三部分注明「待用户验收」；
- `scripts/cross-device.mjs` 需要 Arch 虚拟机：若开发环境可访问则运行，否则在最终报告中列入「待用户验收」，并写清运行步骤；
- 仓库中不再有 `.py` 文件；通用自验收全部通过。

## P9 文档、截图与版本

- [ ] `package.json` 版本改为 `0.7.0`；`NativeClient.init` 中写死的 `clientInfo.version: '0.1.0'` 改为读取应用版本。
- [ ] 更新 `README.md`、`README.zh-CN.md`：版本号与安装包名改为 0.7.0，术语按第 4.2 节，链接改为 `docs/validation/0.7.0.md`。
- [ ] 更新 `docs/guides/en/quick-start.md`、`docs/guides/zh-CN/quick-start.md`、`docs/guides/zh-CN/linux-acceptance.md`：新的按钮位置、步骤式导入、首次使用清单、术语、版本号。英文指南补一段 Linux 验收要点（对应中文 `linux-acceptance.md`）。
- [ ] **重新生成 `docs/images/` 的 6 张截图**（en/zh-CN × upload/scope/import）：
  - 新增 `scripts/screenshots.mjs`，用 Playwright 的 Electron 支持，在测试模式和合成数据下启动应用并截图；
  - 用 `deviceScaleFactor: 2`；
  - 叠加与现有风格一致的编号标注：琥珀色圆形数字加描边框，颜色取 `--warning`；
  - 脚本可重复运行。
- [ ] 新建 `docs/validation/0.7.0.md`：构建提交、测试结果、性能前后对比、走查结论、已验证与待用户验收的项目、安装包 SHA-256。

**自验收**：文档中没有失效的相对链接（脚本检查）；指南中的按钮名称与界面一致（对照文案表抽查）。

## P10 最终验收与打包

- [ ] `npm run format:check`、`npm run lint`、`npm test`、`npm run check`、`npm run build` 全部通过。
- [ ] `npm run package:mac`：生成 `release/sesshuttle-0.7.0-mac-arm64.dmg`。
- [ ] `npm run package:linux`：生成 `release/sesshuttle-0.7.0-linux-x64.tar.gz` 和 `-linux-amd64.deb`（在 Mac 上交叉构建）。
- [ ] 生成 `release/SHA256SUMS-0.7.0.txt`，并写入 `docs/validation/0.7.0.md`。
- [ ] 从 dmg 启动测试模式应用做冒烟检查：窗口打开、字体正确（WOFF2 生效）、刷新合成数据、打开导入三步弹窗、关闭。
- [ ] 比较 0.6.0 与 0.7.0 的安装包大小，写入验收记录。
- [ ] 更新本文第三部分：所有阶段状态、决策与偏差、性能对比、待用户验收清单。
- [ ] 最终提交后输出一份给用户的验收报告（在对话中），包括：
  - 完成内容摘要（按阶段）；
  - 偏差与原因；
  - 性能前后对比；
  - 安装包位置；
  - **用户需要亲自验收的步骤**：Mac ↔ Arch 真实换机往返、真实 R2 连接、Linux 系统密码库授权、`cross-device.mjs`（若开发中未运行）、在真实 GPT 桌面端中继续对话。

---

# 第三部分 进度与决策记录

## 阶段状态（0.7.0）

| 阶段 | 状态 | 提交范围 | 备注 |
| --- | --- | --- | --- |
| P0 准备与基线 | 已完成 | 615cdf7–39a7aac | 基线见下表；bench 在 M 系列 Mac 上运行，两次结果差异 <2% |
| P1 清理与修复 | 已完成 | 39d67c4–bb0de81 | 测试 64→65 通过（另 1 个 Linux 专属用例在 Mac 跳过），增减见决策记录 |
| P2 格式化与静态检查 | 已完成 | da5b92f–92ebddf | 格式化提交 04801ae 已写入 `.git-blame-ignore-revs`；lint 0 错误 0 警告 |
| P3 core 与主进程重构 | 已完成 | afae909–c19e531 | 测试 65→67（+2 history-items）；`main.ts` 134 行；test-mode 冒烟脚本 `scripts/smoke.mjs` 通过 |
| P4 后端性能 | 已完成 | bd6806d–cc1b2e3 | 测试 67→76；性能见下表（P4 结束时测量，最终数字在 P10 更新） |
| P5 渲染层重构与前端性能 | 已完成 | 9148fc4–028d026 | 5,000 行与进度隔离结果见“前端性能（P5）”；全部弹窗 Esc/焦点检查通过 |
| P6 文案资源重组 | 已完成 | b496183 | 719 → 650 个键；检查脚本对 6 类问题逐一注入验证会失败，撤回后通过；中英文页面无原始键名 |
| P7 UI/UX 改版 | 已完成 | 665d218–15ffae1 | `scripts/ui-walkthrough.mjs`：中英文 × 1320×860 / 780×600 共 100 张截图，无水平滚动、顶栏遮挡、原始键名和不可见焦点；64 次打开页面/弹窗/标签页的检查均无扫描或云端请求；导入三步、上传两步、删除两步、错误示例、首次使用清单均走通；5,000 行性能复测通过 |
| P8 Python 工具移植 | 已完成 | 3f05e13–48051c6 | 本机 Codex 0.166.0（Homebrew）两端：`roundtrip.mjs` 及其 4 个变体（压缩、仅数据库、原生项目、重复身份）、`missing-image-roundtrip.mjs`（含 `--compressed`）全部通过，结果与移植前 Python 版一致（5/7 轮）；`real-copy-roundtrip.mjs` 以 Lab 中用 `openai` 提供方生成的合成来源通过；`cross-device.mjs` 在 Mac 上依次模拟 source/receive/return 通过，真实 Mac ↔ Arch 待用户验收；应用内快速验证改用共享应答服务后对 0.167.0-alpha.3.2 通过；仓库无 `.py` 文件 |
| P9 文档、截图与版本 | 未开始 | | |
| P10 最终验收与打包 | 未开始 | | |

## 性能基线与结果

| 指标 | 0.6.0 基线 | 0.7.0 结果 |
| --- | --- | --- |
| 本机扫描 2,000 条（首次 / 第二次） | 496 ms / 322 ms | 456 ms / 88 ms（P4） |
| 云端刷新 300 条，40ms 延迟 | 12,447 ms（302 次请求） | 1,714 ms（302 次请求，7.3×，P4） |
| 删除预览，300 个版本（首次 / 缓存后） | 16,636 ms / 16,632 ms | 2,346 ms / 726 ms（P4） |
| 上传 50 MiB，模拟延迟 | 1,366 ms（28 次请求） | 780 ms（28 次请求，P4） |
| `app.asar` 大小 | 54.7 MB | 19.0 MB（P4，`electron-builder --dir`） |
| dmg / tar.gz 大小 | 144.9 MB / 143.7 MB | |

### 前端性能（P5，测试模式，`scripts/ui-performance.mjs`）

| 项目 | 结果 |
| --- | --- |
| 5,003 行（5,000 条合成 + 3 条演示）刷新到首屏 | 2,833 ms（含首次扫描 5,003 个 rollout） |
| DOM 中实际渲染的行 | 14 行（超过 100 行启用窗口化，上下各多渲染 8 行） |
| 逐半屏滚动到底（1,799 帧） | 帧间隔中位数 8.3 ms，P95 9.9 ms；最后一行可达 |
| 搜索框逐字输入 5 个字符并完成筛选 | 186 ms（含 30 ms/字的输入间隔） |
| 主进程上传 20 条对话期间的进度事件 | 对话表格重渲染 0 次、行重渲染 0 次；只有任务面板更新（以渲染计数器 `sesshuttleRenderStats` 记录） |

## 决策与偏差记录

| 日期 | 决定 | 来源 |
| --- | --- | --- |
| 2026-11-06 | 云端不再兼容 rc 早期的 bundle format 1；残留版本只保证可删除 | 用户确认 |
| 2026-11-06 | Python 研究工具移植为 JS 后删除（方案 B） | 用户确认 |
| 2026-11-06 | 字体只转 WOFF2，保留 Regular 和 Medium，字形不变 | 用户确认 |
| 2026-11-06 | UI/UX 按第 P7 节一次性全部完成，包括合并导入弹窗、重做筛选和术语改名 | 用户确认 |
| 2026-11-06 | 旧需求文档、开发计划、rc–0.5.0 兼容与验收记录、0.5.0 发布草稿和对应 workflow 删除；保留 0.6.0 验收记录 | 用户确认 |
| 2026-11-06 | 开发流程：一轮内逐阶段自验收、完成全部阶段后交给用户验收；频繁本地提交并带 Co-authored-by；不 push、不开 PR | 用户确认 |
| 2026-11-06 | P1.3 列为未使用的 `databaseRecords`（`scripts/roundtrip.mjs`、`scripts/real-copy-roundtrip.mjs`）实际在比对数据库记录时被调用，保留不删；其余未使用 import 均已删除 | 开发者核实 |
| 2026-11-06 | P1.1 同时删除了 `release/.icon-icns/`（electron-builder 的图标缓存，打包时自动重建） | 开发者决定 |
| 2026-11-06 | 工作区文件夹名的生成提到 `core/workspace.mjs` 的 `workspaceFolderName()`，由 main 调用，`tests/core/workspace.test.mjs` 覆盖 | 开发者决定 |
| 2026-11-06 | `MemoryStore` 移到 `tests/helpers/memory-store.mjs` 后，脚本也从这里引用；另新增 `tests/helpers/bundles.mjs`，用真实扫描 + `captureBundle` 生成 format 2 测试数据 | 开发者决定 |
| 2026-11-06 | `vault.version(id, {legacy:true})` 是唯一能读到非 format 2 清单的入口，返回 `{legacy, manifest, objectBytes}`；只有云端删除目录和 `publishLocked` 的分支比较使用它。旧版本作为 tip 时，新上传按 `baseVersion` 判断，与 0.6.0 的跨格式行为相同（不会判为已同步） | 开发者决定 |
| 2026-11-06 | legacy 版本在删除预览中只显示存储对象大小；它成为删除后的保留 tip 时，对话头只继承它清单中的标题、来源、项目、更新时间、设备、归档等简单字段 | 开发者决定 |
| 2026-11-06 | TypeScript 7 是原生编译器，没有 typescript-eslint 需要的 JS API（其 peer 依赖为 `typescript <6.1`）。因此 `typescript` 改为 6.0.3（只供 lint 解析），类型检查仍用 7.0.2（别名 `typescript-native`，`npm run check` 直接调用它），类型检查结果不变。另加开发依赖 `globals`（flat config 需要 Node/浏览器全局变量表） | 开发者决定 |
| 2026-11-06 | ESLint 关闭 `@typescript-eslint/no-explicit-any`（IPC 数据在主进程校验，界面层沿用宽松类型）和 `no-require-imports`（钥匙串原生模块用 require 加载）；空 `catch {}` 允许。`react-hooks` 只开启两条经典规则，不启用 7.x 的 React Compiler 规则 | 开发者决定 |
| 2026-11-06 | 格式化前先把 `TaskFeedback` 中字面的全角空格改写为 `{'\u3000'}` 表达式（单独提交）：Prettier 会把 JSX 文本中的 U+3000 当作空白删除，改变显示。格式化提交用 esbuild 压缩输出逐文件比对，除 JSX 文本拆成相邻字符串子节点外完全一致 | 开发者决定 |
| 2026-11-06 | 6 个 `exhaustive-deps` 警告都是有意的“只在打开时运行”或按 key 运行的 effect，补依赖会改变行为，因此加了带理由的禁用注释；这些组件在 P5 重写时重新处理 | 开发者决定 |
| 2026-11-06 | P3：pending-import 判断在 P1 删除 format 1 导入后只剩 4 处；`manual-backups` 按备份 ID、`importer.restore` 按目录批量改状态，因此 guards 另导出 `pendingImports(state)` 供这两处使用 | 开发者决定 |
| 2026-11-06 | P3：`history-items.mjs` 另导出 `messageFromEvent()`（rollout 的 `user_message`/`agent_message` 事件）和通用 `walkObjects()`；`resourceReferences` 同一次遍历还要检查外部图片和远程资源，所以基于 `walkObjects` + `isLocalImage`，`remap-history` 和 `real-copy-roundtrip` 用 `visitLocalImages`。扫描器的 rollout 预览仍不收录命令输出（与 0.6.0 相同） | 开发者决定 |
| 2026-11-06 | P3：`list()`/`inventory()` 共用 `listObjects(prefix, limit, entry)`，各自的上限（2 万 / 20 万）与逐项校验保持原样（`list` 不要求 `Size`，测试中的模拟 S3 也不返回它） | 开发者决定 |
| 2026-11-06 | P3：主进程共享状态集中在 `app/main/context.ts` 的 `Context` 对象；`Handlers` 类型由 `IpcMethod` 映射而来，漏写或多写 handler 都是类型错误。另加开发依赖 `playwright-core`（精确版本）和 `scripts/lib/test-app.mjs`、`scripts/smoke.mjs`，用于测试模式启动应用（P5/P7 走查、P9 截图、P10 冒烟共用） | 开发者决定 |
| 2026-11-06 | P4 字体：WOFF2 转换会去掉 TTF 的数字签名表 `DSIG`（重新编码后签名必然失效），其余所有表、字形顺序、cmap、每个字形轮廓与原 TTF 逐一比对一致；`assets/fonts.json` 的 `format` 仍为 1（只新增字段，没有读取方）。转换用 fontTools 4.68.0 + brotli 1.2.1，输出可逐字节复现。四个文件 51.8 MB → 17.3 MB | 开发者决定 |
| 2026-11-06 | P4 版本描述缓存：通过 `cloudRemovalPlan(vault, request, {cache})` / `changeCloud(..., {cache})` 显式传入本机状态（`Removals` 与主进程传 `state`），条目带 `v:1` 结构校验，损坏即重算；空间中已不存在的版本条目在下次目录读取时删除 | 开发者决定 |
| 2026-11-06 | P4 共享空间清单：一次传输任务（`vault.beginTransfer()`…`endTransfer()`）内只列一次空间对象；若空间标记的 `completed`（已完成的云端删除）在两次上传之间变化，则重新列出，避免沿用已被其他设备永久删除的分块。下载侧预取 4 个分块，写入顺序不变 | 开发者决定 |
| 2026-11-06 | P4 扫描缓存：除数据库摘要外，rollout 的首条记录和预览解析也按“路径+大小+mtime+ctime”缓存（与 `fileDigest` 相同），每个文件每次扫描只 stat 一次；数据库戳记含每个库文件及其 `-wal` 的大小、mtime、ctime、inode，在读事务开始前取得，空的 `-wal`（只读打开会创建）视同不存在。读取失败从不缓存 | 开发者决定 |
| 2026-11-06 | P4 第三次扫描：`recordBundle` 的扫描发生在原生验证之后（验证会改写数据库，必须在此之后记录回执），因此改为把这次扫描返回给调用方；当唯一的来源目录正是刚验证过的目录时，引擎不再为同步状态重新扫描。写入前的 `checkUnchanged` 重新扫描保留 | 开发者决定 |
| 2026-11-06 | P4 sourcemap：`dist/*.map` 不打进安装包（`build.files` 排除），P10 随安装包另存一份到 `release/`，用于诊断 | 开发者决定 |
| 2026-11-06 | P4 同步记录分页：`activityPage` 把传输与删除任务合并为一条时间线，用 `{at,id}` 游标；`init` 另返回全部任务中“需处理”的数量和所有中断的删除任务（不受分页影响）；`clearActivity({all:true})` 清除全部已完成记录（含未加载的页） | 开发者决定 |
| 2026-11-06 | P5：`useConfirm` 返回待确认的问题，由 App 用 `Modal` 渲染（保持 `.ts` 文件名）；问题支持标题、确认按钮文案和 danger 样式，供 P7 的结构化确认使用。现有的业务组件（TransferFlow、SyncPlan、RemovalFlow 等）暂留在 `app/renderer/` 根目录，P7 合并/改写时再移动 | 开发者决定 |
| 2026-11-06 | P5：`Modal` 基于原生 `<dialog>.showModal()`，背景自动 inert，因此焦点不会离开弹窗；新增 `step` 属性，步骤切换时把焦点移回标题并滚到顶部（RemovalFlow 与 P7 的步骤弹窗共用）。`Select` 的下拉菜单改为挂到所在的 `<dialog>` 内，否则会被 inert 背景挡住 | 开发者决定 |
| 2026-11-06 | P5：虚拟滚动的行高在 CSS 中固定为 64px，运行时再测量一次实际行高用于计算；“全选”只作用于当前筛选结果（与 0.6.0 相同）。`copyText` IPC 在 P5 提前加入，因为 `ErrorNotice` 的“复制”需要它 | 开发者决定 |
| 2026-11-06 | P5：`scripts/ui-fixture.mjs` 新增 `--count=N`（性能测试）和 `--binary=`；默认不再把 `/Applications/ChatGPT.app` 中真实的 Codex 程序写入测试配置，而是在测试根目录生成一个只报告版本 0.166.0 的替身脚本，避免走查时执行本机真实程序 | 开发者决定 |
| 2026-11-06 | P5 样式：`style.css` 拆为 `styles/base|layout|components|pages|responsive.css`。重组前后在对话、设置、项目、备份、同步记录、导入弹窗（1320 与 780 宽）中逐元素比对计算样式完全一致；唯一差异是删除弹窗段落间距回到它自己的 12px（P5 初期新增的通用弹窗规则曾把它改成 16px） | 开发者决定 |
| 2026-11-06 | P6：0.6.0 的英文没有任何键实际回退到中文（分析确认），33 个键被定义过多次，保留最终生效值。删除需求列出的 70 个键，另删 `pending`、`files`、`device`（无处使用）及改为复数消息后不再需要的 `chatCountUnit`、`backupVersions`、`confirmUploadCount`、`cloudObjects`、`actualScope`；新增 `native_method_missing` 文案（core 可抛出但此前无文案） | 开发者决定 |
| 2026-11-06 | P6 术语：除第 4.2 节外，`recoveryKey`（手动填写的空间解密密钥）统一称“空间密钥 / Space key”，与“连接文件含空间密钥”一致；`credential_write_failed` 指本机加密凭据文件，改称“本机加密凭据”以免与导出的“连接文件”混淆 | 开发者决定 |
| 2026-11-06 | P6 检查脚本：错误码来源由 `scripts/lib/error-codes.mjs` 从 core 与主进程源码收集（`Fault` 首参、`requireThat` 次参、`code:` 字面量与错误码映射表，排除比较运算的操作数）；core 产生、界面以 `t(value)` 显示的状态/阶段/原因/位置/问题码在脚本中以 `DATA_VALUES` 显式声明；`external_attachment` 作为早期测试版云端对话头可能携带的问题码保留；`unsupported`/`unsafe`/`unreadable` 是附件检查内部状态，不要求文案 | 开发者决定 |
| 2026-11-06 | P6：消息值的英文可为 `{one, other}`，`tn(key, n)` 用缓存的 `Intl.PluralRules` 选择形式；`t(key, vars)` 支持 `{name}` 占位，检查脚本要求中英文占位一致。另加 `scripts/lib/raw-keys.mjs`，走查时检测界面上露出的 camelCase/snake_case 键名 | 开发者决定 |
| 2026-11-06 | P1 测试数量：+1 工作区文件夹名；−1 `relation()` 的字节前缀比较（format 1 专属）；+2 legacy 版本（删除预览可见且可永久删除、导入/比较/下载副本/预览拒绝；与新上传并存为冲突分支且可移入回收站）。`attachments` 用例改为 `captureBundle`+`remapHistory`，删去只适用于 format 1 回执的“下一轮还原原始路径”部分；`sync` 中“未完成记录不可快照”改为通过扫描器和 `captureBundle` 验证。其余 format 1 用例改用 format 2 数据，断言保持 | 开发者决定 |
| 2026-11-07 | P7 布局：对话页改为 flex 列布局，列表区占满剩余高度；窗口宽度 ≤1150px 时列表与详情上下排列（各自滚动，工作区最小高 520px），只有高度 ≤640px 的窗口整页才会滚动；≤980px 侧边栏只显示图标，名称在 tooltip 和 aria-label 中，设备名移到底部区域的 tooltip | 开发者决定 |
| 2026-11-07 | P7 任务面板：改为顶栏任务指示器下方的浮层（点外部、Esc 或切换页面时收起），取代 0.6.0 固定在底部的任务卡片；进度仍只更新指示器和面板，不重渲染对话表格（`scripts/ui-performance.mjs` 改为检查 `.task-indicator`） | 开发者决定 |
| 2026-11-07 | P7 筛选：「显示后台子会话」打开时，后台子会话不再受来源标签限制（它们的来源通常与主对话相同或缺失），关闭时与 0.6.0 的「主对话」视图一致；相同排序值的行按 ID 排定次序，刷新前后不再互换位置 | 开发者决定 |
| 2026-11-07 | P7 应用状态标签：运行时保存状态 `builtin`/`verified` 显示「已配置并验证」，`unchecked`/`untested` 显示「需要快速验证」，未设置或找不到程序显示「缺少 Codex 程序」，数据目录不存在显示「缺少数据目录」；只读已保存的检查记录并 `stat`，不运行程序 | 开发者决定 |
| 2026-11-07 | P7 首次使用：第 4 步以 `init.hasCompletedTransfer`（任一传输记录中有条目已上传或已导入，记录被清除后不再计入）判断；第 1 步以任一应用同时配置了程序和数据目录判断。导出连接文件提醒以 `spaceCreated`（本机创建的空间 ID）与 `recoveryExportedAt`（`{space, at}`）比较，换空间后会重新提醒 | 开发者决定 |
| 2026-11-07 | P7 反馈：刷新时云端检查失败只显示页面顶部横幅（不再同时弹出错误提示）；`ErrorNotice` 出现在视野外时自动滚入视野；切换页面时内容回到顶部。关闭按钮统一用新增的 `close` 图标（图标集 18 → 19 个） | 开发者决定 |
| 2026-11-07 | P7 文案检查：`check-locales` 另检查 `t()`/`tn()` 参数中条件表达式选出的键（借此发现并补上 `nextStep`、`confirmImportTo`、`confirmBothTo`、`stepApps` 等 0.6.0 改版后缺失的键）；新增前缀 `onboard`，`missingRuntime`/`missingFolder`/`replaced` 作为主进程/删除任务产生的状态声明在 `DATA_VALUES` | 开发者决定 |
| 2026-11-07 | P7 走查：新增 `scripts/ui-walkthrough.mjs`。测试模式下记录渲染层发往主进程的每个请求（包装 `ipcMain` 的处理函数）和本机模拟 S3 收到的每个请求；打开页面、弹窗、详情和标签页时只允许 `init`/`backups`/`localBins`/`appStatus`/`folderStatus`/`activityPage`，且模拟 S3 请求数为 0。`scripts/ui-storage.mjs` 在首行之后逐行输出收到的请求 | 开发者决定 |
| 2026-11-07 | P8：Lab 的“同一数据目录同时只有一个 App Server”由 Python 的 `flock` 改为 Lab 内独占创建的锁文件（加进程内集合）；`checked()` 另显式拒绝真实 `~/.codex`。Lab 不在结束时删除（与 Python 版相同），便于检查；位于系统临时目录 | 开发者决定 |
| 2026-11-07 | P8：本机应答服务统一回复 `Sesshuttle local test reply`（Python 版为另一句合成文本，脚本不检查回复内容）；只接受 `POST /v1/responses`。`real-copy-roundtrip.mjs` 只能用于 `openai` 提供方的历史，开发中用 Lab 内生成的合成历史验证，从未读取真实 `~/.codex` | 开发者决定 |
| 2026-11-07 | P8：ChatGPT 桌面端自带的 `codex-cli/bin/codex` 是启动脚本（应用内快速验证会拒绝为 `runtime_launcher`），可执行程序在 `codex-cli/CodexCLI.app/Contents/MacOS/codex`；验收脚本若用 0.167 预览版，目标端须先通过快速验证（`runtime_check_needed`），因此开发中两端都用 Homebrew 的 0.166.0 | 开发者核实 |

## 历史轮次摘要

- **0.1.0-rc.1 – rc.5**：核心接续验证、R2 同步、GiB 级分块、附件授权与缺图接续。
- **0.2.0**：原生项目归属、跨应用导入。
- **0.3.0**：本机/云端 × 回收站/永久删除六种组合。
- **0.4.x**：连接文件换机、系统密码库授权、操作反馈改版。
- **0.5.0**：所有数据操作改为用户发起；手动备份；同步记录清除。
- **0.6.0**：名单外 Codex 程序的本机快速验证；冲突目录中的换机续聊；缺少模型服务的预检。
