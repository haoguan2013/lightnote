# 修改日志

## 基线版本 — 2026-08-04

| 文件 | 说明 |
|---|---|
| `notes.html` | 单文件笔记应用。锁屏（4位PIN）+ 笔记面板（添加/删除/清空），localStorage 持久化，毛玻璃 UI 风格，响应式布局。 |
| `CLAUDE.md` | 项目文档。包含架构、数据模型、核心功能、UI 设计模式、开发注意事项、修改日志规则。 |
| `modified.md` | 本文件。记录每次代码改动的日志。 |

---

### 记录格式说明

## 2026-08-04 — 添加 Tauri 打包文件

- **文件**: `package.json`
- **改动**: 新建。Node.js 项目配置，添加 `@tauri-apps/cli` v2 和 `serve` 开发依赖，配置 `dev`/`build` 脚本。

- **文件**: `src-tauri/Cargo.toml`
- **改动**: 新建。Rust 项目配置，依赖 `tauri` v2、`serde`、`serde_json`，构建依赖 `tauri-build` v2。

- **文件**: `src-tauri/tauri.conf.json`
- **改动**: 新建。Tauri v2 应用配置：窗口 720×600，加载 `notes.html`，dev 模式使用 `serve` 在 `localhost:1420` 提供静态文件。

- **文件**: `src-tauri/build.rs`
- **改动**: 新建。Tauri 构建脚本。

- **文件**: `src-tauri/src/lib.rs`
- **改动**: 新建。Tauri 应用库入口，调用 `tauri::Builder` 启动。

- **文件**: `src-tauri/src/main.rs`
- **改动**: 新建。Rust 主入口，Windows 下隐藏控制台窗口。

- **文件**: `src-tauri/capabilities/default.json`
- **改动**: 新建。Tauri v2 默认权限配置，启用 `core:default`。

- **文件**: `.gitignore`
- **改动**: 新建。忽略 `node_modules`、`src-tauri/target`、IDE 和系统文件。

---

### 记录格式说明

每次改动请按以下格式追加：

## 2026-08-14 19:52 — 生成应用图标并首次运行桌面应用

- **文件**: `app-icon.svg`
- **改动**: 新建。Tauri 应用图标源文件（1024×1024，靛蓝渐变底 + 白色笔记卡片 + 锁图形）。

- **文件**: `src-tauri/icons/`
- **改动**: 通过 `npx tauri icon app-icon.svg` 生成全套平台图标（icon.ico、icon.icns、32x32.png、128x128.png、128x128@2x.png、StoreLogo.png 及 iOS/Android 各尺寸）。修复 `tauri-build` 因缺少 `icon.ico` 导致的编译失败。

- **说明**: 首次 `npm run dev` 时发现 `tauri-build` 必须存在 `icons/icon.ico` 才能生成 Windows 资源文件（即使 dev 模式）。生成图标后编译成功，应用窗口正常运行。dev 进程在窗口关闭后随之退出（正常行为）。

---

```
## YYYY-MM-DD HH:MM

- **文件**: `<文件路径>`
- **改动**: <改动内容简述>
```

---

## 2026-08-14 — 四大功能改造（加密 / Markdown / 分组 / 自动解锁）

### 文件: `notes.html`（核心重写）

- **改动 1 — 本地数据加密**: localStorage 从明文改为 Web Crypto AES-GCM + PBKDF2（PIN 派生密钥，600000 次迭代，SHA-256，salt 16B / IV 12B 随机）。唯一持久化键改为 `light_notes_vault`。PIN 校验以 GCM 鉴权 tag 判定（不存 PIN/哈希）。`file://` 直开因 `crypto.subtle` 不可用而显示横幅并阻止运行（需 localhost/HTTPS）。
- **改动 2 — 第 4 位自动解锁**: PIN 输入完成第 4 位即自动解锁（先取 PIN 再清空再解锁），保留 Enter / 解锁按钮兜底；支持整串粘贴分发到 4 格。
- **改动 3 — Markdown 存储与实时预览**: 零依赖自写解析器 `mdToHtml`（块级：fenced 代码/标题/分隔线/引用/嵌套列表缩进栈/段落；行内：code→链接→粗体→斜体；待办 `- [ ]`）。编辑器 textarea 源码 + 下方 `#mdPreview` 实时预览（防抖 150ms）。XSS 策略：先 `escapeHtml` 再拼装受控标签，链接 URL 过 `safeUrl` 白名单。
- **改动 4 — 左侧分组 + 多级分组**: 笔记视图改三栏布局（左栏树形分组 + 右区笔记列表 + Markdown 编辑器）。分组任意嵌套、展开折叠、新建/重命名/删除（删除时笔记移至未分组，数据零丢失）、笔记「↔ 移动」下拉选择目标。笔记卡片支持编辑（upsert）、移动、删除。
- **改动 5 — 修改 PIN**: 新增「🔑 修改PIN」弹层（旧PIN→新PIN→确认），成功用新 PIN 全量重加密。移除原「重置 PIN」按钮（加密后无验证重置不安全）。忘 PIN = 数据不可恢复，界面已明示。
- **改动 6 — 数据迁移**: 旧明文（`light_notes_data`/`light_notes_pin`）首次启动自动迁移为加密 vault（用原 PIN 派生），删除旧键。

### 文件: `src-tauri/tauri.conf.json`

- **改动**: 窗口尺寸 720×600 → 960×640（minWidth 400→860，minHeight 500→540），适配三栏布局。

### 文件: `CLAUDE.md`

- **改动**: 同步更新架构（三栏布局）、数据模型（加密 vault）、核心功能（Markdown/分组/自动解锁/修改PIN）、开发注意事项。

### 备份

- 原始版本备份于 `%TEMP%\notes.html.backup-20260814`。

---

## 2026-08-14 — UI 布局改造（满屏左右 / 笔记标题 / 左右编辑器 / 可折叠分组树）

### 文件: `notes.html`

- **改动 1 — 取消浮窗居中，改为满屏布局**: `.app-window` 由居中浮窗卡片改为铺满窗口（`width:100%` / `height:100vh`），`body` 改为 flex 满屏容器。主面板 `#notesPanel` 内为三区左右布局：左侧分组边栏（230px）+ 右侧笔记列表 + 编辑器。
- **改动 2 — 笔记新增标题字段**: 数据模型 `{ id, title, content, timestamp, groupId }` 增加 `title`（≤60 字符）。编辑器顶部新增 `#noteTitleInput`；笔记卡片优先显示标题，无标题时回退为正文纯文本首 24 字；保存时标题+正文均可为空校验（抖动提示沿用）。数据迁移时旧笔记 `title` 默认为空字符串。
- **改动 3 — 编辑器左右 50% 布局**: `#editorPanel` 内 `.editor-pane` 改为左右两栏各 50%——左侧 `#noteTitleInput` + `#mdTextarea`（Markdown 源码），右侧 `#mdPreview`（实时预览，防抖 150ms 不变）。移动端（≤860px）自动切换为上下叠放。
- **改动 4 — 分组树可折叠**: 新增 `#toggleSidebarBtn`（侧栏头部 ◀/▶）与状态 `sidebarCollapsed`，`.sidebar.collapsed` 折叠为 48px 窄条（只留收起按钮），点击展开恢复。折叠状态仅存内存。
- **改动 5 — 适配响应式**: 移动端分组边栏铺满宽度、编辑器左右改为上下堆叠。

### 文件: `src-tauri/tauri.conf.json`

- **改动**: 无（窗口 960×640 已适配满屏布局，minWidth 860 保持不变）。

### 验证

- 22/22 逻辑测试通过（Markdown 渲染 + 加密/解密 + 嵌套列表 + XSS）。
- 语法检查通过（提取 `<script>` 运行 `node --check`）。
- 重启桌面应用（PID 28148），从 `localhost:1420` 拉取新代码，窗口加载满屏布局正常。

---

## 2026-08-14 — 合并树 + 编辑器顶满（文件管理器式导航）

### 文件: `notes.html`

- **改动 1 — 笔记列表与分组树二合一**: 移除右侧独立笔记列表（`#notesList` / `#notesListHeader` / `renderNotes()` / `renderNotesHeader()` / `updateBadge()` 全删）。左侧 `#groupSidebar` 改为**合并树（文件管理器式）**：展开的分组节点下直接列出其笔记叶子 `renderNoteLeaf`（📝 标题 + hover ✎/↔/✕）；「未分组」为虚拟根（展开键 `UNGROUPED_KEY`，默认展开）；分组行 badge = 该组直接笔记数（`directNotes()` 按时间降序）。
- **改动 2 — 编辑区/预览区顶满剩余空间**: `.right-area` 只保留 `#editorPanel`，`flex:1` + `min-height:0` 撑满剩余高度；标题输入 → 左 50% `#mdTextarea` / 右 50% `#mdPreview` 随窗口伸展。
- **改动 3 — 合并树交互**: 分组箭头 = 切换展开；分组名称 = 选中 + 展开（祖先链展开）；笔记叶子点击 = `startEdit()` 打开编辑并自动把所属分组设为当前分组（后续新笔记归入该组）；删除分组仍将子孙笔记移至「未分组」。
- **改动 4 — 新建分组行内输入插入位**: `insertInlineInput(parentId)` 不再追加到树尾，而是插入到父分组（含子孙）最后一个节点之后。
- **响应式**: 保留 860px 纵向切换；左右布局文字描述同步。

### 文件: `CLAUDE.md`

- **改动**: 架构部分「三栏结构」→「左右结构」（合并树 + 顶满编辑器）；数据模型笔记增加 `title` 字段；分组/笔记 CRUD、状态变量、开发注意事项同步更新。

### 验证

- 22/22 逻辑测试通过；`node --check` 语法通过；grep 确认无 `renderNotes`/`notesList` 残留引用。
- 重启桌面应用（PID 29588），从 `localhost:1420` 拉取新代码。

---

## 2026-08-14 — 回收站 + 去除清空 + 关闭浏览器模式 + 托盘驻留

### 文件: `notes.html`

- **改动 1 — 移除「清空本组」**: 删除 `#clearNotesBtn`、`clearAllNotes()` 及其绑定。笔记只能逐个删除。
- **改动 2 — 回收站（软删除）**: 数据模型新增 `trash` 数组（payload 升 v3，解密时 `trash || []` 兼容旧库）。`deleteNote()` 不再直接删除，而是把笔记移入回收站（追加 `deletedAt`）。树底新增 `🗑️ 回收站` 虚拟根节点（`TRASH_KEY`，badge = 数量），展开显示已删笔记（按删除时间降序）。
  - **恢复** `restoreFromTrash()`：移回原分组（分组已删则归未分组），自动打开继续编辑。
  - **彻底删除** `purgeTrash()`：从回收站移除，不可恢复（树叶子 ✕ 与编辑器「🗑️ 彻底删除」按钮）。
  - **自动清理** `purgeExpiredTrash()`：解锁加载数据时删除 `deletedAt` 超 30 天（`TRASH_TTL`）的笔记。
  - **只读查看**：回收站视图下点笔记叶子 → 编辑器变只读（textarea readonly），按钮切换为「↺ 恢复」/「🗑️ 彻底删除」；`cancelEdit()` 统一复位按钮与只读态。
- **改动 3 — 强制桌面模式**: `init()` 检测 `window.__TAURI_INTERNALS__`，非 Tauri 环境（浏览器直开）显示横幅并阻止运行，不落任何数据。
- **改动 4 — 删除文案**: 普通删除 confirm 改为「可到回收站恢复」。

### 文件: `src-tauri/Cargo.toml`

- **改动**: `tauri` 依赖启用 `tray-icon` feature。

### 文件: `src-tauri/src/lib.rs`

- **改动**: 新建托盘。`setup` 中构建 `TrayIconBuilder`（图标取 `default_window_icon`）：托盘菜单「显示主窗口 / 退出轻记」、左键单击显示并聚焦窗口。`on_window_event` 拦截 `CloseRequested` → `prevent_close()` + `window.hide()`，关闭窗口驻留托盘，仅经托盘「退出」结束进程。

### 文件: `src-tauri/tauri.conf.json`

- **改动**: 窗口显式 `label: "main"`（托盘按 label 定位）。

### 文件: `CLAUDE.md`

- **改动**: payload 增加 `trash`、vault 版本 v3、状态变量（trash/viewingTrash/viewingTrashNote）、回收站 CRUD 与自动清理、注意事项 #2「仅桌面可用」、新增 #9 托盘驻留说明。

### 验证

- 前端 `node --check` 语法通过；grep 确认无 `clearAllNotes`/`clearNotesBtn` 残留。
- 22/22 逻辑测试通过。
- `cargo build` 编译通过（修正 `MouseButton`/`MouseButtonState` 导入为 `tauri::tray`）。
- 重启桌面应用（PID 26752），`localhost:1420` 服务正常。

---

## 2026-08-14 — 笔记查看 / 编辑模式切换

### 文件: `notes.html`

- **改动 1 — 查看模式为默认**: 点笔记叶子不再直接进入编辑，而是 `viewNote(id)` 只读查看（标题 + textarea 均 `readonly`，展示 Markdown 渲染预览）。按钮组切换为「✏️ 编辑」+「↩ 关闭」。
- **改动 2 — 编辑模式**: 点「✏️ 编辑」→ `startEdit()` 解除只读、聚焦正文，按钮变「💾 保存」+「↩ 取消」；叶子 hover 的 ✎ 仍是直接进入编辑的快捷入口。
- **改动 3 — 四态按钮管理**: 新增 `setEditorButtons(mode)` 统一控制 new / view / edit / trash 四种模式的按钮可见性与文案，替换原先散落的 `style.display` 手动切换（含回收站 `viewTrashNote`）。
- **改动 4 — 取消/保存语义**: 新增 `cancelEditing()` —— 编辑已有笔记时取消回到其查看模式（放弃修改），新笔记取消则清空；`saveNote()` 保存后**保持在编辑模式**便于连续书写（按钮短暂显示「✓ 已保存」），不再清空编辑器。
- **改动 5 — 状态**: 新增 `viewingId`（查看模式笔记 id，与 `editingId` 互斥）；树叶子高亮条件覆盖查看/编辑两种激活态；锁屏/解锁时复位。
- **新增按钮**: `#editModeBtn`、`#closeViewBtn`（视图模式用）。

### 文件: `CLAUDE.md`

- **改动**: 状态变量表补 `viewingId`；合并树交互与笔记 CRUD 章节补充查看/编辑四态切换说明。

### 验证

- 前端 `node --check` 语法通过；关键函数（viewNote/cancelEditing/setEditorButtons）齐备。
- 22/22 逻辑测试通过。
- 重启桌面应用（PID 2436），`localhost:1420` 服务正常。

---

## 2026-08-14 — 查看模式改为纯预览界面

### 文件: `notes.html`

- **改动**: `viewNote()` 查看模式不再显示标题输入 + 只读源码两栏，改为**仅渲染预览界面**——给 `#editorPanel` 加 `.view-mode` 类：CSS 隐藏 `.editor-input`（标题 + textarea），`.editor-preview` 顶满整栏（去左边框/内边距）；标题以 `h1.note-view-title` 渲染在预览顶部（先 `escapeHtml`，XSS 安全），正文为 Markdown 渲染，空内容显示「✍️ 无内容」占位。
- **类管理**: `cancelEdit()`（新笔记模式）、`startEdit()`（编辑模式）、`viewTrashNote()`（回收站模式，保留源码+预览两栏）均移除 `.view-mode`。
- **新增**: `editorPanel` DOM 引用。

### 文件: `CLAUDE.md`

- **改动**: 查看模式描述更新为「仅显示渲染预览，标题渲染为 H1」。

### 验证

- 前端 `node --check` 语法通过；`view-mode` 类引用（2 条 CSS + 4 处 JS 切换）齐备。
- 重启桌面应用（PID 26464），`localhost:1420` 服务正常。

---

## 2026-08-19 — 新增开发一键启动/停止脚本

### 文件: `dev-start.bat`

- **改动**: 新建。一键启动开发实例：`cd` 到项目根目录 → 检查端口 1420 是否被占用（占用则警告并延时 5 秒仍继续）→ 执行 `npm run dev`（拉起 `npx serve -l 1420 .` 前端服务 + Tauri 桌面窗口）。退出后 `pause` 保持窗口显示。

### 文件: `dev-stop.bat`

- **改动**: 新建。一键停止开发实例：① netstat 查 1420 端口监听 PID → `for /f "usebackq tokens=5"` 提取 → `taskkill /F /PID` 终止前端服务（按端口精确匹配，不误杀其他 node 进程）；② `taskkill /F /IM light-notes.exe`（dev 二进制）与 `轻记.exe`（发布版）终止桌面应用。

### 说明

- 两脚本均为 **GBK(CP936) 编码 + CRLF 换行**——cmd 以 OEM 代码页读取 bat，UTF-8 或 LF 换行会导致含中文的行解析错位（实测报 `xxx is not recognized`）。
- 零管道实现（netstat 重定向临时文件 → findstr 正则过滤 → for /f 读文件），规避 cmd 管道与引号二次解析的兼容性问题；`usebackq` 使引号路径按文件名解析并兼容含空格路径。
- 验证：空跑无报错；1420 被占用时正确提取 PID（2260）并执行 taskkill（本沙箱跨 job 保护会拦截终止效果，真实桌面无此限制）；端口占用检测 OCCUPIED/FREE 两分支均正确。

---

## 2026-09-03 14:50 — 整体配色改为黑白（monochrome）

### 文件: `notes.html`

- **改动 1 — 去除全部彩色，改为黑白灰体系（白底黑字方向）**: 靛蓝主色系（`#4f46e5`/`#4338ca`/`#818cf8`/`#e0e7ff`/`#eef2ff` 及 `rgba(79,70,229,…)` 各种透明度）→ 黑色系（主色/文字 `#111111`、hover `#333333`、聚焦边框 `#111111`、浅灰选中/悬停底 `rgba(0,0,0,…)`、行内输入边框 `#b3b3b3`）；红色警示系（`#fee2e2`/`#991b1b`/`#b91c1c`/`#fecaca`）→ 纯黑白灰（警示块浅灰底 `#f1f1f1` + 近黑字 `#111111` + 灰边框 `#d9d9d9`）；slate 蓝灰文字/边框全量映射为等亮度中性灰阶（正文 `#262626`、次要 `#404040`/`#525252`/`#6b6b6b`、弱化 `#9b9b9b`、占位 `#c0c0c0`、边框 `#d8d8d8`/`#dedede`/`#cccccc` 等）；背景 `#eef0f4` → `#f0f0f0`；代码块深底 `#0f172a` → `#1e1e1e`、行内 code 底/字 → `#ebebeb`/`#2b2b2b`。
- **改动 2 — 黑白下补足语义区分**: 链接 `.md-preview a` 由「靛蓝无下划线」改为「黑字常驻下划线」；删除按钮 hover 反白（`#1a1a1a` 底白字）；Markdown 引用左边框与引号底改为中性灰；checkbox `accent-color` → `#111111`；弹层遮罩 → `rgba(0,0,0,0.5)`。
- **改动 3 — JS 内联错误边框同步去色**: `flashPinError()` 边框闪红 `#f87171` → `#a3a3a3`（回退色随 CSS 默认改 `#d8d8d8`）；`saveNote()` 空内容标题报错边框 `#fca5a5` → `#a3a3a3`。

### 文件: `CLAUDE.md`

- **改动**: UI 设计模式「配色」条目更新为黑白灰 monochrome 体系；锁屏模块「PIN 错误」描述改为黑白灰高对比提示。

### 验证

- grep 复核 `notes.html`：所有 hex/rgba 均为中性灰/白/黑，无靛蓝/红色残留。
- 玻璃效果、圆角、布局未动；功能逻辑零改动（纯视觉）。

---

## 2026-09-03 14:57 — 打通 exe 安装包打包（NSIS）

### 文件: `scripts/prepare-dist.mjs`（新建）

- **改动**: 打包前脚本：把单文件前端 `notes.html` 复制到 `dist/notes.html`。

### 文件: `src-tauri/tauri.conf.json`

- **改动 1 — `frontendDist` `"../"` → `"../dist"`**: 原来指向项目根目录，release 打包会把 `node_modules`、`src-tauri/target` 全部内嵌进 exe（体积巨大、编译慢）；现在只内嵌 `dist/`（单文件）。
- **改动 2 — `beforeBuildCommand` 空 → `"node scripts/prepare-dist.mjs"`**: `tauri build` 前自动生成 `dist/`。
- **改动 3 — `bundle.targets` `"all"` → `["nsis"]`**: Windows 下只产出单文件 exe 安装包（不再同时出 msi）。
- **改动 4 — 新增 `bundle.windows.nsis.languages`**: `["SimpChinese", "English"]`，安装向导含简体中文。

### 文件: `.gitignore`

- **改动**: 新增忽略 `dist/`。

### 文件: `CLAUDE.md`

- **改动**: 开发注意事项新增第 10 条「打包（exe 安装包）」：命令、dist 机制、产物路径。

### 打包命令（用户侧执行）

```
npm run build        # = npx tauri build
```

- 首次打包自动下载 NSIS 工具链（需联网）。
- 产物：`src-tauri/target/release/bundle/nsis/轻记_1.0.0_x64-setup.exe`。
- 另可 `npm run tauri build -- --bundles msi` 临时追加 MSI。

---

## 2026-09-03 14:59 — 一键打包脚本 package.bat

### 文件: `package.bat`（新建）

- **改动**: 一键打包脚本（GBK/CP936 编码 + CRLF 换行，与 dev-start.bat/dev-stop.bat 同约定，中文环境 cmd 下显示正常）。流程：`cd` 到项目根 → 检查 node → 检查 `notes.html` → `node_modules` 缺失时自动 `npm install` → 菜单选择打包模式（1=仅 NSIS 单文件 exe 默认 / 2=NSIS+MSI）→ `call npm run build`（或 `npm run tauri -- build --bundles nsis msi`）→ 成功后在 `nsis` 目录定位 `*.exe` 并 `explorer /select` 打开所在目录 → 失败给出常见原因提示。全程 `pause` 保持窗口。

### 文件: `CLAUDE.md`

- **改动**: 开发注意事项第 10 条补充一键脚本 `package.bat` 用法。

### 验证

- 以 OEM 码页读回中文正常；CRLF 换行确认（79 处 CR）；JSON/脚本结构无误。

---

## 2026-09-03 15:07 — 顶部 TAB 页布局 + JSON 浏览器 TAB（加密保存历史）

### 文件: `notes.html`

- **改动 1 — 顶部改为 TAB 页布局**: 解锁后主面板顶部由「标题+徽标」改为 TAB 栏 `#appTabs`（`switchTab()` 切换）：「📒 笔记」页 `#pageNotes`（原合并树+编辑器，整块包入 `.tab-page`）+「🧾 JSON 浏览器」页 `#pageJson`；右侧常驻「修改PIN/锁定」按钮；TAB 徽标显示笔记总数 / JSON 历史条数；`.panel-title` 相关死样式删除。
- **改动 2 — JSON 浏览器 TAB**: 上：textarea 粘贴 JSON →「✨ 格式化并保存」/ Ctrl+Enter → `JSON.parse` 校验 + `JSON.stringify(obj,null,2)` 格式化输出（`textContent` 渲染防 XSS，报错黑白灰提示且不保存）；下：左「🕘 JSON 历史」列表（时间+单行摘要，点条目回填输入并重新格式化、当前项高亮、✕ 删除需确认）+ 右格式化结果（含字符/行数信息 +「📋 复制」，clipboard 失败回退 execCommand）。
- **改动 3 — 历史自动加密保存**: payload 新增 `jsonHistory` 数组（条目 `{id,ts,raw}` 存粘贴原文，前插，`MAX_JSON_HISTORY`=100 上限）；`buildVault/persistData` 全量重加密时携带；旧 vault 无字段按 `[]` 兼容；锁定清内存态、解锁默认回「笔记」TAB。
- **改动 4 — 顺带修复潜在缺陷**: 改 PIN 从解锁态重加密时 payload 原来只含 `{notes,groups}`，会把内存中回收站丢库；现补 `trash` 与 `jsonHistory`，重载同样补齐（`submitChangePin`）。

### 文件: `CLAUDE.md`

- **改动**: 架构（TAB 布局/DOM 结构）、payload 增加 `jsonHistory`、状态变量表增 3 行、核心功能新增「JSON 浏览器」小节。

### 验证

- 抽取 `<script>` `node --check` 语法通过；`<div>` 53/53 配平；新 id 唯一（12 项逐一核对）；关键函数无重复定义。

---

## 2026-09-03 15:16 — package.bat 支持 GitHub 镜像下载 NSIS/WiX 工具链

### 背景

- 国内网络直连 `github.com` 下载 NSIS 失败（`nsis-3.11.zip` 等）。tauri CLI（已装 2.11.4，经二进制扫描确认）原生支持环境变量 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR`（前缀式：把完整 github URL 拼在镜像域名后）与 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE`（模板式 `<owner>/<repo>/releases/download/<version>/<asset>`）。
- 镜像实测连通（本机 Node 探测 NSIS zip HTTP 206）：`gh-proxy.com`（最快）/ `ghfast.top` / `ghproxy.net` / `gh.ddlc.top` / `ghps.cc`。
- 工具链缓存目录：`%LOCALAPPDATA%\tauri\NSIS`（`makensis.exe` + `Plugins\x86-unicode\additional\nsis_tauri_utils.dll`，含 SHA1 校验；缓存成功后不再联网）。

### 文件: `package.bat`

- **改动**: 打包前新增检测——若 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR` 未设置且 `%LOCALAPPDATA%\tauri\NSIS\makensis.exe` 不存在，则询问「是否使用镜像 https://gh-proxy.com 下载工具链 (Y/N)」，输入 Y 即为本次构建设置镜像环境变量；`:fail` 提示补充两种镜像用法与缓存路径说明（GBK+CRLF 保持）。

### 文件: `CLAUDE.md`

- **改动**: 开发注意事项第 10 条补充国内镜像下载方案（环境变量两种形式、可用镜像、缓存目录）。

### 用户操作

- 重跑 `package.bat`，按提示输入 Y；或手动 `set TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://gh-proxy.com` 后执行。

---

## 2026-09-03 15:46 — v1.1.0 四项功能（Markdown 工具栏 / 设置页+开机启动 / 更新安装包 / 笔记搜索）

### 文件: `notes.html`

- **改动 1 — Markdown 工具栏**: `.editor-input` 标题输入框下方新增 `#mdToolbar`（H1/H2/H3、加粗 B、斜体 I、行内代码、代码块、链接、引用、无序/有序列表、待办、分隔线）。按钮经事件委托调用 `applyMdCommand(cmd)`；纯文本变换函数（`taLineInfo`/`applyLinePrefix`/`applyWrap`/`applyLink`/`applyFence`/`applyHr`）返回「新文本 + 新选区」，`commitMdEdit()` 用原生 `document.execCommand('insertText')` 提交（保持 Ctrl+Z 撤销，失败回退直接赋值），提交后派发 input 事件驱动 150ms 防抖预览。行首前缀命令（标题/引用/列表/待办）支持「同前缀已存在则取消 / 标题换级 / 多行整块添加」；无选区点加粗/斜体/代码插入占位符并自动选中便于直接输入。`setEditorButtons(mode)` 在回收站只读视图（trash）给工具栏加 `.off`（半透明禁点）；查看模式由 `.view-mode` 隐藏整列编辑区。新增 CSS：`.md-toolbar`/`.md-tb-btn`/`.md-tb-sep`（黑白灰风格）。
- **改动 2 — 设置 TAB + 修改 PIN 移入 + 开机启动开关**: 顶部 TAB 新增「⚙️ 设置」（`#pageSettings`，`switchTab` 增加分支，进入时 `refreshAutostart()` 同步真实状态）；「安全」区承载原「🔑 修改 PIN」弹层入口（`#settingsChangePinBtn` → `openChangePin`）；删除锁屏 `#changePinBtn` 与主面板 `#changePinBtn2` 两个旧入口及相关 JS 引用/init 禁用行。「通用」区新增「开机自动启动」拨动开关（`#autostartToggle` 黑白 switch）：前端经 `window.__TAURI_INTERNALS__.invoke('autostart_status' / 'autostart_set', { enabled })` 与后端命令交互，失败在 `#settingsErr` 显示原因。新增 CSS：`.settings-wrap`/`.settings-card`/`.setting-row`/`.switch` 等。
- **改动 3 — 笔记搜索**: 侧栏头部下新增搜索框（`#noteSearch` + ✕ `#searchClearBtn`）。`searchQuery` 非空时 `renderGroupTree()` 改走 `renderSearchResults()`：标题+正文大小写不敏感子串匹配，时间降序扁平结果列表（复用树事件委托：点结果=查看、✎/↔/✕ 同叶子），每条含分组路径+时间 meta 与命中片段（`highlightMatch` 先转义再把命中段包 `<mark>`，XSS 安全）；无结果显示「未找到…」；底部计数在搜索时显示「找到 N 条结果」（`#footSuffix`）。Esc 或 ✕ 清空恢复分组树。新增 CSS：`.search-box`/`.search-input`/`.search-hit`/`.search-meta` 等；折叠侧栏时隐藏搜索框。
- **数据层/加密体系/分组树等原有逻辑零改动**（不改 payload 结构、不改 vault 版本），升级覆盖安装不破坏本地数据。

### 文件: `src-tauri/src/lib.rs`

- **改动 1 — 开机启动自定义命令**: 新增 `#[tauri::command] autostart_status() -> bool`（`reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v 轻记`）与 `autostart_set(enabled: bool)`（`reg add/delete` 同键）。启用时写入 `"<exe路径>" --autostart`；值名固定为「轻记」与 NSIS 卸载清理（`DeleteRegValue ... Run 轻记`）保持一致。经 `.invoke_handler(tauri::generate_handler![...])` 注册（自定义命令无需 capability 白名单）。
- **改动 2 — `--autostart` 隐藏主窗口**: `setup` 中检测启动参数含 `--autostart` 时 `window.hide()`，应用后台驻留托盘；点击托盘图标/菜单「显示主窗口」后弹出锁屏输 PIN。关闭按钮驻留托盘逻辑不变。

### 文件: `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `package.json` / `package-lock.json`

- **改动**: 版本号 1.0.0 → 1.1.0（五处同步），作为首版「可覆盖升级的更新安装包」。`package.json` 新增脚本 `"bump": "node scripts/bump-version.mjs"`。

### 文件: `scripts/bump-version.mjs`（新建）

- **改动**: 发布新版本号的一键脚本：`node scripts/bump-version.mjs [major|minor|patch]`（默认 patch）。以 `tauri.conf.json` version 为事实来源，同步改写 package.json / package-lock.json（根+`packages[""]`）/ tauri.conf.json / Cargo.toml / Cargo.lock 五处。输出提示下一步运行 `package.bat`。

### 更新安装包（覆盖升级）机制说明（v1.1.0 起）

- 产物：`src-tauri/target/release/bundle/nsis/轻记_1.1.0_x64-setup.exe`；在装有旧版（1.0.0）的机器上双击即进入**升级模式**：先结束正在运行的旧程序（GUI 下询问「关闭并继续」），不卸载重装、不动 `%LOCALAPPDATA%\com.lightnotes.app`（WebView2 配置目录 = 笔记 localStorage 所在地）等任何数据，仅替换安装目录文件；用户手动卸载时默认不勾选「删除应用数据」也不会删笔记。
- 每次新功能发布：先 `npm run bump -- minor`（或 patch）再运行 `package.bat`，即产出下一版更新安装包。
- NSIS 卸载器仅在「非更新模式」下手动卸载时删除 `HKCU Run` 下的开机启动值（值名 轻记），故升级不会弄丢开机启动设置。

### 文件: `CLAUDE.md`

- **改动**: 同步更新架构/功能/注意事项（工具栏、设置 TAB、开机启动命令、搜索、版本流程）。

---

## 2026-09-10 08:55 — Markdown 目录导入（选择文件夹 → 自动导入所有 .md → 归入「导入」分组）

### 背景

需求：选择指定目录，自动导入目录下所有 `.md` 文件，并归入「导入」分组。实现走**零依赖**路线（复用 WebView2 自带 Chromium 的 `<input webkitdirectory>` 系统「选择文件夹」对话框 + `FileReader` 读内容）：不新增 Cargo / npm 依赖，不改 Rust，不改 capability 白名单。

### 文件: `notes.html`

- **改动 1 — 入口与弹层**: 笔记 TAB 侧栏**搜索框下方**新增整宽按钮「📥 导入 Markdown」（`#importMdBtn` + `.import-btn`；侧栏头部仅 ~212px 宽且已被「＋ 新建」与折叠箭头占满，故不与头部争位；侧栏折叠时隐藏）；设置页新增「数据」区卡片「📥 选择文件夹」（`#settingsImportBtn`，错误提示 `#importErr`）。两者都调用 `startMdImport()`。新增隐藏文件输入 `#mdImportInput`（`webkitdirectory directory multiple`）与导入结果弹层 `#importModal`（来源文件夹 `#importSrc` + 明细 `#importReport` + 「确定」）。新增 CSS `.import-src` / `.import-report` / `.imp-main` / `.imp-dim` / `.imp-warn` / `.import-btn`（黑白灰风格）。
- **改动 2 — 导入逻辑（新增「Markdown 目录导入」代码段）**: `importMdFromFiles()` 读取所选文件 → 过滤 `.md`/`.markdown`/`.mdown`/`.mkd`（大小写不敏感，含子文件夹，按相对路径排序）→ `decodeMdBytes()` 解码（UTF-8 BOM / UTF-16LE / UTF-16BE BOM 优先，严格 UTF-8 失败回退 `TextDecoder('gbk')`，兼容中文 Windows 的 GBK 文件）→ 文件名（去扩展名、压空白、截断 60 字）作标题、文件内容作正文 → `ensureImportGroup()` 复用/新建**顶级「导入」分组**（`IMPORT_GROUP_NAME`）→ 一次 `persistData()` 加密落库。同分组内「标题+内容」完全相同的笔记视为已导入并**跳过**（重复导入同一文件夹不产生副本）；`timestamp` 递减使树中顺序与文件夹一致。导入后退出搜索模式、切回「笔记」TAB、展开并选中「导入」分组（正在编辑时不打断编辑）。
- **改动 3 — 上限与失败处理**: 单次上限 `MAX_IMPORT_FILES`=2000 个文件 / `MAX_IMPORT_BYTES`=20MB（超出即停止并提示）；`persistData()` 抛错（如 `QuotaExceededError`）或导入途中被锁定 → **回滚**本次新增笔记与新建的空分组，结果弹层给出原因；`importing` 标志防重入，导入期间按钮禁用并显示「导入中…」。`DIR_PICK_SUPPORTED` 运行时探测，环境不支持 `webkitdirectory` 时退化为多选 `.md` 文件（`accept=".md,.markdown,…"`）。结果弹层内所有路径均经 `escapeHtml` 后再拼装（沿用 XSS 管线）。
- **改动 4 — 顺带修复 `persistData()` 顺序缺陷**: 原实现先更新内存 `vault`、再 `localStorage.setItem`；写入失败时内存 `vault` 已含未落库数据，调用方就算回滚内存数组，下次解锁仍会从内存 vault 解出「被回滚的数据」。现改为**先 `setItem` 成功、再更新 `vault`**（`setItem` 抛错时内存 vault 不变）。该缺陷由本次导入的「存储超限回滚」路径实测暴露（见下）。
- **数据层兼容性**: vault 版本、payload 结构、`groupId` 语义均未改动，导入只是写入普通笔记；`lockApp()` 额外关闭导入弹层并复位 `importing`。升级/覆盖安装不破坏本地数据。

### 文件: `CLAUDE.md`

- **改动**: 同步架构树（侧栏入口 / 隐藏输入 / 结果弹层）、状态变量 `importing`、加密体系「保存」说明、核心功能新增「Markdown 目录导入（📥 导入）」小节、开发注意事项 8（持久化先写后置内存）与新增 13（零依赖选文件夹实现与取舍）。

### 验证方式

- 本机无法启动 GUI（DSH 沙箱禁止 spawn `rustc`，crates.io 因 schannel 不可达），故用 Node「最小 DOM stub + 真 WebCrypto」加载 `notes.html` 做端到端冒烟：**35 项断言全通过**——含 GBK / UTF-16 BOM 解码、标题取文件名、自动建「导入」分组、非 Markdown 文件忽略、重复导入跳过、锁定/解锁后数据一致、存储超限回滚后内存与密文一致、结果弹层文案。测试脚本为临时脚本，未纳入仓库。
- **待人工确认**: WebView2 中点击「📥 导入」是否正常弹出系统「选择文件夹」对话框（沙箱内无法点击验证）。若个别环境不弹，退化选项是改用 `tauri-plugin-dialog` + Rust 侧 `std::fs` 扫描（需联网拉取依赖）。

### ⚠️ 需知悉：`src-tauri/Cargo.lock` 被 cargo 改写（与本次功能无关）

- 调查原生文件夹对话框方案时，曾在 `src-tauri/Cargo.toml` 临时加入 `tauri-plugin-dialog` / `encoding_rs` 并运行了一次 `cargo fetch --offline`。该环境**无网络**（schannel 不可用，`cargo update` 报 `SEC_E_NO_CREDENTIALS`）且 DSH 沙箱不允许写入 `~/.cargo/registry/src`，命令报错退出；但 cargo **在下载/解包前已重写了 `Cargo.lock`**：它按「本地缓存中实际可用的版本」重新解析，导致约 25 个**传递依赖被降级**（js-sys / web-sys 0.3.104→0.3.81、wasm-bindgen 0.2.127→0.2.104、hyper 1.11.0→1.7.0、reqwest 0.13.4→0.13.1、futures-* 0.3.34→0.3.31、http-body(-util)、hyper-util、slab、tower、tokio-util、bumpalo、bytemuck、ipnet、pkg-config、rustversion、wasm-bindgen-* 等），并新增 dialog 相关 118 条条目；随后为还原依赖又跑了 `cargo check --offline`，它把多余额外条目剪除，现 lock 为 4489 行。
- `Cargo.toml` 已还原为原样（仅 tauri / serde / serde_json 三项），Rust 源码、capability、`tauri.conf.json` 均**未改动**；lock 内部自洽、可解析，且因改为本地缓存中已有的版本，离线构建反而更容易命中缓存。
- **恢复原样的办法（需联网）**: 在 `src-tauri/` 执行 `cargo update`（把全部依赖更新到最新兼容版本），或对上述每个包执行 `cargo update -p <包名> --precise <原版本>`（例如 `cargo update -p js-sys --precise 0.3.104`）。本机当前无网络，故未执行。

---

## 2026-09-10 08:59 — 笔记移动（分组选择器）+ 分组层级调整（子分组可重组）

### 背景

需求：笔记可移动到指定分组下，且分组支持子分组。此前已有「笔记叶子 hover 显示 ↔ → 扁平列表选分组」与「分组行 ＋ 新建子分组」，但存在三个缺口：(1) 移动目标只列扁平文字（`工作 / 会议`），子分组层级不直观；(2) 右侧查看/编辑笔记时**没有**移动入口（必须在左侧树上 hover 才出现小图标）；(3) 分组只能"创建"子分组，**无法**把已存在的分组改挂到别的分组下（无法重组层级）。

### 文件: `notes.html`

- **改动 1 — 分组选择器（替换原扁平移动菜单）**: `#moveMenu` 改为结构化浮层：`#moveHead`（标题，显示被移动对象名称）+ `#moveList`（目标列表，可滚动）+ `#moveNewInput`（「＋ 新建分组并移入…」，回车即建组并移入）。`buildMoveTargets(mode, id)` 按 `buildChildrenMap()` 递归生成目标项，带 `depth`（每级缩进 14px）与 `count`（该组直接笔记数）；`openMoveMenu(btn, mode, id)` 渲染列表（当前所在分组标 ✓、`title` 提示完整路径 `groupPathLabel`、黑白灰风格），并把菜单夹在视口内（下方空间不足则翻到按钮上方），`_anchor` 记录触发按钮用于外部点击关闭；`closeMoveMenu()` 统一关闭（`lockApp()` 也会调用）。新增 CSS：`.move-head` / `.move-list` / `.mo-label` / `.mo-count` / `.mo-cur` / `.move-opt.cur` / `.move-new-input`。
- **改动 2 — 笔记移动入口补齐**: 右侧编辑器动作栏新增「📁 移动」（`#moveNoteBtn`），`setEditorButtons()` 在 `view` / `edit` 模式显示（回收站与新建模式隐藏），点击后以当前打开/编辑的笔记为对象打开选择器；树叶子 ↔ 与搜索结果 ↔ 继续可用（`openMoveMenu(actBtn, 'note', id)`）。`moveItemToGroup('note', id, gid)`：改 `groupId`（null = 未分组）、编辑中的笔记同步 `currentGroupId`、落库后自动展开目标分组（未分组时展开 `UNGROUPED_KEY`）。
- **改动 3 — 分组层级调整（新增能力）**: 分组行 hover 新增「↔ 移动到其他分组」（`data-act="moveto"`）→ 选择器 `mode='group'`：含「📂 顶层（根目录）」，并**排除自身与全部子孙**（`collectDescendantIds`，防环）。`moveItemToGroup('group', id, gid)`：改 `parentId`、在新父级下按末尾 `order` 追加、展开新父级、落库；自身/子孙/同父级一律 no-op。
- **改动 4 — 分组创建重构**: 抽出 `addGroup(parentId, name)`（只建对象、入数组、返回，不选中不落库），`createGroup()`（树内新建：建 + 选中 + 落库）与 `ensureImportGroup()`（Markdown 导入用）改为复用它，避免三处重复的 order 计算与 id 生成。
- **数据层兼容性**: 未改动 vault 版本与 payload 结构——「移动」只是改 `note.groupId` / `group.parentId` 后走原有 `persistData()` 加密落库，向后兼容且不需要迁移。

### 文件: `CLAUDE.md`

- **改动**: 同步架构树（`#moveMenu` 结构）、「分组与笔记合并树」小节（叶子/分组行 hover 操作、分组选择器与 `moveItemToGroup` 行为、编辑器「📁 移动」按钮）。

### 验证方式

- 扩充离线冒烟脚本（Node 最小 DOM stub + 真 WebCrypto 加载 `notes.html`）：新增 28 项断言，**共 63 项全部通过**——多级子分组创建与 `parentId`/`getDepth`/`groupPathLabel`、分组行渲染出 `moveto` 按钮、选择器缩进与 ✓ 与笔记数、笔记移入三级子分组后**锁定/解锁仍保持归属**（已落库）、移回未分组、分组移入他组并在新父级末尾排序、拒绝移入自身/子孙（防环）、分组移回顶层、编辑器「📁 移动」在 view/edit 显示而 trash 隐藏。测试脚本为临时脚本，未纳入仓库。
- **待人工确认**: 选择器浮层的实际观感（缩进、遮挡、按钮位置）需在应用里点一次确认（沙箱内无法启动 GUI）。

---

## 2026-09-10 09:10 — Markdown 渲染器重写 + 编辑器工具栏扩充

### 背景

用户反馈「Markdown 导入后渲染异常」。先用探针脚本把一份典型 Markdown 跑过旧渲染器，复现出 10 类真实缺陷（旧实现是「逐行状态机 + 正则替换」）：

| 输入 | 旧输出 | 问题 |
|---|---|---|
| 多行同段落（软换行） | 每行一个 `<p>` | 段落被拆散，段间距异常 |
| GFM 表格 | `<p>\| a \| b \|</p>` 逐行 | **表格完全不支持**（最明显的「渲染异常」） |
| `![alt](url)` | `!<a href>alt</a>` | 图片渲染成「感叹号 + 链接」 |
| `- item` + 缩进续行 | 列表断成 `<p>` | 列表结构被破坏 |
| `~~删除线~~` | 原样文本 | 不支持 |
| `[t](url "title")` | 原样文本 | 带标题的链接整段不解析 |
| `标题\n====` / `----` | `<p>` / `<hr>` | Setext 标题不支持且误判分隔线 |
| `\*不是斜体\*` | `\<em>不是斜体\</em>` | 转义被破坏且反斜杠残留 |
| ```` ```` ```` 围栏 | 内部 ``` 提前闭合 | 代码块碎裂 |
| 4 空格缩进代码块、`> >` 嵌套引用、`1)` 列表、`<https://…>` | 不支持 | — |

`extractPlainText` 同样把表格行原样带进列表卡片摘要（`| a | b | | - | - |`）。

### 文件: `notes.html`

- **改动 1 — 块级解析重写**：删掉旧的逐行状态机（`mdBlock`），改为 `mdToHtml` → `mdBlocks(lines, depth)` 单遍扫描 + `mdParseList(lines, start, depth)`（列表项聚合，同级同类成项、更深缩进作「续行」并入项内，项内容经 `mdInnerBlocks` 递归解析 → 天然支持多层嵌套/项内多段/代码块）。新增支持：GFM 表格（`:--`/`--:`/`:-:` 对齐、`\|` 转义、缺列补空，`mdTableRow`/`mdIsTableSep`/`mdTableAligns`/`mdRenderTable`）、Setext 标题（并处理与 `---` 分隔线的歧义：段落之后按 Setext，否则按分隔线；表格判定额外要求分隔行含 `|`，避免 `a | b\n---` 误判）、围栏代码（```/`~~~`、开合同字符、闭合长度 ≥ 开始、可带语言）、缩进代码块（4 空格/Tab）、引用内部递归按块解析（支持 `> >` 与引用内列表/代码块）、有序列表 `1)`、松散列表、任意层级嵌套、任务列表（含仅有 `- [x]` 无文字）。新增 `MD_MAX_DEPTH`(16) 递归上限，超深异常输入退化为段落。
- **改动 2 — 软换行策略**：同一段落内的换行由「每行一个 `<p>`」改为合并成一个 `<p>` 并以 `<br>` 连接（行尾两空格同理），只有空行才分段。这是**刻意偏离 CommonMark**（不把软换行折叠成空格），以符合「回车即换行」的编辑直觉，同时修掉导入文件中硬折行文本的段间距异常。
- **改动 3 — 行内解析重写（token 占位防串扰）**：先整体 `escapeHtml`，再按「转义 → 行内代码（`` ` ``/``` `` ```，首尾各去一空格）→ 图片 → 链接 → 自动链接 `<url>` → 裸网址 → 强调（`***`/`**`/`__`/`*`/`_`，词内 `_` 不生效）→ 删除线」顺序处理，每步结果用 `\u0001<序号>\u0001` 占位保护、最后统一还原；源文档控制字符先剥离。修掉旧实现的两类问题：转义字符被破坏、URL 里的符号被后续规则改写。
- **改动 4 — 修复「双重转义」**：因为已在入口整体 `escapeHtml`，行内替换的捕获组本身已是实体文本，故去掉链接/图片/自动链接/裸网址处理里的二次 `escapeHtml`（否则 `a=1&b=2` 会变成 `href="…&amp;amp;…"`）。属性值直接拼入即安全（引号已成实体），`safeUrl` 白名单保持（链接 `http/https/mailto`，图片仅 `http/https`，`javascript:` 一律按文本输出）。
- **改动 5 — `extractPlainText` 重写**：剥除围栏/行内代码、标题、Setext/分隔线、引用、列表与任务标记、强调/删除线、转义反斜杠；图片与链接取文字，表格行取单元格文字（不再把 `| --- |` 带进摘要）。供列表卡片标题与搜索片段使用。
- **改动 6 — 工具栏扩充（13 → 16 个按钮）**：新增 **S 删除线**（`strike`，`applyWrap('~~','~~')`）、**🖼️ 图片**（`image`，`applyImage` 插入 `![说明](https://)`，说明取选中文字并选中 URL）、**▦ 表格**（`table`，`applyTable` 插入 2 列骨架并选中首格；当前行非空时在行下另起一块，不覆盖已有文字）；新增 CSS `.md-tb-btn.s`/`.wide`；工具栏已有 `flex-wrap: wrap`，多出按钮自动折行。
- **改动 7 — `applyLinePrefix` 空行修复**：原来对空白行直接 `continue`，导致**空笔记（或空行上）点标题/列表/引用按钮毫无反应**。现选区仅一行且为空时仍插入前缀（且不进入「取消模式」）。
- **改动 8 — 预览样式**：新增 `.md-preview table/th/td`（斑马纹、`width:max-content` + `max-width:100%` + `overflow-x:auto`，窄栏下表格横向滚动而不撑破布局）、`.md-preview img`（`max-width:100%`、圆角）、`.md-preview del`（灰字删除线）。

### 文件: `CLAUDE.md`

- **改动**: 重写「Markdown（零依赖自写解析器）」小节（块级/行内支持清单、token 占位防串扰与「捕获组不得二次转义」规则、软换行策略、递归深度上限、预览样式、工具栏 16 按钮与新命令），并补充「开发注意事项 4（XSS 管线）」的双重转义告警。

### 验证方式

- 新增离线渲染测试脚本（Node 最小 DOM stub + 真实渲染器，共 12 组）：**104 项断言全部通过**——标题（ATX/Setext/闭合#/空标题/缩进）、段落与软换行、强调/代码/删除线/转义、链接与图片（含 `javascript:` 拒绝、`&` 只转义一次）、列表（2/3 层嵌套、续行、松散、任务、项内多段、有序无序相邻）、引用（嵌套/内列表/内代码块/不吞后文）、代码块（三/四反引号、波浪号、语言、缩进、未闭合）、分隔线、GFM 表格（对齐/转义/补空/与 Setext 消歧）、XSS、纯文本摘要、工具栏命令（包裹/占位/选区/表格/前缀切换/取消/代码块）。
- 回归：此前的导入 + 移动测试脚本 63 项**仍全部通过**（无回归）。
- **待人工确认**: 预览区实际观感（表格横向滚动、图片限宽、工具栏折行）需在应用里打开一篇导入笔记确认（沙箱内无法启动 GUI）。

---

## 2026-09-10 09:17 — 设置页元素加宽 + 导入顺序时间戳修复

### 背景

需求：设置页各元素宽度加大。原 `.settings-wrap` 为 `max-width: 560px` 且左对齐，在 960 宽窗口下右侧空出约 350px。

### 文件: `notes.html`

- **改动 1 — 设置页布局加宽**：`.settings-wrap` 由 `max-width: 560px` 改为 `max-width: 1040px` + `margin: 0 auto`（默认 960 窗口下几乎铺满，超宽窗口才收窄居中），卡片间距 14 → 16px。
- **改动 2 — 行内元素加宽**：`.setting-row` 内边距 `13px 18px 16px` → `15px 24px 20px`，列间距 16 → 28px；左列文字块加 `.setting-text`（`flex: 1 1 auto; min-width: 0`，说明文字按可用宽度换行，不再按内容挤在左侧）；右侧控件统一 `.setting-row .btn { min-width: 148px; justify-content: center; flex-shrink: 0 }`（两行按钮等宽对齐）；`.settings-section-title` 字号 12 → 13、内边距 `14px 18px 4px` → `16px 24px 6px`；`.setting-label` 14 → 15px；`.setting-desc` 12 → 12.5px、行高 1.6；`.setting-err` 内边距/外边距同步放大。
- **改动 3 — 开关加大**：`.switch` 46×26 → **56×30**，滑块 20 → 24px，ON 位置 `left: 23px` → `29px`（3 + 24 + 29 = 56）。
- **改动 4 — 窄窗口适配**：新增 `@media (max-width: 620px)`：收窄设置页内边距、列间距，并取消控件 `min-width`，避免说明文字被挤断。
- **改动 5 — 修复导入顺序时间戳（顺带发现）**：Markdown 导入写笔记时原用 `timestamp: Date.now() - added.length`，用的是**实时时钟**——当逐个读取文件跨越毫秒时（大文件夹、慢磁盘），后读到的笔记 timestamp 可能更大，导致「导入后树中顺序与文件夹一致」失效且不稳定。现改为循环前取一次基准 `baseTs`，写 `baseTs - added.length`，严格递减。该缺陷由回归测试偶发暴露（`a=…127 b=…127`）。

### 文件: `CLAUDE.md`

- **改动**: 「设置页（TAB #pageSettings）」新增「布局」条目（满宽 + `.setting-text` / 控件最小宽度 / 开关尺寸 / 620px 适配）。

### 验证方式

- CSS 花括号配平校验通过（234/234）；设置页标记检查：4 个 `.setting-row` + 4 个 `.setting-text` + 开关与两个按钮均就位。
- 回归：渲染测试 **104 项**、导入与移动测试 **63 项**（含新增的「timestamp 严格递减」）全部通过。
- **待人工确认**: 加宽后的实际观感需在应用里打开设置页确认（沙箱内无法启动 GUI）。

---

## 2026-09-10 09:20 — 设置页「关于」只显示应用名称与版本号

### 背景

需求：「关于」中只显示应用名称及版本号（原来还带一行 AES-GCM/localStorage 的说明文字）。

### 文件: `notes.html`

- **改动 1 — 关于卡片内容精简**：`.setting-desc` 由「笔记数据经 Web Crypto AES-GCM 加密后存于本地，仅桌面应用可用」改为版本号行 `#aboutVersion`（文案「版本 x.y.z」），卡片只剩「轻记 (Light Notes)」+ 版本号两项。
- **改动 2 — 版本号改为运行时读取**：新增 `async function refreshAppVersion()`，经 `window.__TAURI_INTERNALS__.invoke('plugin:app|version')` 读取 `tauri.conf.json` 的 version（**唯一事实来源**，`npm run bump` 后自动跟随，`notes.html` 里不维护第二份版本号）；失败/取不到时**隐藏该行**，避免展示过期硬编码版本。已确认当前 capability `core:default` 含 `core:app:default`（`allow-version`），**无需改动 capability**。调用点：`switchTab('settings')` 与 `refreshAutostart()` 一同刷新；新增 DOM 引用 `aboutVersion`。

### 文件: `CLAUDE.md`

- **改动**: 「设置页（TAB #pageSettings）」新增「关于」条目（只显示名称 + 版本号、版本号来源与权限说明、取不到时隐藏、刷新时机）。

### 验证方式

- 回归脚本新增 6 项断言（共 **69 项全部通过**）：`#aboutVersion` 存在、invoke 命令名确实为 `plugin:app|version`、显示「版本 1.1.0」、取到版本时可见、切到设置页会自动刷新、**命令抛错时隐藏该行**。
- 语法检查通过；渲染测试 104 项不受影响（此前已全绿）。
- **待人工确认**: 设置页「关于」实际显示效果（打开设置页看名字与版本号两行即可）。

---

## 2026-09-10 09:31 — 锁屏只保留 PIN 输入框

### 背景

需求：锁定页面除 PIN 输入框外什么都不显示。原锁屏为「🔐 图标 + 笔记已锁定 + 副标题 + 4 格 PIN + 🔓 解锁按钮 + 底部提示」。

### 文件: `notes.html`

- **改动 1 — 移除装饰与冗余元素**：删除 `.lock-icon`、`.lock-title`（笔记已锁定）、`.lock-sub`（输入四位 PIN…）、`.pin-actions` 容器与 `#unlockBtn`（🔓 解锁）、`.lock-footer-hint`（默认 PIN · 0000…）及对应 CSS 规则。锁屏此刻只剩 `#pinGroup`（4 个 `.pin-digit` 输入框，加 `role="group" aria-label="输入四位 PIN 解锁"`）。
- **改动 2 — 解锁路径只留自动解锁 + Enter**：输满第 4 位自动解锁（原有），Enter 键在输入框上兜底（原有）；删除解锁按钮的 click 处理与 `unlockBtn` DOM 引用。
- **改动 3 — 环境异常时的禁用对象改到输入框**：`init()` 中两处 `unlockBtn.disabled = true`（非 Tauri / 无 `crypto.subtle`）改为 `pinInputs.forEach(i => i.disabled = true)`，避免空引用且语义更直接；横幅 `.env-banner` 保留（仅异常环境显示，正常桌面环境不可见）。
- **改动 4 — 错误提示不再挤动输入框**：`.error-msg` 原为 `opacity` 切换（始终占位）→ 在锁屏内改为 `.lock-screen .error-msg` **绝对定位**（`top: calc(50% + 52px)`、水平居中、`margin: 0`），输入框保持严格居中、出错时也不会位移；基础 `.error-msg` 样式不动（修改 PIN 弹层的 `#changePinError` 仍用）。`.lock-screen` 加 `position: relative`，`.pin-group` 去掉 `margin-bottom: 24px`。

### 文件: `CLAUDE.md`

- **改动**: 架构树与「两个视图状态」同步为「只有 4 位 PIN 输入框」；「锁屏模块」小节重写（极简构成、自动解锁/Enter 兜底、错误提示绝对定位、环境异常改为禁用输入框）。

### 验证方式

- 新增锁屏专项脚本（非 Tauri 环境的 window stub，共 **8 项全部通过**）：init 不抛异常、显示环境横幅、**4 个 PIN 框均被 disabled**（原实现是禁用解锁按钮）、不落任何数据、源码中已无 `#unlockBtn`/`lock-title`/`lock-sub`/`lock-icon`/`lock-footer-hint`/`pin-actions`、`pin-group` 内恰好 4 个输入框、`#errorMsg` 保留。
- 回归：导入/移动/关于版本号脚本 **69 项**、Markdown 渲染脚本 **104 项** 全部通过；语法检查通过。
- **待人工确认**: 锁屏实际观感（4 个输入框居中、输错时下方提示不位移）需在应用里看一眼。

---

## 2026-09-10 09:47 — 打包脚本升级（版本号内联升级 + 按版本定位产物）+ 版本号 1.1.0 → 1.2.0

### 背景

需求：更新打包脚本并升级版本号。原 `package.bat` 全程不提版本号，产物靠 `for %%F ... \*.exe` 取「目录里最后一个 exe」——目录里留过旧版安装包时极易定位/发错文件；版本号只能手工先跑 `npm run bump`。

### 文件: `package.bat`（重写，保持 **GBK + CRLF**）

- **改动 1 — 展示并校验版本号**：新增 `:pkg_version` 取 `src-tauri/tauri.conf.json` 的 version，横幅后打印「当前版本: x.y.z」；并调用 `node scripts\bump-version.mjs check` 校验五处版本号是否一致，不一致时打印修复提示（不阻断打包）。
- **改动 2 — 打包前可直接升级版本号**：新增交互选项 `[0] 不升级 / [1] patch → x.y.(z+1) / [2] minor → x.(y+1).0 / [3] major → (x+1).0.0`（默认 0），三个候选版本号由 `bump-version.mjs <级别> --dry-run` 预演得出；选择升级时调用 `bump-version.mjs <级别>` 同步五处后再构建，**保证产物文件名与实际版本号一致**。
- **改动 3 — 产物按版本精确匹配**：由「取目录里最后一个 exe」改为匹配 `*_<当前版本>_x64-setup.exe`；匹配不到时不再猜「最新的那个」（可能发错版本），改为列出目录内 exe 供人工确认；目录里若还有其它版本的安装包，逐个提示并汇总「上面 N 个不是本次版本」。
- **改动 4 — 修掉三个批处理坑**（均经实测）：① 凡调 `node` 一律写成 `call node ...`——本机 `node` 解析到 `.cmd` 包装器，批处理里不加 `call` 会**直接把控制权交出去、脚本静默结束**（原脚本对 npm 已有 `call`，node 是新增同款问题）；② node 调用追加 `<nul`，否则它会把重定向进来的 stdin 消费掉，导致后续 `set /p` 读到空值（实测正是「选了升级却没生效」的原因）；③ 取版本号用「node 输出到临时文件 + `set /p` 读回」而非 `for /f` 管道捕获（受限或包装环境下更稳），并去掉 `for /f ('dir /b /o-d ...')` 这类管道兜底。

### 文件: `scripts/bump-version.mjs`

- **改动**: 新增两种模式——`check`（校验五处版本号是否一致，一致退出码 0、不一致打印逐项差异并退 1）与 `--dry-run`（只把提升后的版本号打印到 stdout、不写任何文件，供 `package.bat` 生成选项文案）；参数解析改为先剥离 `--` 开头的选项；`readVersions()` 统一采集五处（含 `package-lock.json` 的根与 `packages[""]`）并复用于 check。

### 版本号：1.1.0 → 1.2.0（minor）

- 本批改动为功能新增（Markdown 目录导入、笔记/分组移动与子分组重组、Markdown 渲染器重写 + 工具栏扩充、设置页加宽与「关于」精简、锁屏极简化），故按 minor 升级：`node scripts/bump-version.mjs minor` 同步 `tauri.conf.json` / `package.json` / `package-lock.json`（根 + `packages[""]`）/ `Cargo.toml` / `Cargo.lock` 五处，`check` 复核一致。
- 产物名随之变为 `轻记_1.2.0_x64-setup.exe`；`notes.html` 不存版本号（关于页运行时读），无需改动。旧版（1.1.0 及更早）安装包在新版机器上双击仍是覆盖升级、不动本地数据。

### 文件: `CLAUDE.md`

- **改动**: 「开发注意事项 10（打包）」补充脚本流程、按版本精确匹配产物、三个批处理坑与 GBK+CRLF 约束；「11（版本号与发布流程）」改写为 `bump-version.mjs` 的三种用法（提升 / `--dry-run` / `check`）、两种发布方式与「不触发 cargo 解析」的说明。

### 验证方式

- **隔离流程测试**（把工程关键文件复制到临时目录、把 `npm run build`/`explorer` 换成桩、假造 `_1.1.0_`/`_1.2.0_`/`_1.3.0_` 安装包），两次实跑：
  - RUN A（选 0 不升级）：读到「当前版本 1.2.0」→ 三项升级预演显示 `1.2.1 / 1.3.0 / 2.0.0` → 精确命中 `_1.2.0_x64-setup.exe` → 提示另外 2 个非本次版本 → 退出码 0；
  - RUN B（选 2 minor）：真实完成 `1.2.0 → 1.3.0` 五处同步 → 打包版本显示 1.3.0 → 精确命中 `_1.3.0_x64-setup.exe` → 提示另外 2 个非本次版本 → 退出码 0。
- **真实工程冒烟**：`package.bat < nul` 实跑，横幅/版本读取/一致性校验/三个询问的默认值/失败提示与 `pause` 全部正常，直到 `tauri build` 因本机 `cargo metadata` 被沙箱拒绝（os error 5）而走失败分支——构建本身需要 Rust 工具链与网络，本沙箱不可用，非脚本问题。
- `bump-version.mjs`：`patch/minor/major --dry-run` 分别输出 1.1.1 / 1.2.0 / 2.0.0（当时），`check` 在执行 bump 前后分别返回 0；五处版本号逐个人工核对为 1.2.0。
- 清理：测试期间在 `scripts/`、根目录产生的临时 bat 与日志已删除；`package.bat` 复核为 GBK、无 BOM、190 处 CRLF、0 处裸 LF。

---

## 2026-09-10 09:46 — 侧栏可拖宽 + 笔记多选移动/删除

### 背景

需求：① 左侧导航栏（分组树侧栏）支持拖拉调整宽度；② 笔记支持多选后批量移动或删除（此前只能逐条 hover 点 ↔ / ✕）。

### 文件: `notes.html`

- **改动 1 — 侧栏拖宽**：`#groupSidebar` 内新增右缘手柄 `#sidebarResizer`（`cursor: col-resize` + hover 变粗高亮），`.sidebar` 加 `position: relative`。JS：`startSidebarResize()` 在 pointerdown 后监听 window 的 `pointermove/pointerup`（指针移出侧栏也跟手），`clampSidebarWidth()` 限定 **160~560px 且不超过 `窗口宽 - 420`**，拖动期间给 `body` 加 `.resizing`（全局 col-resize 光标、禁选中、临时关掉 `.sidebar` 的 width 过渡以免跟手迟滞）；**双击手柄 `resetSidebarWidth()` 恢复默认 240**。
- **改动 2 — 记忆宽度**：新增独立 localStorage 键 `light_notes_ui`（`{sidebarWidth}`，**非机密不加密**，不进 vault，避免每次启动都要重新拖），`saveUiPrefs()` 在 pointerup 时写、`init()` 里 `loadUiPrefs()` 读；`applySidebarWidth()` 在**折叠态**与 **≤860px 窄窗口**下清掉内联宽度交给 CSS（折叠 48px / 窄窗整宽），`toggleSidebar()` 与窗口恢复时自动还原用户拖出来的宽度；窄窗口下 CSS 隐藏手柄。
- **改动 3 — 多选（Ctrl/⌘ 切换、Shift 连选）**：新增 `selectedNoteIds`(Set) 与 `lastSelNoteId`（Shift 锚点）；`toggleNoteSelection()` / `selectNoteRange()`（按当前树中**可见**叶子的顺序连选，顺序取自 `visibleNoteIds()`）/ `clearSelection()` / `updateSelBar()`（顺带剔除已失效 id）。树的事件委托里：Ctrl/⌘ 点击切换、Shift 点击连选、普通点击先清空选择再打开笔记；选中叶子加 `.multi-sel` 类且图标 📝/🔍 → ☑（搜索结果叶子同样支持）。
- **改动 4 — 多选操作栏**：`#selBar`（搜索框与导入按钮下方，仅在选中 ≥1 条时显示）含「已选 N 条」「✕ 取消」「📁 移动」「🗑️ 删除」；`renderGroupTree()` 末尾调用 `updateSelBar()` 保持计数与显隐同步。
- **改动 5 — 批量移动/删除**：`openMoveMenu()` 扩展出 `mode='notes'`（id 为数组，标题「移动 N 条笔记」，仅当所选笔记同属一个分组时才标 ✓，跨分组用哨兵 `\u0000mixed` 使其都不匹配）；`moveItemToGroup('notes', ids, gid)` 逐条改 `groupId`、全部无变化则直接返回、完成后清空多选；`deleteNotes(ids)` 批量软删除（`trash.push` 逐条、`deletedAt` 递减保持回收站顺序），`deleteNote(id)` 改为其单条包装；叶子上的 ↔ / ✕ 按钮在「该笔记属于多选」时也作用于整个选区（确认文案显示条数）；`lockApp()` 里 `clearSelection()`。

### 文件: `CLAUDE.md`

- **改动**: 架构与「分组与笔记合并树」小节新增「侧栏宽度可拖动」「笔记多选」两条；`#moveMenu` 选择器与 `moveItemToGroup` 说明扩展到 `note`/`notes`/`group` 三种模式；localStorage 键表新增 `light_notes_ui`（并澄清「唯一加密存储」仅指 vault）；状态变量表新增 `sidebarWidth`/`selectedNoteIds`/`lastSelNoteId`。

### 验证方式

- 回归脚本扩到 **97 项全部通过**，其中新增 28 项覆盖本次功能：手柄存在且写在侧栏内、设为 320 生效、下限夹到 160、上限夹到 560、折叠时清内联宽度、展开后恢复用户宽度、宽度写入 `light_notes_ui`、重新加载恢复 300、**UI 偏好不进加密 vault**；可见叶子顺序、Ctrl 切换选中、操作栏显隐与计数、选中叶子 `multi-sel` 与 ☑、再次点击取消、**Shift 连选区间**、三条一起移入分组并**锁定/解锁后归属保持**、批量删除进回收站且不影响未选中笔记、删除后清空多选。
- 另两个套件无回归：锁屏专项 **8 项**、Markdown 渲染 **104 项**；`notes.html` 语法检查通过、CSS 花括号配平 245/245、无重复 id。
- **待人工确认**: 拖动手感与多选观感（手柄 hover 高亮、选中底色、操作栏在 240px 侧栏下的排布）需在应用里试一次。

---

## 2026-09-10 11:07 — 导入去重改为跨分组按标题比对 + 新增「打开单个 md 文件」

### 背景

需求：① 导入时与**所有笔记**的标题比对，跳过「已有但可能被移动到其它分组」的 md 文件（原实现只在「导入」分组内比对「标题+内容」，笔记一旦被移走，再导入同一目录就会产生副本）；② 增加打开**单个 md 文件**的功能，打开的 md 可以保存到指定分组。

### 文件: `notes.html`

- **改动 1 — 去重改为跨分组按标题**：`importMdFromFiles()` 导入前用 `mdTitleKey()`（`trim().toLowerCase()`，Windows 文件名不区分大小写）把**全部有效笔记**（不含回收站）建成 `title → notes[]` 索引，导入过程中新加的笔记也实时入索引（同一批内的重名同样命中）。命中时两种处理：① 其中有一条**内容完全相同** → 计入「已导入过的文件」；② 都没有相同内容（仅标题相同，可能已在别处编辑过）→ **同样跳过**，但在结果里单列「同名文件」并给出已有笔记的**分组路径**。原「同分组内标题+内容」判据已删除。
- **改动 2 — 导入入口参数化（统一核心）**：`importMdFromFiles(fileList, cfg)` 新增 `cfg`：`target = { group, created }`（目标分组，缺省仍为「导入」分组，`created` 用于失败回滚）、`srcLabel`（结果弹层的来源文案）、`dedup === false`（关闭跳过判断）。目录导入与单文件保存共用读取/编码/上限/回滚/结果弹层的全部逻辑。
- **改动 3 — 新增「📄 打开 md 文件」**：侧栏在「📥 导入 Markdown」下方新增整宽按钮 `#openMdBtn`，设置页「数据」区新增「打开单个 md 文件」行（`#settingsOpenMdBtn`），配隐藏输入 `#mdOpenInput`（`accept=".md,.markdown,.mdown,.mkd,text/markdown"`，单文件）。`startMdOpen()` 触发系统文件对话框。
- **改动 4 — 复用分组选择器当「保存到分组」**：`openSaveFilePicker(file)` 把 `#moveMenu` 以 `mode='save'` 打开（标题「保存 <文件名> 到分组」，目标列表 = 未分组 + 全部层级分组 + 「＋ 新建分组并移入」），有同名笔记时在列表上方插入 `.move-warn` 提示行（新增 CSS）；点目标分组 / 回车新建分组 → `savePendingMdTo(gid)` → `importMdFromFiles([file], { target, dedup:false })`（`dedup:false`：用户明确要保存，同名也新增并在结果里提示「已存在同名笔记」）；`pendingMdFile` 暂存待保存文件，保存前后自动关闭选择器。
- **改动 5 — 结果弹层扩充**：`showImportReport()` 支持「跳过已导入过的文件 N 个」「跳过同名文件 N 个（列出标题与已有分组路径）」「ℹ️ 已存在同名笔记」「成功导入 N 条 → 归入「分组名」（不再固定写「导入」）」；`#importSrc` 直接显示 `cfg.srcLabel`（目录「📁 文件夹名」/ 单文件「📄 文件名」）。`setImportBusy()` 同时禁用/复原两个新按钮。
- **数据层兼容性**: 未改 vault 版本与 payload 结构，导入仍是写普通笔记，仅判据与入口变化。

### 文件: `CLAUDE.md`

- **改动**: 「Markdown 目录导入（📥 导入）」小节改写为「Markdown 导入（📥 目录导入 / 📄 打开单个文件）」+ 新增「Markdown 导入实现要点」；架构树补充 `#mdOpenInput` 与两个按钮、`#pageNotes` 侧栏说明；开发注意事项 13 同步（目录导入按标题与全部笔记比对、单文件由用户选组保存）。

### 验证方式

- 回归脚本扩到 **120 项全部通过**（新增 23 项）：跨分组去重（把已导入笔记移到别的分组后再导入 → 仍跳过）、同名不同内容 → 跳过并列出已有分组路径、`mdTitleKey` 去空白+小写、单文件打开弹出 save 模式选择器（标题含文件名、列表含未分组与各层分组、带各组笔记数）、保存到**三级子分组**并**锁定/解锁后仍在**（已落库）、来源显示「📄 文件名」、同名时选择器给提示且仍允许新增、可选「未分组」、结果里提示存在同名笔记、没有待保存文件时不误写数据。
- 另两个套件无回归：锁屏专项 **8 项**、Markdown 渲染 **104 项**；`notes.html` 语法检查通过。
- **待人工确认**: 单文件流程的实际观感（侧栏两个按钮的排布、选择器提示行、结果弹层文案）需在应用里点一次。
---

## 2026-09-10 12:20 — 单文件改为「先打开、保存时选分组」+ 导入/打开二合一 + 侧栏按钮调整

### 背景

需求（4 项 UI/交互调整）：① 打开单个 md 文件时**先打开**，点「保存」时才选择保存到哪个分组（原实现是选完文件立刻弹分组选择器）；② 侧栏「导入」和「打开」两个按钮**二合一**；③ 折叠/展开侧栏的按钮改为**三横线（☰）图标**；④ 「新建分组」按钮移到**分组列表底部**。

### 文件: `notes.html`

- **改动 1 — 打开单个 md 改为「先读入编辑器」**：新增 `openMdInEditor(file)`，选完文件后 `readFileBuffer` + `decodeMdBytes` 解码，直接写进编辑器（标题取文件名、正文取文件内容），此时**不落库**；`cancelEdit()` 清空编辑器并把 `pendingMdName` 复位（状态变量，记录待保存文件名）、`updateMdOpenHint()` 在编辑器底部显示「📄 已打开 xxx.md · 点「保存」选择保存到的分组」（新增 `#mdOpenHint` + `.md-open-hint`，靠左显示）；`setEditorButtons()` 在该状态下把保存按钮文案改为「💾 保存到分组…」并显示取消键（可放弃这个打开的文件）。
- **改动 2 — 保存时才选分组**：`saveNote()` 拆出 `writeNote(gid)`（真正的 upsert 落库）——有待保存文件时 `saveNote()` 改为调用新增的 `openNoteSavePicker()` 弹出 `#moveMenu`（`mode='save'`，标题「把 <文件名> 保存到分组」，**当前分组预标 ✓**，仍有同名笔记时插入 `.move-warn` 提示），选目标分组 / 底部「新建分组并移入」→ 新增的 `saveNoteToGroup(gid)` → 展开并选中目标分组后 `writeNote(gid)` 落库。原 `openSaveFilePicker()` / `savePendingMdTo()` / `pendingMdFile` 已删除（不再走导入管线与结果弹层）。再点一次「保存」= 收起选择器。
- **改动 3 — 不打断用户操作**：`selectGroup()` 在有待保存文件时**不再清空编辑器**（点分组浏览不会丢掉刚打开的文件，保存时该分组默认选中）；反过来 `viewNote()` / `startEdit()` / `viewTrashNote()` 用 `clearPendingMd()` 放弃它，避免普通编辑保存时误弹分组选择器。
- **改动 4 — 导入/打开二合一**：侧栏两个整宽按钮合并为一个「📥 导入 Markdown ▾」（`#importMdBtn`，设置页同理合并为「📥 导入 / 打开」），点击弹出新浮层 `#importMenu`（复用 `.move-menu`/`.move-opt` 样式）二选一：「📁 选择文件夹导入（批量）」→ `startMdImport()`、「📄 打开单个文件（选分组）」→ `startMdOpen()`；新增 `positionMenu()`（浮层贴按钮定位，通用）、`openImportMenu()` / `closeImportMenu()` / `pickImportMode()`，`lockApp()` 一并关闭该浮层；点外部关闭两个浮层的判定改为「点触发它的按钮不算外部」（`btn !== menu._anchor`，原先只认 `.tree-act` / `#moveNoteBtn`）。`#openMdBtn`、`#settingsOpenMdBtn` 及其监听/忙碌态代码已删除。
- **改动 5 — 折叠按钮改三横线**：`#toggleSidebarBtn` 文案固定为 `☰`（不再在 ◀/▶ 间切换，动作仍由 `title` 提示），字号提到 15px；新增 `.sidebar.collapsed .sidebar-toggle { padding: 5px 3px }` 以免 48px 折叠态下图标被裁；侧栏头部的 `.sidebar-head-actions` 容器删除（头部只剩「📂 分组」+ ☰）。
- **改动 6 — 新建分组移到底部**：`#newGroupBtn` 从侧栏头部移到 `#groupTree` 之后、底部计数之前（整宽虚线按钮「＋ 新建分组」，新增 `.add-group-btn`），折叠态隐藏规则同步；点击后仍在树底插入行内输入框。
- **数据层兼容性**: vault 版本与 payload 结构未变；打开的 md 只有在选了分组后才写入，取消/切走不会产生半成品数据。

### 文件: `CLAUDE.md`

- **改动**: 架构树与「Markdown 导入」小节改写为二合一入口（`#importMenu`）与新单文件流程（先打开、保存时选分组、`pendingMdName`/`#mdOpenHint`）；侧栏说明补充「新建分组在列表底部」「☰ 折叠按钮」「宽度可拖动」；状态变量表新增 `pendingMdName`；开发注意事项 13 同步。

### 验证方式

- 回归脚本扩到 **151 项全部通过**（新增 31 项）：二合一菜单两个入口存在且分别触发目录/单文件选择、原两个按钮已从源码消失；打开文件后标题/正文/提示/按钮文案正确且**未落库、不弹选择器**；点「保存」才弹 `save` 模式选择器并在选分组后落库（三级子分组、锁定/解锁后仍在、退出待保存态、提示隐藏）；同名时选择器给提示且仍允许新增（未分组）；**点分组不丢失待保存文件**、取消后放弃且未落库、**打开其它笔记后放弃**避免误弹；普通笔记保存不弹选择器且保留原分组；☰ 图标、「新建分组」位于树之后且计数之前、侧栏头部不再挤按钮、拖宽手柄仍在。
- 另两个套件无回归：Markdown 渲染 **104 项**、锁屏专项 **8 项**；`notes.html` 语法检查通过、CSS 花括号 248/248 配平、79 个 id 无重复。
- **待人工确认**: 二合一菜单的弹出位置与观感、打开 md 后「保存到分组」选择器贴在保存按钮下方是否顺手、☰ 在 48px 折叠态下是否清晰、底部「＋ 新建分组」与底部计数的间距。

## 2026-09-10 16:31 — 新增「本地工具读取（只读）」：应用内 127.0.0.1 只读桥 + MCP 工具

**目标**：让 DeepSeek Harness 等本机工具按 id / 标题 / 分组**只读**读取「轻记」笔记。经评估选定「应用内只读接口」方案——应用保持唯一持钥方：解密仍在应用内完成，Rust 侧不接触 PIN/密钥、不读 leveldb、不把明文落盘。

### 文件: `src-tauri/src/bridge.rs`（新增）

- **改动**: 新增零新依赖的只读 HTTP 服务（`std::net::TcpListener` + `serde_json`，未引入 axum/hyper/tiny_http；`Cargo.toml`/`Cargo.lock` 未改动，哈希复核一致）。绑定 `127.0.0.1:0`（系统随机端口）+ 非阻塞 accept 循环（60ms 轮询 `shutdown` 标志）+ 每连接一线程；请求解析（请求行/头/query，percent-decode 支持中文）；响应带 `Content-Length`/`Connection: close`/`no-store`。
- **只读端点**（全部强制 `Authorization: Bearer <token>`；非 GET 一律 405；未知路径 404）：`/health`（端口/pid/笔记数/分组数/快照时间）、`/notes`（元数据 + 分组路径 + 字节数 + 开头 120 字预览，**不含完整正文**）、`/notes/{id}`（Markdown 全文；id 非数字 400、不存在 404）、`/search?q=&limit=`（标题+正文、大小写不敏感、返回命中片段；limit 归一到 1~100）、`/groups`（分组完整路径 + 直接笔记数）。
- **令牌与发现文件**: 64 位十六进制令牌（`RandomState` 随机种子 + 毫秒时间 + 栈地址 + pid 混合哈希，避免引入 `rand`），每次 `bridge_start` 重新生成；发现文件 `<app_local_data_dir>/bridge.json`（= `%LOCALAPPDATA%\com.lightnotes.app\bridge.json`）写 `{ app, readOnly, port, token, pid, since, endpoints }`；停止/退出时删除。
- **Tauri 命令**: `bridge_start(payload)`（起服务；已在运行则只更新快照并复用端口）、`bridge_sync(payload)`（更新快照，未运行静默忽略）、`bridge_stop()`、`bridge_status()`；`stop(state)` 与命令解耦，供应用退出钩子复用。
- **测试（`cargo test --lib` 14 项全通过，无警告）**: percent-decode/query 解析、请求行容错、全端点鉴权（无/错令牌 401）、写方法 405、健康信息不泄露正文、列表不含完整正文且带分组路径、详情 404/400、搜索大小写与 limit 归一、分组路径与计数、路径穿越 404、分组环保护、令牌唯一性，以及**真实 TCP 端到端**（裸 socket：401→200→详情→404→中文搜索→快照同步生效→停止后端口不再响应且发现文件被删）。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `mod bridge;`；`.manage(bridge::Bridge::default())`；`generate_handler!` 注册 4 个 bridge 命令；由 `Builder::run(ctx)` 改为 `build(ctx)` + `app.run(...)`，在 `RunEvent::Exit` 调用 `bridge::stop()`（避免留下指向已失效端口的 `bridge.json`）。

### 文件: `notes.html`

- **改动 1 — 设置页「安全」区新增一行「本地工具读取（只读）」**: 拨动开关 `#bridgeToggle`（复用 `.switch`）+ 状态行 `#bridgeStatus`（未开启 / 已开启·只读接口 `127.0.0.1:<端口>`（仅本次解锁期间有效）/ 已开启·解锁后开始监听）+ 错误位 `#bridgeErr`；描述写明「只绑定本机、只有查询接口、每次解锁重新生成令牌、锁定即停止、回收站与 JSON 历史不提供」。
- **改动 2 — 只读桥前端逻辑**: 新增 `bridgeEnabled`/`bridgeRunning`/`bridgePort`/`bridgeSyncTimer` 状态；`bridgeInvoke()`/`errText()`/`buildBridgeSnapshot()`（**只序列化 notes + groups，显式剔除 trash 与 jsonHistory**）/`renderBridgeUi()`/`showBridgeErr()`/`bridgeStart()`/`bridgeStop()`/`scheduleBridgeSync()`/`bridgeSyncNow()`/`refreshBridgeStatus()`/`toggleBridge()`。
- **改动 3 — 生命周期接线**: `unlockSuccess()` → `bridgeStart()`（仅开关打开时）；`persistData()` 落库成功后 → `scheduleBridgeSync()`（600ms 防抖，未运行时空操作）；`lockApp()` → `bridgeStop()`（锁定即断流）；`switchTab('settings')` → `refreshBridgeStatus()` 核对真实状态；`init()` 启动先 `bridgeStop()` 一次（**清掉页面重载后 Rust 侧残留的旧快照**，保证「未解锁 = 不对外提供任何数据」）；`bindEvents()` 绑定开关点击。
- **改动 4 — UI 偏好**: `light_notes_ui` 增加 `bridgeEnabled`（`loadUiPrefs` 仅在显式 `=== true` 时开启 → **默认关闭**，旧偏好缺字段一律关闭；`saveUiPrefs` 同时写回侧栏宽度与开关）。

### 文件: `tools/light-notes-mcp/`（新增目录）

- **改动**: 零依赖 Node 实现——`bridge-client.mjs`（读发现文件 + Bearer 请求；发现文件缺失/旧令牌/连接被拒/超时各给可操作中文指引）、`tools.mjs`（`notes_status`/`notes_list`（分组过滤、limit）/`notes_search`/`notes_read`（按 id 或标题，标题不唯一时返回候选而**不猜**）/`notes_groups`）、`server.mjs`（stdio MCP：`initialize`/`notifications/*`/`ping`/`tools/list`/`tools/call`，换行分隔 JSON-RPC，stdout 只出协议消息，导出 `handleMessage` 便于测试）、`notes-cli.mjs`（人工核对用 CLI，支持 `--json`）、`README.md`（安全模型、端点表、DSH `cordis.patch.yml` 接入片段、故障排查）、`test/`（`helpers.mjs`/`bridge.test.mjs`/`frontend.test.mjs`/`run.mjs`）。

### 文件: `CLAUDE.md`

- **改动**: 项目概述补「仓库其它部分」；架构树设置页补本地工具读取开关；`light_notes_ui` 与状态变量表补 4 项；设置页小节补该行说明；新增「本地只读桥（本机工具读取笔记）」小节（数据流、两个新增部分、端点、发现文件、前端链路、生命周期、测试命令）；开发注意事项新增 **14**（5 条安全约束 + 4 位 PIN 离线穷举成本的实测事实 + 禁止把 PIN 写入配置/环境变量）。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **14 项全部通过**、编译无警告；`Cargo.lock` SHA256 改动前后一致（`8E2595EB…029D`），确认零新增依赖。沙箱注意：需要一次性 `danger-full-access` 才能执行 rustup 工具链里的 `rustc.exe`（workspace-write 下报 `os error 5`）；pwsh 中**不能用管道/重定向捕获** cargo 输出（会报 `StandardOutputEncoding`/拒绝访问），须直接运行看尾部输出。
- **Node/MCP**: `node tools/light-notes-mcp/test/run.mjs` → **114 项全部通过**：假桥（复刻同一份接口与鉴权契约）驱动客户端与 5 个工具的行为断言、错误映射（旧令牌/连接被拒/发现文件缺失/端口无服务）、MCP 协议层（initialize 回显协议版本、通知不响应、tools/list 五工具与 schema、tools/call 正常/不存在/缺 name、ping、未知方法 -32601）、`notes.html` 提取函数的行为断言（快照字段、**不含 trash/jsonHistory/deletedAt**、`bridgeEnabled` 默认关闭与损坏回退），以及 `notes.html`/`bridge.rs`/`lib.rs` 的静态不变量（只绑 127.0.0.1、无 0.0.0.0、Bearer 校验、非 GET 拒绝、停止删发现文件、解锁启动/锁定停止/落库同步/启动清理接线齐全）。
- 过程中修正的三处**测试自身**错误（非实现缺陷）：列表接口本就带 120 字预览（断言改为「不含完整正文」）；搜索按标题命中时 snippet 取正文（补正文命中用例并核对片段上下文）；端口 1 属 fetch 规范禁用端口（`bad port`）导致「连接被拒」用例失真，改为先占用再释放的合法端口。
- **待人工确认**: 需重新构建应用（`npm run dev` 或 `package.bat`）才能看到开关；建议打开开关并解锁后，用 `node tools\light-notes-mcp\notes-cli.mjs status|list|search|read` 对真实数据实测一遍；另需决定是否把 MCP 行加入 DSH 的 profile patch（写入 `%APPDATA%\dsh-desktop\harness\profiles\web\cordis.patch.yml`，在本仓库沙箱范围之外）。

## 2026-09-10 16:51 — 新增「监听 Markdown 目录（新增 / 删除）」+ 目录与分组绑定

**目标**：监听本地指定目录中 Markdown 文件的**新增与删除**（内容修改不同步），并在设置界面把「目录 ↔ 分组」绑定起来——新增文件自动建为该分组下的笔记，文件被删除则对应笔记移入回收站。

### 文件: `src-tauri/src/watch.rs`（新增）

- **改动**: 新增零新依赖的目录监听模块（只用 `std::fs` 轮询；未引入 `notify`，`Cargo.toml`/`Cargo.lock` 未改动）。`Watcher`（Tauri 托管）= `Arc<Mutex<Shared>>` + `Mutex<Option<Ctl>>`；扫描线程按 `intervalMs`（默认 2000，夹在 300~60000）轮询，非阻塞标志停止并 `join`。
- **纯逻辑（可单测）**: `scan_markdown()` 递归收集 `.md/.markdown/.mdown/.mkd` 相对路径（跳过点目录/点文件，深度 ≤ 8、单目录 ≤ 5000，`/` 分隔的稳定键）；`diff_events()` 算差集——**新增** = 文件在 && 不在 `known` && 不在 `pending`，**删除** = 在 `known` && 文件不在 && 不在 `pending`；`pending` 防「已发出但前端尚未落库」窗口内重复发事件。**不比较 mtime/size**，因此修改内容不产生事件。
- **命令**: `watch_start(payload)`（bindings + known + intervalMs；先停旧的保证基线一致）、`watch_stop()`、`watch_poll()`（取走队列，含 dropped/scans/bindings）、`watch_set_known(payload)`（落库后回写，清对应 pending）、`watch_read({bindingId, relPath})`（读文件返回 **base64**，交给前端 `decodeMdBytes` 处理 BOM/GBK）、`watch_check_dir({dir})`（存在性 + .md 计数 + 文件列表）、`watch_browse_dir()`（系统「选择文件夹」：借 Windows PowerShell 的 `FolderBrowserDialog`，路径经 UTF-8 临时文件回传以避开 OEM 代码页乱码）；`watch::stop(state)` 另在 `RunEvent::Exit` 调用。
- **安全/上限**: `resolve_inside()` 拒绝绝对路径与 `..`、`canonicalize` 后校验必须在绑定目录内（防符号链接越界）；单文件读取上限 2 MiB；**模块只读用户文件**（唯一 `remove_file` 是删自己的临时文件）。
- **测试（12 项，并入 `cargo test --lib` 共 26 项全通过）**: 扩展名匹配、递归扫描与噪声跳过、缺失目录报错、差集的「新增/删除各报一次」「内容修改不产生事件」「确定性排序」、路径逃逸与嵌套路径解析、base64 参考向量（含 `轻记` → `6L276K6w`，与前端解码链对拍）、`check_dir` 计数与错误、`read_file` 的 base64/越界/大小上限、**真起线程的端到端**（基线无事件 → 新增 → 内容修改无事件 → 删除 → 停止后不再扫描）与**重启补跑**（`known` 里有已消失文件 + 目录里多出新文件 ⇒ 一次扫描同时报 removed 与 added）。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `mod watch;`；`.manage(watch::Watcher::default())`；注册 7 个 `watch_*` 命令；`RunEvent::Exit` 时在停只读桥之后追加 `watch::stop(state.inner())`。

### 文件: `notes.html`

- **改动 1 — vault 数据模型**: 加密 payload 新增 `watchers`（`persistData()` 与 `buildVault()` 均写入；解锁时 `watchers = Array.isArray(payload.watchers) ? payload.watchers : []` 兼容旧库；改 PIN 走全量重加密自动保留）。每个绑定 `{ id, dir, groupId, enabled, known: { 相对路径: noteId|null } }`——`known` 即登记表，`null` 表示只登记不对应笔记（绑定时的基线 / 空文件 / 读取失败项）。
- **改动 2 — 监听引擎**: `tauriInvoke()`（原 `bridgeInvoke()` 改名，只读桥与目录监听共用）；`watchStart()`（解锁或绑定变化时把 bindings + known 交给 Rust 并起 2s 轮询）、`watchStop()`、`watchTick()`（`watchBusy` 防重入）、`applyWatchEvents()`（create → `watch_read` → `decodeMdBytes` → 建笔记；trash → 移入回收站（软删除，保留 30 天）；forget → 撤销登记；读取失败/空文件也登记为 `null` 以免反复重试）、`watchSetKnown()`、`planWatchEvent()`（**纯函数**决策 create/trash/forget/ignore，**绑定分组已删则回落未分组**，不碰 DOM 便于断言）、`renderWatchUi()`/`renderWatchList()`、`addWatchBinding()`（先 `watch_check_dir` 取当前文件列表作基线，**不导入已有文件**）、`toggleWatchBinding()`/`removeWatchBinding()`/`setWatchGroup()`、`importWatchExisting()`（一次性导入现有文件，按标题跳过已存在的，`timestamp` 用 `baseTs - added` 保序）。
- **改动 3 — 设置页 UI（「数据」卡片新增一行 + 内联面板 + 绑定列表）**: 「监听 Markdown 目录（新增 / 删除）」行（说明 + 状态行 `#watchStatus` + 「＋ 添加目录」`#watchAddBtn`）；`#watchAddPanel` 含路径输入、浏览…（系统对话框）、检查（计数反馈）、「分组：…」（复用 `#moveMenu` 选分组）、添加/取消；`#watchList` 绑定列表每行 = 小号拨动开关（启用/暂停）+ 目录 + 「→ 分组路径 · 已登记 N 个文件」+ 「分组」/「导入现有」/「✕」；`#watchErr` 提示位。新增 CSS `.watch-add/.watch-input/.watch-list/.watch-item/.watch-dir/.watch-meta`，并把列表内开关改小（同步改 `left` 位移而非 transform，避免与基类冲突）。
- **改动 4 — 复用分组选择器**: `openMoveMenu()` 新增两个 mode——`watch`（改绑，id = 绑定 id）与 `watch-new`（新增时选分组，无 id），标题分别为「绑定到分组：」「新绑定的分组：」，目标列表复用「未分组 + 全部分组」；`#moveList` 与 `#moveNewInput` 的两处分发都加了对应分支。
- **改动 5 — 接线**: `unlockSuccess()` → `watchStart()`（含关闭期间的补跑）；`lockApp()` → 清空 `watchers`/`watchStats` + `watchStop()`；`init()` 启动时先 `watchStop()` 清残留线程并 `renderWatchUi()`；`switchTab('settings')` → `renderWatchUi()`；`deleteGroup()` 把指向被删分组的绑定回落到未分组；`bindEvents()` 加 `#watchAddBtn`/浏览/检查/分组/确认/取消/回车提交 与 `#watchList` 事件委托（toggle/group/import/remove 四个动作）。

### 文件: `CLAUDE.md`

- **改动**: 项目概述「仓库其它部分」补 `src/watch.rs`；架构树设置页补「目录监听绑定」；密文 payload 示例补 `watchers` 字段说明；状态变量表新增 6 项（`watchers`/`watchRunning`/`watchTimer`/`watchBusy`/`watchPendingGroup`/`watchStats`）；设置页小节补该行 UI 说明；只读桥小节的 invoke 名改为 `tauriInvoke` 并补充「目录监听建的笔记会自动同步给只读桥」与测试项数；新增「目录监听（本地目录 ↔ 分组绑定）」小节（分工、Rust 侧实现与命令、`known` 补跑语义、绑定基线、事件落库、纯函数、UI、生命周期）；开发注意事项新增 **15**（纯读取、路径校验与上限、只认路径差集不比较 mtime/size、known 回写时机、空文件/失败登记、分组回落、落库与桥同步、线程生命周期）；顺带把两处过期版本号（1.2.0 → 1.6.0）改正。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`、`helpers.mjs`、`html-syntax.mjs`

- **改动**: helpers 增加 `failedCount()` 供独立运行时设退出码；html-syntax 的断言名 `bridgeInvoke` → `tauriInvoke`、新增「设置页含目录监听相关元素」与更严的写入类接口守卫；frontend 测试新增 3 节共 61 项——**事件计划纯函数**（标题取自文件名/截断 60 字/空路径、新增建笔记落到绑定分组、已登记不重复、**分组被删回落未分组**、删除走回收站且命中登记的 noteId、基线条目与笔记已不存在都只 forget、未知事件忽略、**不依赖 mtime/size**）、**解码链与跨语言契约**（Rust 的 base64 `6L276K6w` → 前端解码得「轻记」、UTF-8 BOM 剥离、UTF-16LE 识别、**GBK 回退**「中文笔记」、空内容不崩、端到端 base64 → 文本）、**接线与安全静态检查**（payload 带 watchers、解锁载入、改 PIN 全量重加密、锁定清空并停监听、解锁启动、删除分组回落、init 清理、设置页刷新、事件委托四动作、新增面板绑定、moveMenu 两个 mode、事件后落库与回写 known、读取失败也登记、Rust 侧命令注册与退出停止、只读目录/只读文件/路径前缀校验/大小与深度上限、**Rust 侧不写文件且只删自己的临时文件**）。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **26 项全部通过**（只读桥 14 + 目录监听 12），编译无警告；`Cargo.lock` 未改动（零新依赖）。`node scripts/bump-version.mjs check` → 五处版本号一致（1.6.0）。
- **Node/前端**: `node tools/light-notes-mcp/test/run.mjs` → **184 项全部通过**（原 123 项 + 目录监听 61 项）；`notes.html` 自检（script 语法 / CSS 花括号 264/264 配平 / 93 个 id 无重复）通过。
- 过程中修正的两处**测试自身**错误（非实现缺陷）：`planWatchEvent` 断言曾用不存在的函数名 `changePin` 取源码（实为 `submitChangePin`，改断言为「全量重加密保留 watchers」）；`watch.rs` 的 `remove_file` 计数守卫按「只删自己的临时文件」重写（`browse_dir` 前后各删一次临时文件是合法的）。
- **待人工确认**: 需重新构建应用才能看到设置页新增的目录监听行；建议流程——绑定一个测试目录到某分组 → 在目录里新建 .md（观察是否自动建笔记、校验 GBK 文件也能正常解码）→ 删除该文件（观察是否进入回收站）→ 修改文件内容（应无任何反应）→ 锁定应用（监听应停止，`%TEMP%`/Rust 线程不再扫描）→ 重新解锁（关闭期间的变更应被补跑）。「浏览…」按钮依赖 Windows PowerShell 的 `FolderBrowserDialog`，若被策略拦截请手输路径。

## 2026-09-10 17:2x — 修复「点设置页再切回笔记明显卡顿」：命令改 async + 切页延后跨进程工作

**现象（用户报告）**：点击设置界面、再点击笔记界面时出现明显卡顿。

**定位过程**：① 先用只读桥观察运行中的应用——快照时间（16:56）与笔记数（70）在多次采样间不变，排除「后台周期性保存/监听事件造成的 churn」；② 读 Tauri 源码确认关键事实：`tauri-macros` 的 `body_blocking` 对**同步命令是内联执行**（`let result = $path(...)`），它跑在 IPC 回调线程（Windows 上即 **UI 主线程**）；只有 `async fn` 才经 `async_runtime::spawn` 抛到工作线程；③ 由此确认本项目命令**全是同步 `fn`** 是一个真实缺陷：`autostart_status` 在主线程起 `reg.exe` 读注册表、`bridge_sync` 每次保存都在主线程解析约 1MB 快照、`watch_check_dir` 在主线程遍历目录树、`watch_browse_dir` 会在主线程上等系统对话框；④ 再加上 `switchTab('settings')` 把这几件跨进程调用串进**同一次点击**的同步流程里，切页的视觉响应被一起拖慢。

### 文件: `src-tauri/src/bridge.rs`

- **改动**: `bridge_start` / `bridge_sync` / `bridge_stop` / `bridge_status` 四个命令由同步 `fn` 改为 `async fn`（并加注释说明原因：同步命令内联跑在 UI 主线程，而这些命令要解析大快照、绑定端口、写发现文件、join 监听线程）。核心逻辑与测试（`start`/`stop`/`poll`/`route` 等与之解耦的普通函数）**零改动**。

### 文件: `src-tauri/src/watch.rs`

- **改动**: `watch_start` / `watch_stop` / `watch_poll` / `watch_set_known` / `watch_read` / `watch_check_dir` / `watch_browse_dir` 七个命令全部改为 `async fn`（文件读取、目录遍历、起线程与 join 线程、拉起并等待系统对话框都不该占 UI 主线程）。`watch_check_dir` 内部参数改为先 `to_string()` 拥有化再交给 `check_dir(&dir)`。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `autostart_status` / `autostart_set` 改为 `async fn`（内部要起 `reg.exe`）。

### 文件: `notes.html`

- **改动 1 — 切页先绘制**: `switchTab('settings')` 里的四项工作（`refreshAutostart` / `refreshAppVersion` / `refreshBridgeStatus` / `renderWatchUi`）移入 `requestAnimationFrame` 回调，并在回调开头 `if (activeTab !== 'settings') return;`——保证点击的视觉反馈即时呈现，用户已切走时不再空跑。
- **改动 2 — 隐藏页面不再写 DOM**: 新增 `settingsVisible()`；`refreshAutostart()` 结果回来时改为 `if (settingsVisible()) renderAutostartToggle();`，`refreshBridgeStatus()` 改为 `if (settingsVisible()) renderBridgeUi();`——跨进程结果回来时页面可能已经切走，此时不该再去写已隐藏页面的 DOM（会在别的页面上触发无意义重排）。

### 文件: `CLAUDE.md`、`tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: CLAUDE.md 新增开发注意事项 **16**（同步命令内联跑 UI 主线程的实证、13 个命令必须 async 的规则、前端 rAF 与 `settingsVisible()` 两条配套规矩、以及更重阻塞 I/O 时应改用 `spawn_blocking` 的备注）；测试新增 2 节共 36 项——「Rust 命令不得阻塞 UI 主线程」（13 个命令逐个断言是 `async fn` 且**不存在同步版同名命令**，用否定后行断言 `(?<!async )fn NAME\(` 实现）+「切页不被跨进程工作拖慢」（`requestAnimationFrame`、`activeTab` 守卫、`settingsVisible()` 两处用途、切页路径不含 `renderGroupTree`）。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **26 项全部通过**，编译无警告（async 改造后仍全绿，证明核心逻辑未被牵动）。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **220 项全部通过**（184 + 新增 36）；`notes.html` 自检通过（script 语法 / CSS 花括号 264/264 / 93 个 id 无重复）。
- 过程中修正的**测试自身**错误：反向守卫最初写成 `(?:pub )?fn NAME\(`，而 `async fn NAME(` 本身包含子串 `fn NAME(`，导致 13 项误报；改为否定后行断言 `(?<!async )fn NAME\(` 后正确。
- **待人工确认**: 需重新构建应用（`npm run dev` 或 `package.bat`）后复测「设置 ⇄ 笔记」切换是否还卡；若仍卡，请告知是**切进设置**还是**切回笔记**更明显、以及当时编辑器里是否开着大笔记（几十 KB + 表格的那种）——后者属于 WebView2 毛玻璃重绘/大预览布局的开销，需要另走「预览懒渲染 / 降低模糊层数」的优化路径。

## 2026-09-10 17:12 — 修复「切到设置页弹出命令行弹窗」：子进程加 CREATE_NO_WINDOW

**现象（用户报告）**：每次切到设置界面时都会弹出一个命令行弹窗，一秒后自动消失。

**定位过程**：① 应用进程自身没有控制台（Tauri GUI 子系统），弹窗只可能来自**它启动的子进程**——`reg.exe`（`autostart_status` 读 `HKCU\...\Run`）与 `powershell.exe`（`watch_browse_dir` 的文件夹对话框）都是**控制台程序**，Windows 对 GUI 父进程默认给它们**新建一个控制台窗口**；② 与「切到设置页」的时序完全吻合：17:0x 那轮的 async 改造把 `autostart_status` 从主线程挪到了工作线程，命令本身不再卡 UI，但**起子进程的行为没变**，于是弹窗依旧——上一轮优化掩盖了现象却没消除根因；③ 全仓只有 4 处 `Command::new`（`lib.rs` 3 处 `reg` + `watch.rs` 1 处 `powershell`），全部漏设 `CREATE_NO_WINDOW`（`0x0800_0000`）。

### 文件: `src-tauri/src/lib.rs`

- **改动 1 — 新增统一工具**: `const CREATE_NO_WINDOW: u32 = 0x0800_0000;` + `pub(crate) fn hide_console(cmd: &mut Command)`（`use std::os::windows::process::CommandExt;` 调用 `cmd.creation_flags(CREATE_NO_WINDOW)`，附注释说明「子进程完全不显示窗口，stdout/stderr 仍可正常重定向读取」）。放在 `lib.rs` 供 `watch.rs` 复用（`crate::hide_console`）。
- **改动 2 — 三处 `reg` 子进程改为两步式**: `autostart_status`（`reg query`）与 `autostart_set`（`reg add` / `reg delete`）由 `Command::new("reg").args(..).output()` 链式写法改为 `let mut cmd = Command::new("reg"); cmd.args(..); hide_console(&mut cmd); cmd.output()`——**链式写法没有插入点，必然漏掉隐藏窗口**，故两步式是硬要求（`.spawn()` 同理不用）。其中 `reg query` 处加注释标注这就是用户看到的弹窗来源。

### 文件: `src-tauri/src/watch.rs`

- **改动**: `browse_dir()` 里起 `powershell.exe`（FolderBrowserDialog）同样改为两步式并调用 `crate::hide_console(&mut cmd)`——原先选目录时会闪一个控制台窗口，而且因为要等用户点完对话框，窗口会**停留整个对话框时长**（比设置页那次一秒的闪烁更明显）。

### 文件: `CLAUDE.md`、`tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: CLAUDE.md 新增开发注意事项 **17**（GUI 进程起控制台程序必须设 `CREATE_NO_WINDOW`、统一走 `crate::hide_console`、两步式写法与「不要链式 / 不要 `.spawn()`」的原因、两处真实症状）；测试新增 1 节 **8 项**「子进程不得弹出控制台窗口」——断言 `CREATE_NO_WINDOW` 常量与 `creation_flags` 调用存在、`hide_console` 对 crate 可见、`reg` 子进程数量与 `hide_console(&mut cmd)` 调用次数相等、PowerShell 对话框同样隐藏，以及**反向守卫**：`lib.rs` 中链式 `Command::new(..).args(..).output()` 出现次数必须为 0（一旦有人写回链式即判定漏改）。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **26 项全部通过**，编译无警告（未触碰任何核心逻辑，仅改 spawn 方式）。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **228 项全部通过**（220 + 新增 8）；`notes.html` 自检通过（script 语法 / CSS 花括号 264/264 / 93 个 id 无重复）。`node scripts/bump-version.mjs check` → 五处版本号一致（1.7.1）。
- **待人工确认**: 需重新构建应用（`npm run dev` 或 `package.bat`）后复测——切到设置页应**不再出现任何命令行弹窗**；顺带复测「＋ 添加目录 → 浏览…」期间也不再闪窗。沙箱内无法启动 GUI，故弹窗消失需由用户实测确认。

## 2026-09-10 17:20 — 打包后自动删除旧版本安装包

**需求（用户提出）**：每次打包后，都删除旧版本的 exe。

**背景**：`src-tauri\target\release\bundle\nsis\` 里已经堆了 8 个安装包（1.0.0 / 1.1.0 / 1.3.0 / 1.4.0 / 1.5.0 / 1.6.0 / 1.7.0 / 1.7.1），旧版脚本第 7 步只是**提示**「目录中还有其它版本的安装包，别发错文件」，并不清理——发版时容易点错文件。

### 文件: `scripts/clean-old-bundles.mjs`（新增）

- **改动**: 新增零依赖的旧版本安装包清理脚本。默认保留 `src-tauri/tauri.conf.json` 里的版本（`--keep <版本>` 可显式指定，`package.bat` 传当前打包版本）；递归扫描 `src-tauri/target/release/bundle/`（nsis / msi 等子目录都算），按 `^(.+)_(\d+\.\d+\.\d+…)_([^\\/]+)\.(exe|msi)$` 识别「文件名里带版本号的安装包」，**删掉版本号不等于 `--keep` 的**，保留本次版本。
- **安全设计**: ① 只删文件、绝不删目录，删除前再校验路径落在 bundle 根目录内；② **只认文件名里带版本号的安装包**——`light-notes.exe` 原始二进制、`notes.txt` 之类一律不碰（并打印「未匹配命名规则的文件」清单让人放心）；③ **安全阀**：若整个 bundle 目录里找不到 `--keep` 版本的任何产物，则一个文件都不删、只警告并列出目录内现有安装包，避免将来打包命名规则变化时把唯一产物误删成空；④ 支持 `--dry-run` 只看不删、`--dir <目录>` 换目录扫描（便于离线测试）；⑤ 删除失败（文件被占用）逐条报错并以退出码 1 结束，不影响打包流程本身。
- **踩坑记录**: 正则的目标段最初写成 `[^_\\/]+`（排除下划线），结果 **MSI 文件名匹配不上**——Tauri 的 msi 形如 `轻记_1.7.1_x64_en-US.msi`，目标段自带下划线。改为 `[^\\/]+` 后靠 group1 的贪婪匹配锁定「最后一个版本样片段」即可正确区分，nsis 与 msi 都能识别（fixture 实测）。

### 文件: `package.bat`（**GBK + CRLF，用 GBK 读写改写，勿用 UTF-8 工具直接编辑**）

- **改动 1 — 第 7 步插入清理调用**: `set "BUNDLE_DIR=…"` 之后新增两行注释 + `call node scripts\clean-old-bundles.mjs --keep %APP_VER% <nul`，**放在定位并 `explorer /select` 打开目录之前**，于是弹出的资源管理器里只剩本次版本。沿用脚本既有约定（`call node ...` + `<nul`）。
- **改动 2 — 删除已无用的旧提示块**: 移除末尾 13 行「目录里若还留着其它版本的旧安装包」统计提示（`INSTALLER_NAME` / `EXE_OTHER` 一整套），改由清理脚本输出实际删除清单。步骤注释改为「清理旧版本安装包，再定位…」。
- **编码校验**: 改写后重新按 GBK 解码比对——行级差异只有「1 行说明改动 + 3 行新增 - 13 行删除」，全部 180 处换行仍为 CRLF、无 BOM（`crlf=180 lf=180`）；并用临时 bat 在 cmd 里实跑该调用行，确认 `errorlevel=0` 且 node 输出正常、后续 `set` 变量未被 node 吃掉。

### 文件: `package.json`

- **改动**: 新增脚本 `"clean:bundles": "node scripts/clean-old-bundles.mjs"`（手动清理用）。

### 文件: `CLAUDE.md`

- **改动**: 项目概述「仓库其它部分」的 `scripts/` 说明补「旧版本安装包清理」；开发注意事项 **10** 的脚本流程改为「7 清理旧版本安装包 + 定位产物」，「产物定位」条目删掉「额外提示不是本次版本」，新增条目完整记录自动删除规则（命名识别、只删带版本号的安装包、安全阀、`npm run clean:bundles`、`--dry-run`）。

### 验证方式

- **离线 fixture 测试**（临时目录，覆盖 nsis / msi / 子目录 / 无版本号文件）：dry-run 正确列出 3 个待删；实跑后旧版本 exe 与 msi 均被删除、当前版本与 `轻记.exe`、`notes.txt` 保留；再跑一次输出「没有需要清理的旧版本安装包」；用不存在的保留版本 `--keep 2.0.0` 触发安全阀 → 一个文件都没删并列出目录内容。
- **真实目录**: `node scripts\clean-old-bundles.mjs --keep 1.7.1` 删除 7 个旧安装包（1.0.0 / 1.1.0 / 1.3.0 / 1.4.0 / 1.5.0 / 1.6.0 / 1.7.0），目录内只剩 `轻记_1.7.1_x64-setup.exe`。
- **回归**: `node tools\light-notes-mcp\test\run.mjs` → **228 项全部通过**（未触及前端与 Rust）。
- **待人工确认**: 下次跑 `package.bat` 时应看到第 7 步先打印「已删除旧版本安装包 N 个」，随后弹出的资源管理器目录里只有本次版本的安装包。

## 2026-09-10 17:33 — 新增笔记导出（阅读模式单篇 Markdown / PDF + 设置页批量导出）

**需求（用户提出）**：① 笔记阅读模式下增加导出按钮，可选导出为 md 文件或 PDF；② 设置界面中增加批量导出按钮，可多选笔记或选择整个分组导出到指定目录下。

### 文件: `src-tauri/src/export.rs`（新增）

- **改动**: 新增零新依赖的笔记导出模块（只用 `std::fs` 与 `serde_json`，`Cargo.toml`/`Cargo.lock` 零改动）。前端把笔记渲染成纯文本后交给它落盘，**Rust 侧不接触 PIN/密钥、不解密任何数据**。这是仓库里继只读桥、目录监听之后**唯一会写用户磁盘**的模块，因此刻意独立于「必须保持纯读取」的 `watch.rs`。
- **纯逻辑（可单测）**: `sanitize_file_stem()`（取最后一段路径分量、非法字符 `<>:"/\|?*` 与控制字符换 `_`、空白折叠、去结尾 `.`、避开 Windows 设备保留名 CON/PRN/AUX/NUL/COM1-9/LPT1-9（带扩展名也算）、截断 120 字符、强制 `.md`）；`plan_names()`（批内同名去重 + 未开覆盖时避开目录里已存在的同名文件，自动加「 (2)」，并回报 `renamed`/`overwrites`）；`ps_quote()`（PowerShell 单引号转义，防标题里的引号改写脚本）；`folder_dialog_script()` / `save_dialog_script()`（两个系统对话框脚本的纯函数构造器，便于单测与语法自检）。
- **写盘**: `write_files()`（目标目录必须已存在、路径必须仍落在目录内、2000 文件 / 单篇 8 MB / 单批 64 MB 上限、逐个写并收集 `written`/`failed`）、`save_file()`（保存对话框给的完整路径，校验绝对路径与 Markdown 扩展名）。
- **对话框**: `pick_folder()`（FolderBrowserDialog，选导出目录）、`pick_save_file()`（SaveFileDialog，默认文件名取标题、初始目录取上次导出目录、`OverwritePrompt`）；两者都经 `run_dialog()` 走 PowerShell，结果经 UTF-8 临时文件回传（沿用目录监听的避乱码手法），**spawn 一律两步式 + `crate::hide_console`**（否则每次导出都会闪一个控制台窗口）。
- **命令**: `export_write_files` / `export_save_file` / `export_pick_dir` / `export_pick_save`，全部 `async fn`（写盘与等对话框都不能占 UI 主线程，见 CLAUDE.md 16）。**只写不删**：全模块唯一的 `remove_file` 是删自己的 PowerShell 回传临时文件。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `mod export;`；`invoke_handler` 注册 4 个 `export_*` 命令（共 17 个）。

### 文件: `notes.html`

- **改动 1 — 阅读模式单篇导出**: `.editor-actions` 新增「📤 导出 ▾」按钮 `#exportNoteBtn`（只在 `mode === 'view'` 显示，由 `setEditorButtons` 控制）+ 提示位 `#exportHint`；新增浮层菜单 `#exportMenu`（复用 `.move-menu` 样式与 `positionMenu()` 定位，点外部/再点按钮收起）；`exportMarkdown(note)` 生成导出文本（标题作 H1，**正文已有 H1 时不重复加**，CRLF→LF，末尾补换行，空笔记返回空串并拒绝导出）；「📄 导出为 Markdown」走 `export_pick_save` → `export_save_file`（记住目录到 `light_notes_ui.exportDir`）；「🖨️ 导出为 PDF」把标题 + `mdToHtml(正文)` 填进 `#printRoot` 后 `window.print()`，`afterprint` + 60s 兜底清理。
- **改动 2 — 打印样式**: 新增 `#printRoot`（默认 `display:none`，带 `.md-preview` 类以复用预览排版，**排在脚本块之前**——脚本执行时就要取到它）与 `@media print` 段：`body > *:not(#printRoot)` 全部隐藏、`@page { size: A4; margin: 16mm }`、`break-inside/after: avoid`（pre/blockquote/table/img 不跨页、标题不与后文分离）、代码块与表格的纸面样式。
- **改动 3 — 设置页批量导出**: 「数据」卡片新增一行（「📤 导出…」`#exportOpenBtn` + 状态行 `#exportStatus`）与内联面板 `#exportPanel`：勾选列表 `#exportList`（每个分组一行复选框，**勾中 = 该分组含全部子分组的笔记**，行尾显示子树条数、部分勾选用 `indeterminate`，下面按组列出笔记可逐条勾选）+ 全选/清空 + 已选计数 + 目标目录输入与「浏览…」+「覆盖同名文件」开关（**默认不勾**）+ 导出/收起按钮 + 错误位；新增 `.export-panel/.export-row/.export-list/.export-item/.export-name/.export-meta/.export-ovr` 样式。
- **改动 4 — 导出逻辑与接线**: `exportGroupNoteIds()`（分组含子分组的笔记 id）、`exportSetGroup()`、`exportSelectedNotes()`、`renderExportList()`、`updateExportSummary()`、`renderExportUi()`（切走就不写隐藏页面）、`openExportPanel()`/`closeExportPanel()`、`browseExportDir()`、`runBatchExport()`（把标题+文本交给 `export_write_files`，回报导出数/自动改名数/失败明细）；`exportDir` 存入 `light_notes_ui`（`loadUiPrefs`/`saveUiPrefs` 同步扩展）；`switchTab('settings')` 的 rAF 回调加 `renderExportUi()`；`init()` 也先渲染一次；`lockApp()` 关闭导出菜单与面板并清空勾选；`bindEvents()` 新增导出按钮/菜单/面板/列表（`change` 事件委托）/目录/导出按钮的监听，文档点击处理加 `#exportMenu` 的收起判断。
- **踩坑记录**: `#printRoot` 的 HTML 注释里最初写了字面量 `<script>`，被 `html-syntax.mjs` 的 `/<script>([\s\S]*?)<\/script>/` 当成脚本块起点，导致「script 语法检查」把 HTML 标记当 JS 解析而报错；改成「脚本块」措辞后通过（注释里不要再出现字面量 `<script>`）。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`、`html-syntax.mjs`

- **改动**: 新增两节导出测试（**行为** 17 项：`exportMarkdown` 的标题/正文/空笔记/CRLF 归一/缺字段，`dirOfPath`，以及分组勾选语义——分组含子分组、未分组只取空 groupId、叶子分组、勾选补齐子树、取消只影响子树；**静态守卫** 34 项：阅读模式才显示导出按钮、菜单接线、单篇与批量各自调用了哪些命令、打印容器存在且**排在脚本块之前**、打印只输出 `#printRoot`、A4 页边距、默认不覆盖、勾选含子分组、导出目录记忆、隐藏页不写 DOM、锁定清理、设置页渲染、Rust 侧命令已注册、只写不删、文件名净化/保留名/上限/路径闸/`ps_quote`、不解密不碰 vault）；`async 命令`清单补 4 个 `export_*`（含「不含同步版」反向守卫）；「控制台窗口」守卫把 `export.rs` 一并纳入（链式 spawn 与 `.spawn()` 反向守卫覆盖新文件）；UI 偏好小节补 `exportDir` 的 4 项；切页守卫断言改名并新增「导出面板也在 rAF 回调里渲染」；`html-syntax.mjs` 增加「含导出相关元素」15 个 id 的检查。

### 文件: `CLAUDE.md`

- **改动**: 项目概述补 `src/export.rs`；架构树设置页补「批量导出」；`light_notes_ui` 说明补 `exportDir`；状态变量表新增 4 项（`exportDir`/`exportPickIds`/`exportRunning`/`exportHintTimer`）；设置页小节新增「批量导出笔记」条目；笔记 CRUD 的查看模式按钮列表补「📤 导出 ▾」；新增「导出笔记（Markdown / PDF）」小节（分工、两种导出链路、打印样式与「为何不做静默 PrintToPdfAsync」、批量选择语义、落盘规则、只写不删、测试）；开发注意事项新增 **18**（导出写盘的安全红线 + 打印容器位置）；注意事项 16/17 的计数与适用范围同步更新（17 个命令、export.rs 的 PowerShell 也隐藏控制台）；测试项数更新为 cargo 40 / Node 295；顺带把两处过期版本号（1.7.1 → 1.7.2）改正。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **40 项全部通过**（只读桥 14 + 目录监听 12 + 笔记导出 14），编译无警告；`Cargo.lock` 未改动（零新依赖）。其中 export 模块覆盖：净化（非法字符/路径/空白控制字符/结尾点/保留名/去扩展名/截断）、`ps_quote`、批内去重（含大小写不敏感）、避开已存在文件与「覆盖」语义、真实写盘（UTF-8、标题带 `.md` 不会变成 `.md.md`、默认绝不覆盖）、坏目标与超限拒绝、单篇保存的绝对路径/Markdown 扩展名校验，以及 **把两个对话框脚本交给 PowerShell 解析器做语法自检**（只解析不执行，不会弹窗）。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **295 项全部通过**（较上次 228 项新增 67 项：导出的行为断言与静态守卫，以及 UI 偏好、async 命令清单、控制台窗口守卫、结构自检的相应扩充）；`notes.html` 自检通过（script 语法 / CSS 花括号配平 / id 无重复 / 含导出相关元素）。`node scripts/bump-version.mjs check` → 五处版本号一致（1.7.2）。
- 过程中修正的一处**测试自身**错误：文件名净化用例原先期望换行/制表折叠为空格，而实现先把控制字符换成 `_`；判断「折叠成空格」对文件名更自然，于是改实现（空白控制字符交给空白折叠，其余控制字符仍换 `_`）而不是改断言。
- **待人工确认**: 需重新构建应用（`npm run dev` 或 `package.bat`）后实测——① 打开一篇笔记 →「📤 导出 ▾ → 导出为 Markdown」应弹出系统保存对话框并写出 `.md`；② 同一菜单选「导出为 PDF」应弹出系统打印对话框，选「Microsoft Print to PDF / 另存为 PDF」得到干净的单篇 PDF（**若 WebView2 不支持 `window.print()`，这里会没有任何反应，请告知**）；③ 设置页「📤 导出…」面板勾一个分组 → 指定目录（可用「浏览…」）→ 导出，核对文件数与文件名（标题里的非法字符被替换、同名自动加「 (2)」）；④ 再点一次「覆盖同名文件」前的复选框重导，确认行为变化。沙箱内无法启动 GUI，以上均需人工验证。

## 2026-09-11 09:56 — 修复「导出 PDF 时内容被截断」

**现象（用户报告）**：导出 PDF 时内容被截断。

**定位**：读 `notes.html` 的布局样式后确认根因是**打印容器的尺寸约束没解除**——应用是满窗口桌面式布局（`html, body { height: 100% }`、`body { height: 100vh; display: flex }`），而 `#printRoot` 为了复用预览排版带着 `.md-preview` 类，于是又继承了 `.md-preview { flex: 1; overflow-y: auto }`。两者叠加后打印页只有**一屏高**、而且是个滚动容器，超出一屏的内容全部被裁掉。另外两处会加重截断：`afterprint` 里**立刻清空 `#printRoot`**（WebView2 的打印预览是异步、按页懒渲染的，中途清空会让后续页变空白），以及对 `pre`/`table` 整块设 `break-inside: avoid`（超过一页的长代码块/长表格排不下时会被挤掉）。

### 文件: `notes.html`

- **改动 1 — 打印样式解除屏幕尺寸约束（根因）**: `@media print` 里新增 `html, body { height: auto; max-height: none; overflow: visible; display: block }`（均 `!important`，取消 `body` 的 `100vh` flex）与 `#printRoot { flex: none; position: static; width/height: auto; max-height: none; overflow: visible }`（均 `!important`，取消 `.md-preview` 的 `flex: 1` 与 `overflow-y: auto`），另补 `font-size: 11pt; line-height: 1.7`；样式注释里写明「不解除这些约束，PDF 就只有一屏」。
- **改动 2 — 分页策略**: 只对 `img`/`blockquote`/`tr` 保留 `break-inside: avoid`；**`pre` 与 `table` 改为 `break-inside: auto`**（长内容允许跨页，否则整块排不下会被丢弃）；`p`/`li` 加 `orphans/widows: 2`；`pre` 加 `overflow-wrap: anywhere`、`th/td` 加 `word-break: break-word`。
- **改动 3 — 打印期间不清空打印容器**: `exportNotePdf()` 去掉 `afterprint` 里的 `printRoot.innerHTML = ''` 与 60s 兜底清理，改为 `afterprint` 只 `classList.remove('printing')`；新增 `clearPrintRoot()`（清内容 + 复位状态），只在**安全时机**调用——目前是 `lockApp()`（锁定时连明文一起清掉），每次导出会重新填内容。
- **改动 4 — 注释**: 在 `exportNotePdf()` 上方写清两条「内容被截断」的成因，避免后来者再把清理逻辑挪回 `afterprint`。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 「导出：接线与安全约束」一节新增 10 项回归守卫——切出 `@media print` 到 `@page` 之间的 CSS 片段，断言其中确实解除了尺寸约束（`height: auto !important`、`display: block !important`、`flex: none !important`、`overflow: visible !important`）与「长代码块/长表格允许跨页」（`break-inside: auto; page-break-inside: auto;`）；对 `exportNotePdf` 加**反向守卫**：函数体内**不得出现** `printRoot.innerHTML = ''`（这正是截断的成因），且必须保留 `classList.remove('printing')`；再断言 `lockApp` 调用了 `clearPrintRoot()`、`clearPrintRoot` 会复位打印状态。

### 文件: `CLAUDE.md`

- **改动**: 「导出笔记」小节的 PDF 条目补两条 ⚠️ 坑（打印样式必须解除 body 的 `100vh` flex 与 `.md-preview` 的 `overflow-y:auto`；打印期间不得清空 `#printRoot`）与分页细节（`pre`/`table` 必须允许跨页）；开发注意事项 **18** 的 PDF 句子同步；测试项数更新为 Node **305** 项，并注明新增了「打印样式不得裁剪内容」一类守卫。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **305 项全部通过**（295 + 新增 10 项打印守卫）；`notes.html` 自检通过（script 语法 / CSS 花括号配平 / id 无重复）。本次未改动 Rust（40 项此前已全通过）。
- **待人工确认**: 需重新构建应用后重新导出 PDF，重点看**多页笔记是否完整输出**（建议用一篇超过两页、含长代码块或长表格的笔记）：
  - ✅ 期望：系统打印预览里能看到全部页，另存为 PDF 后内容完整；
  - ❌ 若仍只有一页：请告知是「**预览里就只有一页**」还是「预览正常但存出来的文件少页」——前者说明还有别的尺寸约束（我会逐层排查 `#printRoot` 的计算高度），后者更可能是打印驱动的分页问题；
  - 顺带留意页边距是否为 16mm、代码块/表格跨页处是否正常衔接。

## 2026-09-11 15:12 — 预览/阅读模式的代码块改为浅灰底

**需求（用户提出）**：笔记内容里的 code（阅读模式中黑底白字那块）改为浅灰色底色。

### 文件: `notes.html`

- **改动**: `.md-preview pre` 由「深底浅字」改为「浅灰底深字」——`background: #1e1e1e` → `#efefef`、`color: #e9e9e9` → `#1a1a1a`，并新增 `border: 1px solid #dedede`（浅灰底与白色玻璃面板之间需要一道淡边才分得清边界）；`padding/radius/overflow-x` 不变，`.md-preview pre code { color: inherit }` 保持，块内代码随父级变深字。
- **说明**: 该规则同时作用于编辑模式的实时预览与阅读（查看）模式——两处共用同一份 Markdown 渲染容器，只改阅读模式会导致切换模式时底色突变；行内代码 `.md-preview code`（`#ebebeb` / `#2b2b2b`）保持原样，与代码块形成「行内浅灰 chip / 块级浅灰面板」的层级。打印样式 `#printRoot pre`（`#f7f7f7` + `#dddddd` 边框）本来就是浅灰，现在屏幕与 PDF 口径一致。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **305 项全部通过**（含 `notes.html` 结构自检：script 语法 / CSS 花括号配平 / id 无重复）；本次仅改 CSS 取值，未触碰逻辑与打印规则。另 grep 确认页面内已无遗留的深色代码块底色（`#1e1e1e` 归零）。
- **待人工确认**: 重新构建应用后打开含代码块的笔记（阅读模式与编辑预览各看一次），确认浅灰底 + 深色字、与背景边界清晰；再导出一次 PDF 核对打印观感不变。

## 2026-09-11 15:22 — 代码块右侧留白，避免贴住预览区滚动条

**需求（用户提出）**：代码块不要拉太长，要给右侧滚动条留点空间。

### 文件: `notes.html`

- **改动 1 — 代码块右侧留 16px**: `.md-preview pre` 的 `margin: 0.6em 0` → `margin: 0.6em 16px 0.6em 0`——代码块不再拉满整栏，右边缘与预览区滚动条之间留出空隙（同时它的横向滚动条也不再与竖向滚动条贴在一起）。
- **改动 2 — 预览区为滚动条预留位置**: `.md-preview` 新增 `scrollbar-gutter: stable`（Chromium/WebView2 支持）——内容由不足一屏变为可滚动时，不再因滚动条占位而整体左右跳动，也保证任何整宽元素（表格等）都不至于压在滚动条上。
- **改动 3 — 打印端复位**: `#printRoot pre` 补 `margin: 0.6em 0`——纸面没有滚动条，复位屏幕端的右侧留白以保持左右对称（该规则特异性高于 `.md-preview pre`，仅作用于打印）。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **305 项全部通过**（含 CSS 花括号配平 / script 语法 / id 唯一）；本次仅改 CSS，未触碰逻辑与打印节流/裁剪相关的守卫。
- **待人工确认**: 重新构建应用后，在阅读模式与编辑预览里各看一篇含长代码行的笔记：
  - ✅ 期望：代码块右边缘距窗口/预览区右缘约 16px，滚动条独立在留白之外，两者不再贴在一起；纵向滚动条出现/消失时内容不左右跳动；
  - 若希望**表格也一起留白**（表格同样是整宽块、自带横向滚动），说一声即可用同一条规则处理。

## 2026-09-11 15:28 — 代码块底色改 #f5f5f5 + 解锁后不默认进编辑界面（空状态）+ 窗口默认最大化

**需求（用户提出，三项）**：① 代码块背景色改为 `#f5f5f5`；② 第一次打开、解锁后不要默认显示编辑界面；③ 窗口默认最大化。

### 文件: `notes.html`

- **改动 1 — 代码块底色**: `.md-preview pre` 的 `background: #efefef` → `#f5f5f5`（边框/字色/留白不变；打印样式原本就是 `#f7f7f7` 浅灰，屏幕与 PDF 口径一致）。
- **改动 2 — 空状态取代「默认空编辑器」**: 右侧新增空状态卡片 `#editorEmpty`（`.editor-empty`，CSS `display:none` 起手，玻璃卡片样式，内容「📒 未打开笔记 / 从左侧选择一篇笔记查看，或新建一篇」+「＋ 新建笔记」按钮），与 `#editorPanel` 互斥显示。
  - 新增 `showEditorEmpty()` / `showEditorPanel()` 两个切换函数；`cancelEdit()` 末尾改为 `showEditorEmpty()`（复位编辑器即回到空状态），`unlockSuccess()` 由「`mdTextarea.focus()`」改为「`showEditorEmpty()`」——**解锁后停在空状态、也不再自动聚焦正文**。
  - `viewNote()` / `startEdit()` / `viewTrashNote()` / `openMdInEditor()` 各补一次 `showEditorPanel()`（打开笔记/文件时离开空状态）；新增 `newNote()`（= `cancelEdit()` + 切回编辑器 + 聚焦正文）。
  - **新增两个新建笔记入口**（原先只能靠「解锁后的空编辑器」新建，隐藏编辑器后必须补入口）：空状态卡片里的「＋ 新建笔记」`#newNoteBtn` 与侧栏底部的「＋ 新建笔记」`#newNoteSideBtn`（整宽主色，`.new-note-btn`，折叠态随其它按钮一并隐藏），二者都绑定 `newNote`。
  - 键位/焦点细节：「↩ 取消」在放弃新笔记后不再对隐藏的输入框调 `focus()`（加 `editorPanel.style.display !== 'none'` 守卫）；「↩ 关闭」不再聚焦正文。

### 文件: `src-tauri/tauri.conf.json`

- **改动**: 主窗口新增 `"maximized": true`（用户要求「窗口默认最大化」）；`width/height` 960×640 保留为还原尺寸，`minWidth/minHeight` 与 `center` 不变。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 新增第 12 节「编辑器默认状态与窗口配置（静态检查）」共 **15 项**守卫：空状态容器/两个新建入口存在且已绑定、`unlockSuccess` 含 `showEditorEmpty()` 且**不含** `mdTextarea.focus()`（反向守卫，防止退回默认进编辑界面）、`cancelEdit` 回到空状态、`viewNote`/`startEdit`/`viewTrashNote`/`openMdInEditor` 会切回编辑器、`newNote` 会切回编辑器、代码块底色为 `#f5f5f5`、`tauri.conf.json` 的 `maximized === true`。

### 文件: `CLAUDE.md`

- **改动**: 架构树与「笔记 TAB 左右结构」补空状态卡片 `#editorEmpty` 与两个「＋ 新建笔记」入口；笔记 CRUD 的四态说明补 `newNote()` / `cancelEdit()` 回空状态；预览样式条目改为 `#f5f5f5`；UI 设计模式的 Tauri 窗口条目补 `maximized: true`；测试项数 305 → **320**。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **320 项全部通过**（305 + 新增 15 项守卫），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）；`tauri.conf.json` 用 `JSON.parse` 校验并把主窗口配置打印核对（`maximized: true` 已生效）。
- **待人工确认**: 重新构建应用后——① 打开含代码块的笔记，底色应为 `#f5f5f5` 浅灰；② 首次解锁后右侧应显示空状态卡片（而非空编辑器），点两个「＋ 新建笔记」任一都应进入编辑并聚焦正文，点左侧笔记应进入阅读模式；③ 启动时窗口应直接最大化。

## 2026-09-11 15:35 — 响应系统锁屏（Win+L）自动锁定笔记

**需求（用户提出）**：响应系统 Win+L 锁屏事件，锁屏后自动锁定笔记。

**方案要点**：用 **Windows 会话通知**（`WTSRegisterSessionNotification` + 子类化主窗口过程截获 `WM_WTSSESSION_CHANGE`）而不是「轮询输入桌面」——后者在 **UAC 安全桌面**上同样会判定为「已锁定」，会把正常弹 UAC 误当成锁屏。Rust 侧只「发现锁屏」（只做原子计数），真正的 `lockApp()`（清 `vaultKey` 与内存明文、回 PIN 锁屏）仍由前端执行，与手动锁定走同一条路径。

### 文件: `src-tauri/src/session.rs`（新建）

- **改动**: 新增会话锁屏模块，**零新依赖**——只声明系统 DLL 导入项（`wtsapi32` / `user32` / `kernel32`），不引入 `windows` crate：
  - `start(hwnd)`：`SetWindowLongPtrW` 子类化主窗口过程（保存旧过程指针，失败用 `GetLastError` 区分并报错）→ `WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)`；登记失败会把窗口过程**还原**后再返回错误；幂等（换窗口先 `stop`）。`stop()` 反注册 + 还原过程并把状态清零。
  - 窗口过程 `session_wndproc`：命中 `WM_WTSSESSION_CHANGE` 时调用 `handle_session_change(wparam)`，**其余消息一律 `CallWindowProcW` 转发**（旧过程为 0 时回退 `DefWindowProcW`），过程内只做原子操作——它跑在 UI 线程的消息派发路径上。
  - `handle_session_change()` 是**纯状态函数**（便于单测）：`WTS_SESSION_LOCK`(0x7) → `LOCKED=true` + `LOCK_COUNT+=1` 并返回 true；`WTS_SESSION_UNLOCK`(0x8) → 清 `LOCKED`；其它 wParam 一律忽略。
  - 命令 `session_poll()`（async）返回 `{ locked, lockCount, registered }`。
  - **4 个单测**（`GUARD` 互斥串行化共享静态状态）：锁屏累加计数并置位、解锁只清位不动计数、无关会话事件被忽略、未 start 时 registered=false。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `mod session;`；`invoke_handler` 注册 `session::session_poll`；`setup` 里取主窗口句柄登记通知（`window.hwnd().0 as isize`——`.0` 解引用即原始指针，因此无需新增 `windows` 依赖；登记失败静默忽略，只影响是否能收到锁屏事件）；`RunEvent::Exit` 里 `session::stop()` 解绑并还原窗口过程。

### 文件: `notes.html`

- **改动**: 新增「系统锁屏联动」一节 + 常量 `SESSION_POLL_MS = 800` + 状态 `sessionTimer` / `sessionBusy` / `sessionLockCount` / `sessionBaseline`：
  - 纯函数 `sessionLockDue(state, lastSeen)`：只有「Rust 侧累计锁屏次数 > 本地已处理次数」才需要锁定（本地计数非法时按 0 处理，偏保守）。
  - `sessionStart()`：解锁后调用——先取一次**基线**（避免把「解锁前发生过的锁屏」当成新事件而立刻又锁上），随后每 800ms 轮询；`sessionStop()` 清定时器并复位基线；`sessionPoll()`（`sessionBusy` 防重入）发现新事件即 `lockApp()`，命令不可用（非 Windows / 未登记）时静默忽略。
  - 接线：`unlockSuccess()` → `sessionStart()`；`lockApp()` → `sessionStop()`。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 新增第 13 节「系统锁屏联动（行为 + 静态检查）」共 **33 项**：7 项 `sessionLockDue` 行为断言 + 26 项静态守卫（Rust 侧 WTS 登记/解绑/链接 wtsapi32/识别锁屏与解锁/累加计数/子类化与消息转发/回退与还原；命令已注册且是 async；启动登记、退出解绑；前端轮询 `session_poll`、解锁才启动、锁定即停止、发现锁屏即 `lockApp()`、首次只取基线、防重入、静默忽略）；并把 `session.rs` 的 `session_poll` 纳入 async 命令清单。

### 文件: `CLAUDE.md`

- **改动**: 仓库结构补 `src/session.rs`；新增「系统锁屏联动」小节（分工、Rust 侧实现与零依赖取舍、前端链路、为何不用轮询输入桌面）；测试计数更新为 Rust **44** / Node **353**；命令计数 17 → 18（含 `session_poll`）。**另因 CLAUDE.md 触及工作区指令预算（>64KB 会被截断）做了一轮去重压缩**：删掉与「开发注意事项 18」重复的 PDF 截断细节与落盘规则长文（改为指路）、精简 bridge/watch/session 三处实现描述，内容不丢、只去重。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **44 项全部通过**（40 + 新增 4），编译**无警告**（首轮有 3 个警告——多余的 `AtomicIsize` 导入、extern 块上的文档注释、测试里未使用的变量——已全部清理后复跑确认）；`wtsapi32` / `user32` 导入链接正常。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **353 项全部通过**（320 + 新增 33），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）。
- **待人工确认（沙箱内无法启动 GUI）**: 重新构建应用后——① 解锁笔记 → 按 **Win+L** 锁屏 → 回来解锁系统，笔记应停在 **PIN 输入界面**（而不是原来的笔记内容）；② 解锁笔记后静置不动，不应被误锁（确认基线逻辑没有被旧事件触发）；③ 弹一次 UAC（例如跑一个需要提权的程序）**不应**导致笔记被锁（这是选会话通知而非轮询输入桌面的原因）；④ 若 ① 不生效，请告知，我会用 `session_poll` 的 `registered` 字段排查登记是否成功（为 false 说明 WTS 登记被拒，可改用隐藏消息窗口方案）。

## 2026-09-11 16:25 — 新增「📝 纯文本」TAB（不按 Markdown 渲染）与「🗄️ SQL」TAB（指定目录批量导入）

**需求（用户提出）**：① 增加对纯文本的支持，在上方标签页新建标签，纯文本笔记**不通过 Markdown 语法渲染**；② 增加对 SQL 文件的支持，**支持从指定的目录中批量导入**，同样在上方标签页新增标签。

**方案要点**：两个新 TAB 各用一份**独立数据**（随 vault 加密持久化，与 Markdown 笔记互不影响），正文**原样进出**——纯文本走等宽 textarea + 列表摘要（不解析 Markdown），SQL 走只读 `<pre>`（`textContent` 输出，不渲染语法、更不执行）；SQL 的目录读取交给新的**只读** Rust 模块，与 `watch.rs` 同口径（路径必须落在用户指定目录内、有深度/数量/单文件大小上限、零写操作）。

### 文件: `src-tauri/src/sql_import.rs`（新建）

- **改动**: 新增 SQL 目录批量导入模块（零新依赖，只用 `std::fs` + `serde_json`）：
  - 常量：`MAX_DEPTH`=8、`MAX_FILES`=1000、`MAX_SCAN_ENTRIES`=20000、`MAX_FILE_BYTES`=2 MiB。
  - `is_sql()`（大小写不敏感）、`rel_key()`（相对路径统一 `/` 分隔）、`scan_sql(root) -> Scan { files, too_big, truncated }`（递归收集 `.sql`，跳过点目录/点文件，按路径排序保证结果稳定，超大文件列入 `too_big`）、`scan_dir(dir) -> Value`（校验目录并回传 `{ ok, count, totalBytes, files, tooBig, truncated, maxFiles, maxFileBytes }`）、`read_file(dir, rel)`（**复用 `watch::resolve_inside()`** 做越界校验 + 单文件上限 + `watch::b64_encode()` 回传 base64）。
  - 命令（全部 `async fn`）：`sql_scan_dir` / `sql_read_file` / `sql_browse_dir`（选目录**复用 `export::pick_folder`**，因此自带 `CREATE_NO_WINDOW`，不自己起子进程）。
  - **只读红线**：只有 `read_dir`/`metadata`/`read`/`canonicalize`，没有 `fs::write` / `remove_file` / `remove_dir` / `Command::new`（测试已按字符串守卫）。
  - **6 个单测**：扩展名识别、递归扫描并跳过干扰文件（含 `.hidden/`、`.dot.sql`、`.md`）、目录不存在/不是目录、超大文件跳过并上报、读取 base64 与越界拒绝（`../outside.sql`、绝对路径、目录、不存在）、结果确定性与深度上限。

### 文件: `src-tauri/src/lib.rs`

- **改动**: `mod sql_import;`；`invoke_handler` 注册 `sql_scan_dir` / `sql_read_file` / `sql_browse_dir`（命令总数 18 → 21）。

### 文件: `notes.html`

- **改动**: 新增两个 TAB 页与全套逻辑（约 540 行新增）：
  - **顶部标签**：`#appTabs` 变为五个（📒 笔记 / 📝 纯文本 / 🗄️ SQL / 🧾 JSON 浏览器 / ⚙️ 设置），新增徽标 `#textCount` / `#sqlCount`（为 0 时隐藏）；`switchTab()` 增加两页的 `.active` 切换与渲染分支，并在**离开纯文本页时先 `flushTextNote()` 落库**（自动保存是防抖的，切页可能赶在它之前）。
  - **CSS**：新增 `.plain-list` / `.plain-item`（两行式列表行，复用 `.jhi-del` 做行内 ✕）`.plain-empty` / `.plain-textarea`（等宽）`.sql-import-panel` / `.sql-import-row` / `.sql-hint` / `.sql-viewer-head` / `.sql-viewer-title` / `.sql-viewer-meta` / `.sql-pre`。
  - **📝 纯文本页**（`#pageText`）：左 = 搜索 + `#textList` + 「＋ 新建纯文本」+ 计数；右 = 空状态卡片 `#textEmpty` / 编辑器 `#textEditor`（标题 + `#textArea`，**没有 md-toolbar、没有 md-preview**）。纯逻辑：`plainSnippet()`（折空白截断）、`textNoteTitle()`（标题 → 正文摘要 → 「无标题」，**刻意不走 `extractPlainText`**）、`textDraft()` / `textDirtyNow()`、`renderTextList()`、`selectTextNote()` / `newTextNote()` / `closeTextNote()`。保存：`scheduleTextAutosave()`（输入停顿 `TEXT_AUTOSAVE_MS`=700ms）→ `saveTextNote(silent)`（`textSaving` 防重入 + `textSavePending` 补存 + 落库失败**回滚内存**）→ `flushTextNote()`（切笔记/切页/关闭前调用）；`deleteTextNote()` 需 confirm；`copyToClipboard()` / `flashButtonLabel()` 为两个新 TAB 共用的小工具。
  - **🗄️ SQL 页**（`#pageSql`）：左 = 「📥 导入 SQL 目录 ▾」+ 内联面板 `#sqlImportPanel`（目录输入 `#sqlDirInput` / 浏览… / 扫描并导入 / 上限说明 / 错误位）+ 搜索 + `#sqlList`；右 = 空状态 `#sqlEmpty` / 只读查看区 `#sqlViewer`（标题 + 路径体积 + `#sqlPre` + 📋 复制 / 🗑️ 删除）。纯逻辑：`normSqlDir()`、`sqlEntryKey(srcDir, relPath)`（目录与相对路径都归一大小写与分隔符）、`sqlTitleFromRel()`、`formatBytes()`、`planSqlImport(existing, content)` → `add / skip / update`；`runSqlImport()` 串起 `sql_scan_dir` → 逐个 `sql_read_file`（base64 → `b64ToBuf` → `decodeMdBytes`，只剥 BOM **不 trim**）→ 去重判定 → `persistData()`，**失败或途中被锁定即回滚**（新增从 `sqlFiles` 摘除、已更新的按 backup 还原），上限 `MAX_SQL_FILES`=500 / `MAX_SQL_TOTAL_BYTES`=6MB（超限只跳过并报告）；结果复用 `#importModal`（新增 `showSqlImportReport()`）。
  - **数据模型**：vault payload 新增 `textNotes` / `sqlFiles`（`buildVault()` / `persistData()` / `unlockApp()` / `submitChangePin()` 四处同步，旧 vault 无字段按 `[]` 兼容）；`lockApp()` 清空两份额外数据、搜索态、定时器，并**把明文从 DOM 里抹掉**（`textArea.value`、`sqlPre.textContent`）、关闭导入面板、复位为空状态；`unlockSuccess()` 渲染两个列表并恢复 `#sqlDirInput`；`init()` 也先渲染一次（锁定态为空列表）。
  - **UI 偏好**：`light_notes_ui` 新增 `sqlDir`（记住上次导入的 SQL 目录，`loadUiPrefs()` / `saveUiPrefs()` 同步）。
  - **顺带修一处旧 bug**：`submitChangePin()` 在「已解锁」分支里构造的 payload **漏了 `watchers`**（改 PIN 会丢掉目录监听绑定），本次一并补上 `watchers, textNotes, sqlFiles`。
  - **只读桥不动**：`buildBridgeSnapshot()` 仍只含 `notes` + `groups`，纯文本与 SQL **不对外发**（少改动桥的安全面）。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 新增第 14 节「纯文本笔记 / SQL 文件（行为 + 静态检查）」共 **125 项**：
  - 行为断言（从 `notes.html` 提取纯函数）：`sqlEntryKey` 归一化（大小写/分隔符/尾斜杠）、`sqlTitleFromRel` 取标题、`planSqlImport` 三态、`formatBytes`、`plainSnippet`、`textNoteTitle`（**保留 `#` 等 Markdown 标记不剥**）、`textDirtyNow` 脏检查（空新笔记不脏、改标题/正文脏、锁定后按新笔记处理）。
  - 静态守卫：两个 TAB 的 DOM 与切页接线、**纯文本页不得出现 `md-preview` / `md-toolbar` / `mdToHtml`**、自动保存与「切换前落库」接线、SQL 三条命令接线、去重/上限/回滚/`persistData` 接线、结果弹层复用与 `escapeHtml`、`sqlPre.textContent` 只读输出、**前端不提供 SQL 写入/执行/删除磁盘文件接口**、Rust 侧只读约束（无 `fs::write` / `remove_file` / `remove_dir` / `Command::new` / `vault`）、vault 持久化与锁定清空/解锁载入。
  - 另：`sql_import.rs` 的三个命令纳入「Rust 命令不得阻塞 UI 主线程」清单；子进程守卫（链式 spawn / `.spawn()`）把 `sql_import.rs` 一并纳入统计；UI 偏好桩补 `sqlDir` 并新增 5 项断言；两处 `watchers }` 快照守卫改为新的 payload 字面量。

### 文件: `CLAUDE.md`

- **改动**: 架构树、标签栏、payload、状态变量、测试计数（Rust 44 → **50**、Node 353 → **478**）、命令计数（18 → **21**）、版本号（1.7.2 → 1.9.0）全部更新；新增「纯文本（TAB #pageText）与 SQL 文件（TAB #pageSql）」小节与开发注意事项 **19（SQL 目录导入只读、且不执行 SQL）**。因 CLAUDE.md 触及工作区指令预算（>64KB 会被截断），**同时做了一轮去重压缩**（注意事项 10/13/16/17/18、Markdown 解析器、本地只读桥、目录监听、导出、设置页等段落收紧措辞，规则与红线一条未删）。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **50 项全部通过**（44 + 新增 6），编译**无警告**。注：本机沙箱下 cargo 需要提权（cargo 以管道 stdio 启动 rustc 被拒），已用 `sandbox_permissions: danger-full-access` 跑通。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **478 项全部通过**（353 + 新增 125），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）——即新增的 540 行前端代码语法与 DOM 结构均通过校验。
- **待人工确认（沙箱内无法启动 GUI）**: 重新构建应用后——① 解锁 → 点「📝 纯文本」→「＋ 新建纯文本」输入几行 `# 标题`、`- 列表`，确认**原样显示、不渲染成标题/列表**，切到别的 TAB 再回来内容仍在（自动保存）；② 点「🗄️ SQL」→「📥 导入 SQL 目录 ▾」→ 填一个含 `.sql` 的目录（或「浏览…」）→「扫描并导入」，确认弹层报告新增/跳过/更新数量、列表出现文件、点开是等宽原文；③ 同一目录**再导入一次**应为「内容未变化（跳过）」，改动其中一个文件后再导入应为「更新 1 个」；④ 锁定后确认两个 TAB 的内容都消失（内存与 DOM 均清空）。

## 2026-09-11 16:50 — 修复：SQL 三条命令报 `missing required key payload`（Tauri invoke 参数契约）

**现象（用户实测）**：点「🗄️ SQL」里的「浏览…」报 `invalid args 'payload' for command 'sql_browse_dir': command sql_browse_dir missing required key payload`。

**根因**：本仓库约定 Rust 端签名写成 `payload: Value` 的命令，前端必须用 `tauriInvoke(cmd, { payload: { … } })` 调用（Tauri 按形参名取参）。新增 SQL 三条命令时我写成了扁平对象 `tauriInvoke('sql_scan_dir', { dir })`，于是 Tauri 找不到名为 `payload` 的键——三条命令（`sql_browse_dir` / `sql_scan_dir` / `sql_read_file`）**全都会失败**（「浏览…」最先被点到而已）。对照：`watch_read` / `watch_check_dir` / `export_pick_dir` 等既有命令都是 `{ payload: … }` 写法。

### 文件: `notes.html`

- **改动**: 三处调用补上 `payload` 包装——`sql_browse_dir` 传 `{ payload: { initialDir: cur } }`、`sql_scan_dir` 传 `{ payload: { dir } }`、`sql_read_file` 传 `{ payload: { dir, relPath } }`。Rust 侧签名与参数名不动。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 在第 14 节末尾新增 **26 项参数契约守卫**：对 13 个「Rust 端是 `payload` 形参」的命令（`bridge_start` / `bridge_sync` / `watch_start` / `watch_set_known` / `watch_read` / `watch_check_dir` / `sql_scan_dir` / `sql_read_file` / `sql_browse_dir` / `export_write_files` / `export_save_file` / `export_pick_dir` / `export_pick_save`）逐个断言「Rust 端仍有 payload 形参」+「前端调用点后 300 字符内出现 `payload`」——这类漏包装从此会在测试阶段暴露，而不是等用户点到才发现。

### 文件: `CLAUDE.md`

- **改动**: 开发注意事项 16 补一句参数契约（`payload: Value` 的命令前端必须 `invoke(cmd, { payload: {...} })`，注明已有测试逐一守卫）。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **504 项全部通过**（478 + 新增 26）。守卫用的是**严格判定式**（`tauriInvoke('cmd'` 之后必须紧跟 `, { payload:`，允许换行）——最初写成「调用点后 300 字符内出现 payload」的宽松版，会被邻近的其它命令调用蒙混过去，已改严。有效性做过反证：用一次性探针脚本套用**与测试相同的判定式**，对当前文件判定 `true`、对「把 `sql_scan_dir` 调用改回扁平 `{ dir: dir }`」的变体判定 `false`（探针脚本用完即删，未留在仓库）。
- **待人工确认**: 重新构建后点「浏览…」应能正常弹出系统「选择文件夹」对话框并回填路径；「扫描并导入」同样受这条契约影响，一并确认。

## 2026-09-11 17:15 — 纯文本 / SQL 两个 TAB 的侧栏可拖动 + 纯文本改为「阅读 / 编辑」两模式 + SQL 明确只读

**需求（用户提出）**：① SQL 和纯文本模块的侧边栏需要支持拖动，默认宽度与笔记模块保持一致；② 纯文本模块的阅读和编辑模式切换与笔记模块保持一致；③ SQL 模块只读。

**方案要点**：三个 TAB 的侧栏改为**共用同一套拖动逻辑与同一个宽度偏好**（拖哪个都一样，切换 TAB 不会跳宽）；纯文本从「输入即自动保存」改成与笔记模块同口径的**显式阅读 / 编辑两模式**（自动保存与「取消」语义互斥，故一并移除）；SQL 仍只读，并在 UI 上把「只读」写明、由测试守卫。

### 文件: `notes.html`

- **改动（侧栏拖动，三处共用）**：
  - DOM：`#pageText` / `#pageSql` 的侧栏加 id（`#textSidebar` / `#sqlSidebar`）与拖动手柄（`#textSidebarResizer` / `#sqlSidebarResizer`，复用 `.sidebar-resizer` 样式；≤860px 的 `display:none` 媒体查询同样覆盖它们）。
  - `applySidebarWidth()` 一次写三个侧栏（笔记侧栏保留折叠态 / 窄窗口交给 CSS 的旧逻辑，两个新侧栏只在宽窗口下写内联宽度）；`startSidebarResize(e, sideEl)` 新增 `sideEl` 参数（笔记侧栏折叠时先展开），三处绑定分别传自己的侧栏元素，`dblclick` → `resetSidebarWidth` 三处一致；新增 `window.addEventListener('resize', applySidebarWidth)`，窗口变窄/变宽时重算（原来只在加载与拖动时算）。
  - 默认宽度仍是 `.sidebar` 的 240px（与笔记模块同一个常量 `SIDEBAR_W_DEFAULT` 和同一套夹取：160~560 且受 `窗口宽 - 420` 约束），偏好仍存 `light_notes_ui.sidebarWidth`。
- **改动（纯文本：阅读 / 编辑两模式）**：
  - DOM：新增只读阅读面板 `#textViewer`（标题 + `N 字符 · 时间` + 等宽 `#textPre` + 「只读 · 点「✏️ 编辑」修改」提示），按钮 **✏️ 编辑 / 📋 复制 / ↩ 关闭 / 🗑️ 删除**；`#textEditor`（编辑模式）按钮精简为 **💾 保存 / ↩ 取消**（与笔记模块的编辑态一致）。
  - 逻辑：`selectTextNote()` 改为**阅读模式**（`textEditing=false` + `renderTextViewer()`，正文用 `textContent` 原样输出，不解析 Markdown / HTML）；新增 `startTextEdit()`（把当前笔记载入编辑器）、`cancelTextEdit()`（丢弃改动：已有笔记回阅读模式、新笔记直接放弃回空状态）；`newTextNote()` 直接进编辑模式；`saveTextNote()` 去掉 `silent`/防重入/补存参数，改为**显式保存**（写入后留在编辑模式、按钮闪「✓ 已保存」，落库失败回滚内存），编辑保留原 timestamp（与笔记模块 `writeNote` 一致）；删除当前笔记时走 `closeTextNote()`。
  - **移除自动保存**：`TEXT_AUTOSAVE_MS`、`textSaveTimer`/`textSaving`/`textSavePending`、`textDirtyNow()`、`scheduleTextAutosave()`、`flushTextNote()` 全部删除（`switchTab` 里离开纯文本页的强制落库调用也一并去掉——切页保持原状态，与笔记模块一致）；状态改为 `textEditing` 布尔量；`lockApp()` / `unlockApp()` 复位它并清空 `#textPre` 等阅读区明文。
- **改动（SQL 只读）**：查看区加 `.ro-badge`「只读」标记（`title` 说明「不提供编辑与执行；删除只删应用内副本」），并新增 `.ro-badge` 样式；DOM 里没有 textarea / contenteditable，逻辑里也没有写回函数——SQL 仍只支持 导入 / 查看 / 复制 / 删除（副本）。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 重写第 14 节里与纯文本自动保存相关的断言（删除 6 项失效断言：输入即自动保存、标题输入自动保存、自动保存判脏、切换/新建/关闭前落库），改为新增 **43 项**守卫：
  - 侧栏：两个新侧栏的 id 与手柄、CSS 默认 240px、`applySidebarWidth` 同时写三个侧栏、`startSidebarResize` 带 `sideEl`、三处 pointerdown/dblclick 绑定、`resize` 重算；行为断言 `clampSidebarWidth`（下限 160 / 上限 560 / 区间内原样 / 窄窗口 800-420=380 / 不破下限）。
  - 纯文本两模式：阅读面板与 `#textPre` 存在、编辑态按钮与阅读态按钮各自到位、点列表进阅读模式、阅读区用 `textContent`（且不含 `mdToHtml`）、编辑/保存/取消/关闭四个绑定、`cancelTextEdit` 的两条分支、保存后留在编辑模式、保存失败回滚、`Ctrl+Enter` 保存、`notContains` 自动保存定时器与三个已删函数、`lockApp` 复位编辑态并清空阅读区明文。
  - SQL 只读：`ro-badge` 存在、页面无 `<textarea>` / `contenteditable`、前端无 `saveSqlFile`、列表点击只打开只读查看。

### 文件: `CLAUDE.md`

- **改动**: 纯文本 / SQL 小节改写为「阅读 / 编辑两模式 + 不做自动保存 + SQL 只读」的新口径，并新增一条「三个 TAB 侧栏共用同一套拖动逻辑与同一个宽度偏好」；状态变量表把自动保存相关变量换成 `textEditing`。因工作区指令预算（>64KB 截断），同步压缩了 Markdown 解析器、笔记 CRUD、目录监听（`known` / 基线 / 设置页 UI / Rust 侧 / 决策函数 / 生命周期）、导出、批量导出等处措辞，规则未删。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **542 项全部通过**（504 - 6 失效断言 + 43 新增 + 1 重算断言），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）。
- **Rust**: 本轮未改 Rust 代码（`cargo test --lib` 仍为 50 项全通过）。
- **待人工确认（沙箱内无法启动 GUI）**: 重新构建后——① 在「📝 纯文本」和「🗄️ SQL」页拖动侧栏右缘，宽度应与笔记页一致、切换 TAB 不跳宽、双击手柄恢复 240；② 纯文本点一篇应进入**只读阅读模式**（原样显示，点不进光标），点「✏️ 编辑」才能改，「💾 保存」后仍在编辑态，「↩ 取消」改动作废并回阅读模式；③ SQL 查看区应显示「只读」标记且无法编辑。

## 2026-09-11 18:05 — SQL 分组 / 打开单个 SQL 文件 / SQL 目录监听（与 Markdown 分开）/ JSON 侧栏拖动 / 两个模块支持标题+内容搜索

**需求（用户提出）**：① SQL 模块支持打开单个 SQL 文件；② JSON 模块侧边栏宽度调整逻辑与笔记模块一致；③ SQL、纯文本模块搜索支持搜索标题和内容；④ SQL 模块支持创建分组（逻辑与笔记模块一致），且设置界面中增加 SQL 模块监听目录绑定设置，**与笔记模块监听目录设置分开**。

**方案要点**：SQL 模块补齐了「像笔记模块一样」的那套骨架——**自己的一份分组树**（`sqlGroups`，与笔记分组互不影响）、分组 CRUD + 移动、导入落到当前选中分组；目录监听则**另起一套绑定**（`sqlWatchers`），复用同一个 Rust 监听线程，靠新增的 `kind` 字段区分扫 `.md` 还是 `.sql`。侧栏宽度现在四个位置（笔记 / 纯文本 / SQL / JSON 历史栏）共用一套拖动逻辑与同一个宽度偏好；两个新模块的搜索改成「标题 + 内容」并显示命中片段。

### 文件: `src-tauri/src/watch.rs`

- **改动**: 绑定支持类型：
  - `Binding` 新增 `kind: String`（`#[serde(default = "kind_md")]` → 旧前端不带该字段时按 Markdown 处理，保持兼容）。
  - 新增 `is_sql()` / `is_watched(name, kind)`；`scan_markdown()` 改为 `scan_files(root, kind)`（`scan_markdown` 保留为 `scan_files(root, "md")` 的包装，既有测试与调用点不变）；`scan_once` 按 `b.kind` 扫描。
  - `check_dir(dir)` 保留为包装，新增 `check_dir_kind(dir, kind)`（返回里加 `kind` 与中性的 `count`，`mdCount` 保留兼容）；`watch_check_dir` 命令读取可选的 `kind`。
  - **2 个新单测**：`scan_files_filters_by_kind`（同一目录按 kind 分别扫出 .sql / .md，`check_dir_kind` 计数与 `kind` 字段正确）、`binding_kind_defaults_to_md`（旧 payload 缺 `kind` 时归一为 `md`）。

### 文件: `notes.html`

- **改动（SQL 分组）**：
  - 新增 `sqlGroups` / `currentSqlGroupId` / `expandedSqlGroups` / `pendingSqlOpen` / `sqlWatchers` / `sqlWatchPendingGroup` / `sqlWatchStats` 状态与「未分组」虚拟根；SQL 侧栏由平铺列表改为**分组树**（`#sqlTree`，复用 `.tree-item` 样式），底部加「＋ 新建分组」（`#sqlNewGroupBtn`）。
  - 新增 `sqlChildrenMap()` / `sqlGroupPathLabel()` / `sqlCollectDescendantIds()` / `sqlGetDepth()` / `sqlDirectFiles()` / `sqlEntryTitle()` / `renderSqlGroupNode()` / `renderSqlUngroupedRoot()` / `renderSqlLeaf()` / `renderSqlTree()` / `selectSqlGroup()` / `toggleSqlGroup()` / `addSqlGroup()` / `createSqlGroup()` / `startRenameSqlGroup()` / `deleteSqlGroup()` / `moveSqlItemToGroup()`，逻辑与笔记模块一一对应（多级嵌套、展开折叠、＋ 子分组 / ↔ 移动（防环）/ ✎ 重命名 / ✕ 删除后条目回落「未分组」、删除分组时监听绑定一并回落）。
  - `insertInlineInput()` 增加可选的 tree/depth 参数（笔记树行为不变），SQL 树复用它做行内新建；`#sqlTree` 用自己的事件委托（操作按钮优先、点箭头只展开折叠、点名称选中并展开）。
  - **分组选择器复用 `#moveMenu`**：新增 `buildSqlMoveTargets()` / `openSqlMoveMenu()` 与 5 个模式（`sql` 移动条目 / `sql-group` 调整层级 / `sql-save` 单文件导入选分组 / `sql-watch`、`sql-watch-new` 目录监听绑定分组），并在 `moveList` 点击与 `moveNewInput` 回车两处分发（SQL 模式下「新建分组并移入」建的是 **SQL 分组**）。
  - 目录批量导入的目标分组改为**当前选中的 SQL 分组**（`targetGid`），报告里显示「→ 归入「分组名」」；`viewSqlFile()` 的元信息加上分组路径与「源文件已删除」标记。
- **改动（打开单个 SQL 文件）**：入口改为二合一菜单「📥 导入 SQL ▾」（`#sqlImportMenu`：📂 按目录批量导入 / 📄 打开单个 SQL 文件），新增隐藏输入 `#sqlOpenInput`；`startSqlOpen()` → `openSqlInPicker(file)`（`readFileBuffer` + `decodeMdBytes` 解码，记入 `pendingSqlOpen`，**此时不落库**）→ 弹出 SQL 分组选择器 → `saveSqlToGroup(gid)`（同名同目录：内容一致则定位到已有条目、有变化则更新，否则新增；落库失败回滚）。
- **改动（设置页 SQL 目录监听，与 Markdown 分开）**：新增一行「监听 SQL 目录（新增 / 删除）」+ 内联面板（路径 / 浏览… / 检查 / **分组：…** / 添加 / 取消）+ 绑定列表 `#sqlWatchList` + 状态行 `#sqlWatchStatus` + 错误位 `#sqlWatchErr`，与上面 Markdown 的那一套完全独立。前端函数 `sqlWatchNewId()` / `sqlWatcherById()` / `sqlWatchActive()` / `planSqlWatchEvent()`（纯函数）/ `renderSqlWatchUi()` / `renderSqlWatchList()` / `openSqlWatchAdd()` / `browseSqlWatchDir()` / `checkSqlWatchDir()`（**带 `kind: 'sql'`**）/ `addSqlWatchBinding()` / `toggleSqlWatchBinding()` / `removeSqlWatchBinding()` / `setSqlWatchGroup()` / `importSqlWatchExisting()`（同名同目录按内容一致跳过、有变化更新）。
  - `watchStart()` 把两套绑定一起交给 Rust（`kind: 'md'` / `'sql'`），`watchKnownPayload()` 合并两套登记表（仍按 bindingId 分表，因为共用同一个 Rust 监听线程）；`applyWatchEvents()` 按 bindingId 分流：SQL 绑定走 `planSqlWatchEvent()`，新增 → 建 SQL 条目（分组取绑定分组，分组已删则回落未分组），删除 → 把条目标记 `missing: true`（**不静默丢弃副本**，列表与查看区显示「源文件已删除」）。
- **改动（JSON 侧栏拖动）**：`#jsonHistory` 加 `position: relative` 与 `#jsonResizer` 手柄，`applySidebarWidth()` 一次写四个位置（`[textSidebar, sqlSidebar, jsonHistoryPane]` + 笔记侧栏），拖动/双击/窗口 resize 与笔记模块完全同一套（DOM 引用命名为 `jsonHistoryPane` 以免与 `jsonHistory` 数组重名）。
- **改动（搜索标题 + 内容）**：抽出纯函数 `textNoteMatches(t, q)`（标题 + 内容）与 `sqlFileMatches(f, q)`（标题 + 内容 + 相对路径），两个渲染函数改为用它过滤；搜索时每行显示**命中片段**（`matchSnippet()`：±20 字上下文 + `<mark>` 高亮，标题命中则高亮标题），并在空结果里写明搜索范围。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 新增 **115 项**（含修正 6 项旧断言）：搜索匹配与片段的行为断言（标题命中 / 内容命中 / 大小写 / 路径兜底 / 未命中、片段高亮与转义）、SQL 分组（DOM、CRUD 接线、分组选择器 5 个模式的分发、导入落到当前分组）、打开单个 SQL 文件（隐藏输入、解码、选分组、同名同内容跳过 / 有变化更新 / 失败回滚）、SQL 目录监听（独立的 DOM 与绑定、`kind` 传递、`planSqlWatchEvent` 9 项行为断言、事件分流与标记载荷、设置页渲染与统计）、JSON 侧栏拖动（id/手柄/绑定/双击，共 4 处）；Rust 侧新增 7 项静态守卫（`kind` 字段、默认值、`is_sql` / `is_watched` / `scan_files(b.kind)` / `check_dir_kind` / 命令读 `kind`）。

### 文件: `CLAUDE.md`

- **改动**: 更新 SQL / 纯文本小节（分组、单文件打开、搜索口径、只读桥不外发）、设置页小节（新增 SQL 目录监听一行）、本地只读桥与目录监听小节（`kind` 双类型绑定、SQL 事件语义）、测试计数（Rust 50 → **52**、Node 542 → **657**）；同步压缩若干旧段落以守住 64KB 工作区指令预算。

### 验证方式

- **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **52 项全部通过**（50 + 新增 2），编译**无警告**。
- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **657 项全部通过**（542 - 6 旧断言修正 + 115 新增 + 6 修正），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）——本轮修掉的两个真实问题是 `jsonHistory` DOM 引用与状态变量重名、以及若干过期断言。
- **待人工确认（沙箱内无法启动 GUI）**: 重新构建后——① SQL 页「＋ 新建分组」建组、✎ 改名、↔ 移动、✕ 删除（条目应回「未分组」）；② 「📥 导入 SQL ▾」→「📄 打开单个 SQL 文件」选一个 .sql → 选分组 → 列表出现该条目；③ 设置页「监听 SQL 目录」添加一个目录（分组选 SQL 分组）→ 往目录里放一个 .sql → 应自动出现在该分组下；删掉该文件后条目显示「源文件已删除」；④ 在 JSON 页与纯文本 / SQL 页拖动侧栏，四处宽度应联动、双击恢复 240；⑤ 在纯文本 / SQL 搜索框里搜**正文里才有**的关键字，应能命中并显示高亮片段。

## 2026-09-11 17:22 — SQL 模块支持批量删除与移动（多选，与笔记模块同口径）

**需求（用户提出）**：SQL 模块增加批量删除和移动功能。

**方案要点**：不做新交互，直接把**笔记模块已经存在的那套多选**照搬到 SQL 树——`Set` 存选中 id、Ctrl/⌘ 点击切换、Shift 按可见顺序连选、侧栏出现操作栏（已选 N 个 + 📁 移动 + 🗑️ 删除 + ✕ 取消），批量移动复用同一个 `#moveMenu` 分组选择器。SQL 模块仍**只读**：删除只删应用内副本（确认文案里写明磁盘文件不受影响），移动只改 `groupId`，全程没有任何写盘调用。

### 文件: `notes.html`

- **改动（多选状态与选择栏）**:
  - 新增状态 `selectedSqlIds`（`Set`）与 `lastSelSqlId`（Shift 连选锚点，仅内存，锁定即清空）；SQL 侧栏在 `#sqlTree` 与「＋ 新建分组」之间插入 `<div class="sel-bar" id="sqlSelBar">`（复用笔记模块的 `.sel-bar` 样式与默认 `display:none`），内含 `#sqlSelCount`（已选 N 个）/ `#sqlSelClearBtn`（✕ 取消）/ `#sqlSelMoveBtn`（📁 移动）/ `#sqlSelDeleteBtn`（🗑️ 删除），并新增对应 DOM 引用。
  - 新增函数 `sqlFileById()` / `sqlVisibleIds()`（当前树里可见的叶子 id，Shift 连选按此顺序）/ `updateSqlSelBar()`（先剔除已失效 id，再显示/隐藏操作栏并写计数）/ `clearSqlSelection()` / `toggleSqlSelection()` / `selectSqlRange()`（锚点不可见时退化为单选，目标不可见时不改选择）。
- **改动（渲染与交互）**:
  - `renderSqlLeaf()` 与 `renderSqlSearchResults()` 的叶子在选中时加 `.multi-sel` 类、图标由 📄 / 🔍 变 ☑，`title` 里写明「Ctrl/⌘ 点击多选，Shift 点击连选」；`renderSqlTree()` 与 `renderSqlSearchResults()` 末尾都调 `updateSqlSelBar()`（搜索过滤后计数同样准确）。
  - `#sqlTree` 点击委托：操作按钮优先（点**已选中**条目上的 ↔ / ✕ 时 `multi = selectedSqlIds.size > 1`，作用于**整个选择**）；叶子点击改为 Ctrl/⌘ = 切换、Shift = 连选、**普通点击先 `clearSqlSelection()` 再打开查看**（与笔记树完全同口径）。
- **改动（批量删除）**: `deleteSqlFiles(ids)`（新，`idList` 统一 `Number` 化、空选择直接返回、确认文案按「单个带标题 / 多个带条数」分支且都写明「磁盘上的文件不受影响」），删除后若当前查看的条目在名单里就关闭查看区回空状态、清空多选；`persistData()` 失败时 `sqlFiles = backup` **回滚内存**并提示；原 `deleteSqlFile(id)` 改为 `deleteSqlFiles([id])` 的包装（查看区 🗑️ 按钮行为不变，只是走同一条链路）。
- **改动（批量移动）**: `openSqlMoveMenu()` 新增 `sql-multi` 模式（`id` 是 id 数组；全部同组则预标 ✓，**跨分组时用哨兵 `\u0000mixed` 使都不标 ✓**，标题显示「N 个 SQL 文件」并复用 `buildSqlMoveTargets()` 的同一份目标列表）；`moveSqlItemToGroup()` 把 `sql` 分支扩展为 `mode === 'sql' || 'sql-multi'`（批量改 `groupId`、目标一致时也清多选以免「点了没反应」、落库失败提示且不回滚多选、`sql-multi` 结束时 `clearSqlSelection()` 顺带重绘）；`#moveMenu` 的 `moveList` 点击与 `moveNewInput` 回车两处分发都加上 `sql-multi`（「新建分组并移入」建 SQL 分组后同样批量移动）。
- **改动（锁定）**: `lockApp()` 增加 `selectedSqlIds.clear(); lastSelSqlId = null;`（与 `exportPickIds` 同一处，明文与选择状态都不留内存）。

### 文件: `tools/light-notes-mcp/test/frontend.test.mjs`

- **改动**: 新增第 17 节「SQL 批量删除 / 移动（多选，行为 + 静态检查）」共 **66 项**：
  - 用假 DOM 驱动提取出的多选函数做行为断言（17 项）：初始隐藏操作栏、Ctrl/⌘ 切换、计数文案、全部取消后隐藏、Shift 向后/向前连选（含锚点且不移动锚点）、无锚点时等同单选、目标不可见时不变、取消选择清空、**已删除条目从多选中剔除且计数同步**、全部失效后隐藏、每次变化都重绘。
  - 用假 `confirm` / `persistData` 驱动 `deleteSqlFiles` 做行为断言（14 项）：取消则不删不落库不重绘、确认后批量删除并清空多选、确认文案含条数与「磁盘上的文件不受影响」、删除当前查看的条目时关查看区回空状态、删别的条目不影响当前查看、**落库失败回滚内存并提示**、单个删除复用同一链路（文案带标题）、空选择不弹确认框。
  - 静态接线守卫（35 项）：`Set` + 锚点、四个操作栏元素与 `.sel-bar` 复用、Ctrl/⌘ 与 Shift 分支、普通点击先清空、`.multi-sel` 与 ☑ 图标（列表与搜索结果两处）、两处 `updateSqlSelBar()` 调用、操作栏三个按钮的接线、**已选条目上的按钮作用于整个选择**、`sql-multi` 模式（跨分组哨兵 / 条数文案 / 复用目标列表）、批量移动落库与失败提示、锁定清空多选、单个删除转发批量删除、`deleteSqlFiles` 内不含任何 `tauriInvoke`（只读约束）。
  - 修正 3 项因重构而过期的旧断言：`SQL 删除需确认且不动磁盘文件` 改查 `deleteSqlFiles`、`SQL 树点击只打开只读查看` 改查 `viewSqlFile(id);`、`SQL 模式在分组选择器里被分发` 改为同时接受 `sql-multi`（并新增一项校验「新建分组并移入」那条分支也认 `sql-multi`）。

### 文件: `CLAUDE.md`

- **改动**: SQL 小节补「多选（批量删除 / 移动）与笔记模块同口径」一句（`selectedSqlIds` / `#sqlSelBar` / `sql-multi` 模式 / 只删应用内副本），状态变量表补 `selectedSqlIds` 与 `lastSelSqlId` 两行，测试计数 Node 657 → **723**；同步压缩若干旧段落以守住 64KB 工作区指令预算。

### 验证方式

- **Node/前端**: `node tools\light-notes-mcp\test\run.mjs` → **723 项全部通过**（657 + 66，其中 3 项为旧断言修正），含 `notes.html` 结构自检（script 语法 / CSS 花括号配平 / id 无重复）——本轮实测踩到的两个坑：`extractFunction()` 从 `function` 起截取会**丢掉前面的 `async`**（`new Function` 里编译 `await` 直接抛 SyntaxError，harness 改用 `extractAsync()` 补回），以及 harness 里的 `renderSqlTree()` 桩必须像真实实现那样调 `updateSqlSelBar()`，否则选择栏计数断言失真。
- **Rust**: 本轮无 Rust 改动，未重跑 `cargo test --lib`（仍为上次的 52 项全通过）。
- **待人工确认（沙箱内无法启动 GUI）**: 重新构建后——① SQL 页 Ctrl/⌘ 点击多个 SQL、Shift 点击连选，侧栏应出现「已选 N 个」操作栏且被选条目图标变 ☑；② 点「🗑️ 删除」→ 确认后这批条目消失、磁盘上的 `.sql` 仍在、当前查看的条目被删时应退回空状态；③ 点「📁 移动」→ 选分组（或「＋ 新建分组并移入」）→ 这批条目一起移动且各自计数正确，跨分组选择时菜单里不应有任何 ✓；④ 点已选中条目行内的 ↔ / ✕ 应对**整个选择**生效；⑤ 普通点击（不带修饰键）应清空多选并打开该条目查看；⑥ 锁定后重新解锁，操作栏应消失、多选不残留；⑦ 若该条目来自目录监听绑定：应用内删除**不会**把它从绑定的 `known` 登记表里摘掉，所以只要磁盘文件还在就不会被重新导入（`known` 里的 id 已在 `sqlFiles` 中找不到，等磁盘文件被删时按「只撤销登记」处理）——这是刻意选择，避免刚删掉的条目在下次解锁时复活。
