# CLAUDE.md

## 项目概述

**轻记 (Light Notes)** — 一款极简的四位 PIN 码锁屏笔记应用。纯单文件 HTML 实现，零外部依赖，数据在浏览器 `localStorage` 中**加密存储**（Web Crypto AES-GCM）。设计风格为毛玻璃（glassmorphism），模拟 Tauri/Electron 桌面应用窗口感。

- **文件**: `notes.html`（唯一实现文件，包含 HTML + CSS + JS）
- **仓库其它部分**: `src-tauri/`（Tauri v2 外壳：托盘与开机启动命令 + 本地只读桥 `src/bridge.rs` + 目录监听 `src/watch.rs` + 笔记导出 `src/export.rs` + SQL 目录导入 `src/sql_import.rs` + 系统锁屏联动 `src/session.rs`）、`tools/light-notes-mcp/`（Node 零依赖的 MCP 服务器 / CLI，把只读桥提供给本机工具）、`scripts/`（打包前复制、版本号 bump、旧版本安装包清理）、`modified.md`（改动日志）
- **语言**: 简体中文界面
- **目标平台**: 仅 Tauri 桌面应用（开发时 `http://localhost:1420`；**浏览器模式已关闭**，非 Tauri 环境拒绝运行；关闭窗口驻留系统托盘）

## 架构

单文件 IIFE 架构，所有逻辑封闭在一个立即执行函数内：

```
notes.html
├── <style>          — 全局样式（玻璃效果、TAB 布局、左右布局、Markdown 预览/工具栏、弹层、JSON 浏览器、设置页、搜索）
├── <body>           — DOM 结构
│   ├── #lockScreen  — 锁屏界面（**只有 4 位 PIN 输入框**）
│   ├── #notesPanel  — 主面板（解锁后）：顶部 TAB 栏 + 五个 TAB 页
│   │   ├── #pageNotes（📒 笔记）— 左：搜索框 +「📥 导入 Markdown ▾」整宽按钮（弹出二合一菜单）+ 分组笔记合并树 + 底部「＋ 新建笔记」/「＋ 新建分组」；右：空状态卡片（`#editorEmpty`，解锁后默认显示）或 Markdown 编辑器（带工具栏）
│   │   ├── #pageText（📝 纯文本）— 左：搜索框 + 纯文本列表（`#textList`）+ 底部「＋ 新建纯文本」；右：空状态卡片（`#textEmpty`）或阅读区 / 编辑器（标题 + 等宽 textarea，**无工具栏、无预览：不按 Markdown 渲染**）
│   │   ├── #pageSql（🗄️ SQL）— 左：「📥 导入 SQL 目录 ▾」整宽按钮 + 内联导入面板（`#sqlImportPanel`）+ 搜索框 + SQL 分组树（`#sqlTree`）+ 多选操作栏（`#sqlSelBar`）；右：空状态卡片（`#sqlEmpty`）或只读查看区（`#sqlViewer`：标题/路径/体积 + `#sqlPre` 等宽原文 + 📋 复制 / 🗑️ 删除）
│   │   ├── #pageJson（🧾 JSON 浏览器）— 粘贴→格式化并自动保存历史
│   │   ├── #pageSettings（⚙️ 设置）— 开机自动启动开关 + 导入 / 打开 Markdown + 目录监听绑定 + 批量导出 + 修改 PIN 入口 + 本地工具读取开关
│   ├── #moveMenu    — 分组选择器浮层（`#moveHead` 标题 + `#moveList` 树形目标 + `#moveNewInput` 新建分组并移入；笔记/分组/保存打开的 md 共用）
│   ├── #importMenu  — 「导入 Markdown」二合一菜单（📁 选择文件夹导入 / 📄 打开单个文件）
│   ├── #changePinModal — 修改 PIN 弹层（仅由设置页打开）
│   ├── #mdImportInput — 隐藏的文件输入（webkitdirectory，Markdown 目录导入用）
│   ├── #mdOpenInput — 隐藏的文件输入（单个 .md，读入编辑器后由「保存」选分组）
│   └── #importModal — Markdown 导入结果弹层（仅目录导入用）
└── <script>         — IIFE 包裹的业务逻辑
```

**两个视图状态**通过 `display: none/flex` 切换：
- **锁屏视图** (`#lockScreen`): **只有 4 位 PIN 输入框**（无图标/标题/说明/解锁按钮/底部提示；**第 4 位输入完成自动解锁**，Enter 兜底；错误提示仅在出错时出现在输入框下方）
- **主面板** (`#notesPanel`): 顶部为 TAB 页栏（`#appTabs`：📒 笔记 / 📝 纯文本 / 🗄️ SQL / 🧾 JSON 浏览器 / ⚙️ 设置，`switchTab()` 切换 `.active` 类），右侧常驻「🔒 锁定」；TAB 徽标显示笔记总数 / 纯文本篇数 / SQL 文件数 / JSON 历史条数（为 0 时徽标隐藏）

**笔记 TAB（#pageNotes）左右结构**（`#mainBody` flex 布局）：
- `#groupSidebar`：**宽度可拖动**（右缘 `#sidebarResizer` 手柄，160~560px 且受窗口宽度约束，双击恢复默认 240，落库在 `light_notes_ui`；窄窗口 ≤860px 隐藏手柄、侧栏整宽）+ 多选操作栏（`#selBar`，选中笔记时出现）+ 顶部「📂 分组」标题 + **三横线 ☰ 折叠按钮**（`#toggleSidebarBtn`，文案固定 ☰、动作只体现在 `title`）+ 搜索框（`#noteSearch`，关键字非空时整树切换为扁平搜索结果）+「📥 导入 Markdown ▾」一个整宽按钮（`#importMdBtn`，详见「Markdown 导入」）+ 合并树（文件管理器式）——分组节点多级嵌套、展开折叠、CRUD；展开的分组下直接列出其笔记叶子（`renderNoteLeaf`），点笔记即在右侧打开编辑。含「未分组」虚拟根（`UNGROUPED_KEY` 展开键）；**树与底部计数之间是「＋ 新建笔记」**（`#newNoteSideBtn`，整宽主色）**与「＋ 新建分组」**（`#newGroupBtn`，整宽虚线），折叠态一并隐藏
- `#editorPanel`：独占右侧剩余空间——`#noteTitleInput`（标题）+ `#mdToolbar`（Markdown 工具栏，回收站只读时禁用）/ 左 50% `#mdTextarea`（Markdown 源码）/ 右 50% `#mdPreview`（实时预览，防抖 150ms）
- `#editorEmpty`：**空状态卡片**（`.`editor-empty`，CSS `display:none` 起手）——**解锁后默认显示它而不是编辑器**（用户要求「第一次打开，解锁后不要默认显示编辑界面」），内容为「📒 未打开笔记 / 从左侧选择一篇笔记查看，或新建一篇」+「＋ 新建笔记」按钮。切换由 `showEditorEmpty()` / `showEditorPanel()` 承担：`cancelEdit()`（复位编辑器）与 `unlockSuccess()` 走空状态；`viewNote` / `startEdit` / `viewTrashNote` / `openMdInEditor` / `newNote()` 切回编辑器

## 数据模型

### localStorage 键

| 键名 | 说明 | 状态 |
|---|---|---|
| `light_notes_vault` | 加密保险库（JSON）——笔记 / 分组 / 回收站 / JSON 历史的唯一存储 | 唯一加密存储 |
| `light_notes_data` | 旧版明文笔记数组 | 已废弃，迁移后删除 |
| `light_notes_pin` | 旧版明文 PIN | 已废弃，迁移后删除 |
| `light_notes_ui` | UI 偏好（`{ "sidebarWidth": <number>, "bridgeEnabled": <boolean>, "exportDir": "<string>", "sqlDir": "<string>" }`，**非机密，不加密**，独立于 vault） | 新增 |

### 保险库结构（`light_notes_vault`）

```jsonc
{
  "v": 3, "kdf": "PBKDF2-SHA256", "iter": 600000,
  "salt": "<base64 16B>",  // 建库时生成，改 PIN 时重新生成
  "iv": "<base64 12B>",    // 每次加密重新随机
  "cipher": "<base64>"     // AES-GCM 密文
}
```

### 密文内的明文 payload

```jsonc
{
  "notes":  [{ "id": <number>, "title": "标题", "content": "markdown 源码", "timestamp": <number>, "groupId": <string|null> }],
  "groups": [{ "id": "g_xxx", "name": "分组名", "parentId": <string|null>, "order": <number> }],
  "trash":  [{ "id": <number>, "title": "标题", "content": "markdown 源码", "timestamp": <number>, "groupId": <string|null>, "deletedAt": <number> }],
  "jsonHistory": [{ "id": <number>, "ts": <number>, "raw": "粘贴查看过的 JSON 原文" }],
  "watchers": [{ "id": "w_xxx", "dir": "D:\\notes", "groupId": <string|null>, "enabled": true, "known": { "相对路径.md": <noteId|null> } }],
  "textNotes": [{ "id": <number>, "title": "标题", "content": "纯文本原文", "timestamp": <number> }],
  "sqlFiles": [{ "id": <number>, "title": "init", "relPath": "sub/init.sql", "srcDir": "D:\\db\\sql", "bytes": <number>, "content": "SQL 原文", "importedAt": <number> }]
}
```

- `groupId: null` = 「未分组」
- 分组 id 为字符串（`g_` + 时间戳 + 随机），笔记 id 为数字，互不冲突
- `jsonHistory` 为 JSON 浏览器自动保存的历史（新条目在前，`MAX_JSON_HISTORY`=100 条上限），旧 vault 无该字段时按 `[]` 兼容
- `watchers` 为**目录监听绑定**（见「目录监听」小节）：`known` 是「相对路径 → 由该文件创建的笔记 id」的登记表，值为 `null` 表示只登记、不代表任何笔记（基线或跳过项）；旧 vault 无该字段时按 `[]` 兼容
- `textNotes` 为**纯文本笔记**、`sqlFiles` 为**导入的 SQL 文件**（均随 vault 加密持久化）；旧 vault 无这两个字段时按 `[]` 兼容（见「纯文本笔记」「SQL 文件」小节）

### 状态变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `vault` | object | 当前加密保险库 JSON |
| `vaultKey` | CryptoKey | AES-GCM 密钥，解锁后缓存、锁定置 null |
| `notes` | Array | 内存中的笔记数组 |
| `groups` | Array | 内存中的分组数组 |
| `currentGroupId` | string\|null | 当前分组（null = 未分组），新笔记归入该组 |
| `expandedGroups` | Set | 展开的分组 id + `UNGROUPED_KEY`（仅内存，不持久化） |
| `editingId` | number\|null | 编辑模式下的笔记 id（null = 非编辑） |
| `viewingId` | number\|null | 查看模式下的笔记 id（null = 非查看，与 `editingId` 互斥） |
| `trash` | Array | 回收站（软删除笔记，含 `deletedAt`） |
| `jsonHistory` | Array | JSON 浏览器历史 `[{ id, ts, raw }]`（随 vault 加密持久化） |
| `activeTab` | string | 当前 TAB（`notes` / `text` / `sql` / `json` / `settings`） |
| `currentJsonId` | number\|null | JSON 历史中正在查看的条目 id |
| `viewingTrash` | boolean | 当前是否选中回收站视图 |
| `viewingTrashNote` | object\|null | 回收站中正在只读查看的笔记 |
| `isUnlocked` | boolean | 当前是否已解锁 |
| `unlocking` | boolean | 解锁防重入标志 |
| `searchQuery` | string | 侧栏搜索关键字（非空 = 搜索模式，树渲染为扁平结果） |
| `autostartOn` | boolean | 设置页镜像的开机自启动状态 |
| `importing` | boolean | Markdown 目录导入进行中（防重入，导入期间禁用导入按钮） |
| `sidebarWidth` | number | 侧栏宽度（拖动调整，160~560 且受窗口宽度约束，记忆在 `light_notes_ui`） |
| `selectedNoteIds` | Set | 多选中的笔记 id（Ctrl/⌘ 点击切换、Shift 点击连选；仅内存，锁定即清空） |
| `lastSelNoteId` | number\|null | Shift 连选的锚点笔记 id |
| `selectedSqlIds` / `lastSelSqlId` | Set / number\|null | SQL 多选与 Shift 锚点（同笔记口径，仅内存，锁定即清空） |
| `pendingMdName` | string\|null | **已在编辑器里打开、还没选分组保存的 md 文件名**（非 null = 点「保存」时先弹分组选择器；编辑器底部显示 `#mdOpenHint`） |
| `bridgeEnabled` | boolean | 「本地工具读取（只读）」开关（存 `light_notes_ui`，**默认关闭**） |
| `bridgeRunning` | boolean | 本地只读桥是否正在监听（Rust 侧实际状态） |
| `bridgePort` | number\|null | 只读桥端口（null = 未监听） |
| `bridgeSyncTimer` | number\|null | 快照同步防抖定时器 |
| `watchers` | Array | 目录监听绑定 `[{ id, dir, groupId, enabled, known }]`（随 vault 加密持久化） |
| `watchRunning` | boolean | Rust 侧目录监听线程是否在跑 |
| `watchTimer` | number\|null | 前端事件轮询定时器 |
| `watchBusy` | boolean | 事件落库防重入 |
| `watchPendingGroup` | string\|null | 「＋ 添加目录」面板里选中的目标分组 |
| `watchStats` | object\|null | 最近一批变更统计 `{ created, trashed, skipped }` |
| `exportDir` | string | 导出目标目录（记忆在 `light_notes_ui.exportDir`，阅读模式单篇导出与批量导出共用） |
| `exportPickIds` | Set | 批量导出里勾选的笔记 id（仅内存；勾分组 = 勾中它含子分组的全部笔记；锁定即清空） |
| `exportRunning` | boolean | 批量导出进行中（防重入，导出期间禁用按钮） |
| `exportHintTimer` | number\|null | 编辑器底部导出提示的自动消失定时器 |
| `textNotes` / `sqlFiles` | Array | 纯文本笔记 / 导入的 SQL 文件（随 vault 加密持久化，锁定即清空） |
| `currentTextId` / `currentSqlId` | number\|null | 当前打开的纯文本 / 正在查看的 SQL 条目 id |
| `textEditing` | boolean | 纯文本是否处于编辑模式（false = 阅读模式，与笔记模块同口径） |
| `textSearchQuery` / `sqlSearchQuery` / `sqlDir` | string | 两个新 TAB 的搜索关键字；SQL 导入源目录（记忆在 `light_notes_ui.sqlDir`）；`sqlImporting` = SQL 导入防重入 |

## 加密体系

- **PBKDF2**（SHA-256，600000 次迭代）从 PIN 派生 AES-GCM 密钥（256 bit，不可导出）
- **PIN 校验机制**：不存 PIN、不存哈希，以 AES-GCM 解密的鉴权 tag 判定（错误密钥必然 throw）
- **解锁**：`deriveKey(pin, vault.salt)` → `tryDecryptVault(key)` → 成功缓存 `vaultKey`
- **锁定**：`vaultKey = null`，内存中笔记/分组全部清空
- **修改 PIN**：旧 PIN 验证 → 新 salt + 新密钥 → 全量重加密写入
- **保存**：`persistData()` 用缓存密钥重新加密（salt 不变、IV 每存新生成）；**先写 `localStorage` 成功后才更新内存 `vault`**（写入失败时内存 vault 不得先行变更）

## 核心功能

### 锁屏模块
- **极简锁屏**：`#lockScreen` 内**只有 4 个 PIN 输入框**（`#pinGroup`，`role="group" aria-label="输入四位 PIN 解锁"`）——图标、标题、副标题、解锁按钮、底部提示全部移除（对应 CSS 类已删除），输入框在窗口中垂直水平居中
- PIN 输入框自动跳转：输入一位自动聚焦下一个，Backspace 删除时回退
- 只允许数字（`\D` 过滤），支持整串粘贴分发到 4 格
- **第 4 位输入完成自动解锁**（先取 PIN 再清空再解锁）；Enter 键兜底（不足 4 位时提示）
- PIN 错误：输入框边框深灰闪烁 + 下方黑白灰提示条（`.lock-screen .error-msg` 绝对定位于 `top: calc(50% + 52px)`，**平时不占位、出现时不移动输入框**；基础样式仍供修改 PIN 弹层用）
- **修改 PIN**（入口在设置页「安全」区）: 旧 PIN → 新 PIN → 确认（加密后 PIN 即密钥，故移除无验证的「重置」按钮；忘 PIN = 数据不可恢复）
- **环境检测**：非 Tauri 环境或 `crypto.subtle` 缺失（如 `file://`）时显示横幅（`.env-banner`，唯一例外）、**禁用 4 个 PIN 输入框**（原实现是禁用解锁按钮）并阻止运行，不落任何数据、不降级为明文

### Markdown（零依赖自写解析器）
- `mdToHtml(src)` → `mdBlocks(lines)`（块级）→ `mdInline`（行内）；`\r\n` 归一化，空输入返回空串
- **块级支持**（CommonMark 核心 + GFM 扩展）：围栏代码 ``` ```/`~~~`（可带语言类名）、缩进代码块（4 空格 / Tab）、ATX 标题 `#`~`######`（可带闭合 `#`、空标题）、**Setext 标题**（`===`/`---`；`---` 在段落之后按 Setext，否则按分隔线）、分隔线（`---`/`***`/`___`）、**引用**（连续 `>` 行，内部**递归按块解析**，天然支持嵌套与引用内列表/代码块）、**列表**（`-`/`*`/`+`/`1.`/`1)`，任意层级嵌套、缩进续行、松散列表、项内多段/代码块、任务列表 `- [ ]`/`- [x]`）、**GFM 表格**（表头 + 分隔行判定、`:--`/`--:`/`:-:` 对齐、`\|` 转义、缺列补空；要求两行都含 `|` 以免与 Setext 标题歧义）、段落
- **块级实现**：`mdBlocks(lines, depth)` 单遍扫描 + `mdParseList()` 聚合列表项（同级同类成项、更深缩进作续行），项内容再经 `mdInnerBlocks` 递归解析；超过 `MD_MAX_DEPTH`(16) 层退化为段落
- **软换行策略**：同一段落内的换行渲染为 `<br>`（「回车即换行」，与编辑直觉一致；**刻意不采用** CommonMark「软换行折叠为空格」），空行分段
- **行内支持 / 实现（防串扰）**：转义 `\*`、行内代码 `` ` ``/` `` ` `（首尾各去一个空格）、**图片** `![说明](url "标题")`、链接 `[文字](url "标题")`、自动链接 `<https://…>`、**裸网址**（http/https，尾部标点剥离）、强调 `***`/`**`/`__`/`*`/`_`（词内 `_` 不生效）、**删除线** `~~文字~~`。做法：先 `escapeHtml` 整体转义，再用 `\u0001<序号>\u0001` **token 占位**按「转义 → 行内代码 → 图片 → 链接 → 自动链接 → 裸网址 → 强调 → 删除线」替换后还原，避免「链接 URL 里的 `*` 被当斜体」；源串已整体转义，故捕获组**不得二次 escapeHtml**（否则 `&` 变 `&amp;amp;`），属性值直接拼入即安全
- **XSS 防护**：标签自拼装、文本经 `escapeHtml`、URL 过 `safeUrl` 白名单（链接仅 `http:`/`https:`/`mailto:`，图片仅 `http:`/`https:`）；不支持的 URL 与原始 HTML 按文本输出（`javascript:` 被拒，控制字符先剥离）
- `extractPlainText(md)`：剥除代码块/表格/标题/引用/列表标记/强调/删除线，图片与链接取文字，供列表卡片标题与搜索片段使用
- `renderPreview()`：textarea 输入防抖 150ms 实时渲染
- **预览样式**：`table/th/td`（斑马纹、`width:max-content` + `overflow-x:auto` 防撑破窄栏）、`img`（`max-width:100%`）、`del`、`.lang-*`、**代码块 `pre` 浅灰底 `#f5f5f5`**（用户指定；`1px #dedede` 淡边 + 深色字，与行内代码 `#ebebeb` 分层；打印同为浅灰）、**代码块右侧留 16px**（`margin: 0.6em 16px 0.6em 0`，勿当冗余清掉；`.md-preview` 用 `scrollbar-gutter: stable` 预留滚动条位，打印端由 `#printRoot pre` 复位成对称）
- **工具栏 `#mdToolbar`（16 个按钮，`flex-wrap: wrap` 自动折行）**：H1/H2/H3 ｜ B（粗体）I（斜体）S（删除线）`</>`（行内代码）```（代码块）｜ 🔗（链接）🖼️（图片）▦（表格）｜ ❝（引用）•（无序）1.（有序）☑（待办）｜ —（分隔线）；均为纯文本变换（`applyLinePrefix` 行首前缀「同前缀取消 / 标题换级 / 多行整块」，`applyWrap` 包裹占位、`applyLink`/`applyImage`/`applyTable`/`applyFence`/`applyHr`）；`commitMdEdit()` 用 `document.execCommand('insertText')` 提交以保留 Ctrl+Z（失败回退直接赋值），随后派发 input 事件刷新预览；无选区点按钮插入占位文本并自动选中（表格选中首格、图片选中 `https://`）；`applyLinePrefix` 对**空行/空笔记**同样插入前缀（否则空笔记上点按钮无反应）；回收站只读时工具栏加 `.off` 禁点，查看模式整列被 `.view-mode` 隐藏

### 分组与笔记合并树
- **合并树（文件管理器式）**：左侧一栏同时承载分组与笔记——展开的分组节点下直接列出其笔记叶子（`renderNoteLeaf`），「未分组」为虚拟根（展开键 `UNGROUPED_KEY`）
- 树形多级嵌套（任意深度），分组展开/折叠状态仅存内存
- 分组 CRUD：新建（顶级/子级）、重命名、删除（**该组及子孙组的笔记移至「未分组」，数据零丢失**）；行内 input 新建/重命名，插入位置 = 父分组子树之后
- 交互：分组箭头 = 切换展开；分组名称 = 选中 + 展开（祖先链一并展开）；笔记叶子 = 点击打开**查看模式**（只读）；叶子 hover 显示 ✎（直接编辑）/ ↔（移动）/ ✕
- **侧栏宽度可拖动**：`#groupSidebar` 内的 `#sidebarResizer`（右缘手柄，`cursor: col-resize`）`pointerdown` → `startSidebarResize()` 监听 window 的 `pointermove/pointerup`（移出侧栏也跟手），`clampSidebarWidth()` 限定 160~560px 且不超过 `窗口宽 - 420`；拖动时给 `body` 加 `.resizing`（全局 col-resize 光标 + 禁选中 + 关掉 `.sidebar` 的 width 过渡）；`pointerup` 时 `saveUiPrefs()` 写入 `light_notes_ui`，`init()` 里 `loadUiPrefs()` 恢复；**双击手柄恢复默认 240**；折叠态与 ≤860px 窄窗口下 `applySidebarWidth()` 清掉内联宽度交给 CSS（折叠 48px / 窄窗整宽），展开或恢复宽窗后自动还原用户宽度
- **笔记多选（移动 / 删除）**：`selectedNoteIds`(Set) + `lastSelNoteId`（Shift 锚点）；**Ctrl/⌘ 点击**切换单条、**Shift 点击**按可见叶子顺序（`visibleNoteIds()`）连选、**普通点击**先 `clearSelection()` 再打开；选中叶子加 `.multi-sel` 且图标变 ☑；侧栏出现 `#selBar`（已选 N 条 + 📁 移动 + 🗑️ 删除 + ✕ 取消）；`deleteNotes(ids)` 批量软删除（`deletedAt` 递减保序），`moveItemToGroup('notes', ids, gid)` 批量改 `groupId` 并清空多选；锁定即 `clearSelection()`
- 分组行 hover 显示 ＋（新建子分组）/ ↔（移动分组：改父级，可移入任意分组或顶层）/ ✎（重命名）/ ✕（删除）
- **移动到分组（`#moveMenu`）**：`openMoveMenu(btn, mode, id)`（`note` / `notes` / `group` / `watch` / `watch-new`，另有 SQL 侧的 `sql*` 模式）渲染树形缩进目标（`buildMoveTargets` 递归 + 缩进 + 计数 + 当前项 ✓）；分组模式**排除自身与全部子孙**（防环），多选模式跨分组用哨兵 `\u0000mixed` 使其都不标 ✓；底部可「＋ 新建分组并移入」；菜单自动避让视口。`moveItemToGroup()` 落库：笔记改 `groupId`、分组改 `parentId`（校验防环、按末尾 `order` 追加）
- 笔记也可在右侧编辑器中经「📁 移动」按钮（`#moveNoteBtn`，查看/编辑模式可见，`setEditorButtons` 控制）移动
- 侧栏底部 = 全局有效笔记总数；分组行 badge = 该组直接笔记数；树底 = `🗑️ 回收站` 节点（badge = 回收站笔记数）
- 回收站视图：点回收站节点 → 树中列出已删除笔记（`renderTrashNode`，按 `deletedAt` 降序）；点叶子只读查看（按钮切换为「↺ 恢复」「🗑️ 彻底删除」，textarea readonly）

### 笔记 CRUD
- **新增/编辑**：`saveNote()`（校验非空 → 有待保存 md 时先弹分组选择器 → 否则 `writeNote(currentGroupId)`）与 `writeNote(gid)`（upsert，编辑保留原 timestamp，写 `groupId = gid`）；保存后进入编辑态（按钮短暂显示「✓ 已保存」）；回收站只读视图下不可保存
- **删除（软删除）**: 树叶子 ✕ 按钮 → 移入回收站（`trash.push({ ...note, deletedAt: Date.now() })`），可恢复
- **恢复**: `restoreFromTrash()` 移回原分组（分组已删则归入未分组），并自动打开恢复的笔记继续编辑
- **彻底删除**: `purgeTrash()` 从回收站移除，不可恢复（树叶子 ✕ 与编辑器按钮均可）
- **自动清理**: 解锁时 `purgeExpiredTrash()` 删除 `deletedAt` 超过 30 天（`TRASH_TTL`）的回收站笔记
- **排序**: 组内笔记按 `timestamp` 降序（`directNotes()`）
- **标题**: 优先显示 `title`，无标题回退正文纯文本前 24 字（`noteTitle()`）
- **编辑/查看模式切换**: 编辑器四态（`setEditorButtons(mode)`：new/view/edit/trash）。点叶子 → `viewNote()` 查看（**只显示渲染预览**，隐藏标题输入与源码列，`.view-mode` 类；标题以 `h1.note-view-title` 渲染在预览顶部，按钮「✏️ 编辑」「↩ 关闭」「📁 移动」「📤 导出 ▾」）；「✏️ 编辑」→ `startEdit()`（按钮「💾 保存」「↩ 取消」，所属分组成为当前分组）；`cancelEditing()` 取消时已有笔记回到查看、新笔记清空；`newNote()` = 复位编辑器 + 切回编辑器 + 聚焦正文；保存后留在编辑模式（按钮短暂显示「✓ 已保存」）。回收站视图保留源码+预览两栏（不启用 `.view-mode`）。**打开单个 md 后**（`pendingMdName` 非 null）：底部 `.md-open-hint` 显示来源，按钮为「💾 保存到分组…」+「↩ 取消」；`viewNote()`/`startEdit()`/`viewTrashNote()` 经 `clearPendingMd()` 放弃它，而 `selectGroup()` 保留它（点分组浏览不丢内容）

### JSON 浏览器（TAB #pageJson）
- 顶部 TAB「🧾 JSON 浏览器」切页（`switchTab()`），内容与笔记同存于加密 vault 内
- **格式化查看**: 上方 textarea 粘贴 JSON → 「✨ 格式化并保存」或 Ctrl+Enter → `JSON.parse` 校验后 `JSON.stringify(obj, null, 2)` 2 空格缩进展示（`textContent` 输出，XSS 安全）；解析失败在工具栏显示黑白灰错误提示，不保存
- **自动保存**: 每次成功格式化的**原始文本**自动入历史 `jsonHistory`（前插，上限 `MAX_JSON_HISTORY`=100，随 `persistData()` 加密落库）；TAB 徽标显示历史条数
- **历史列表**: 左侧「🕘 JSON 历史」按时间倒序（时间 + 单行摘要），点击条目→回填输入框并重新格式化（当前项高亮）；✕ 删除需确认；「清空输入」只清输入与输出
- **复制**: 「📋 复制」写入剪贴板（`navigator.clipboard`，失败回退 `execCommand('copy')`）
- 锁定清空 `jsonHistory` 内存态；解锁默认回到「笔记」TAB

### 设置页（TAB #pageSettings）
- 「⚙️ 设置」为第三个 TAB（`switchTab('settings')`），进入时调用 `refreshAutostart()` 从系统读取开机启动真实状态
- **布局**：`.settings-wrap` 铺满面板（`max-width: 1040px` + `margin: 0 auto`，960 默认窗口下几乎满宽），四张卡片（通用 / 数据 / 安全 / 关于）纵向排列；`.setting-row` 为「`.setting-text` 文字块（`flex: 1`）+ 右侧控件」左右布局，控件统一 `min-width: 148px` 并对齐居中，开关 `.switch` 为 56×30（滑块 24px）；`≤620px` 窗口收窄内边距并取消控件最小宽度
- **开机自动启动**: 黑白拨动开关 `#autostartToggle` → 前端 invoke 后端命令 `autostart_status()` / `autostart_set({ enabled })`；失败原因显示于 `#settingsErr`。后端命令为自定义 Rust 命令（无需 capability 白名单），读写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 值名「轻记」（与 productName 一致，保证 NSIS 卸载器可清理），启用值带 `--autostart` 启动参数
- **修改 PIN**: 「安全」区按钮打开 `#changePinModal`（锁屏/顶栏的旧入口已移除）
- **本地工具读取（只读）**: 「安全」区第二行——黑白拨动开关 `#bridgeToggle`（复用 `.switch` 样式）+ 状态行 `#bridgeStatus` + 错误位 `#bridgeErr`。开关状态存 `light_notes_ui.bridgeEnabled`（**默认关闭**，旧偏好无该字段一律视为关闭）；打开后仅**解锁期间**生效，锁定立即停止。`switchTab('settings')` 时 `refreshBridgeStatus()` 向 Rust 侧核对真实监听状态并渲染端口。详见下节「本地只读桥」
- **监听 Markdown 目录（新增 / 删除）**: 「数据」区第三行——「＋ 添加目录」按钮展开内联面板 `#watchAddPanel`（`#watchPathInput` 路径输入 + 「浏览…」`#watchBrowseBtn` + 「检查」`#watchCheckBtn` + 「分组：…」`#watchGroupBtn` + 添加 / 取消），下方 `#watchList` 为绑定列表、`#watchStatus` 状态行、`#watchErr` 提示位。详见「目录监听」小节
- **监听 SQL 目录（新增 / 删除）**: 「数据」区第四行——与上面 Markdown 的那一套**完全独立**：`#sqlWatchAddBtn` 展开 `#sqlWatchAddPanel`（路径 + 浏览… + 检查 + 「分组：…」选 **SQL 分组** + 添加 / 取消），下面 `#sqlWatchList` / `#sqlWatchStatus` / `#sqlWatchErr`。绑定存 vault 的 `sqlWatchers`；新增 → 建 SQL 条目（落到绑定分组，分组已删则未分组），文件被删 → 条目 `missing: true`（显示「源文件已删除」，不丢副本）
- **批量导出笔记**: 「数据」区第四行——「📤 导出…」按钮 `#exportOpenBtn`（再点一次收起）展开内联面板 `#exportPanel`：勾选列表 `#exportList`（分组一行复选框 = 该分组含全部子分组的笔记，行尾显示子树条数、半选用 `indeterminate`；下面按组列出笔记逐条勾选）+ 全选 / 清空 + 已选计数 `#exportCountLabel` + 目标目录 `#exportDirInput` + 「覆盖同名文件」`#exportOverwriteChk`（**默认不勾**）+ 导出 / 收起，提示位 `#exportErr`、状态行 `#exportStatus`。详见「导出笔记」小节
- **关于**: 仅显示应用名称与版本号（`#aboutVersion` = 「版本 x.y.z」）。版本号运行时经 `invoke('plugin:app|version')` 读取（`tauri.conf.json` 为唯一事实来源，`npm run bump` 后自动跟随，无需在 `notes.html` 维护第二份；capability `core:default` 已含 `allow-version`）；**读不到时隐藏该行**（不硬编码兜底）。`refreshAppVersion()` 在 `switchTab('settings')` 时与 `refreshAutostart()` 一同刷新

### 系统锁屏联动（Win+L / 屏保锁定 → 自动锁定笔记）
- **分工**：`src-tauri/src/session.rs` 只「发现锁屏」（不碰密钥、不解密）；锁定仍是前端 `lockApp()`（清 `vaultKey` 与内存明文、回 PIN 锁屏）。
- **Rust 侧（零新依赖，只声明系统 DLL 导入项）**：`WTSRegisterSessionNotification`（wtsapi32）登记主窗口；子类化窗口过程（`SetWindowLongPtrW` / `CallWindowProcW`，失败回退 `DefWindowProcW`）截获 `WM_WTSSESSION_CHANGE`，只认 `WTS_SESSION_LOCK`(0x7) / `WTS_SESSION_UNLOCK`(0x8)，**其余消息原样转发**；过程内只做原子计数（不加锁、不碰 UI、不 I/O）。`session_poll()` 返回 `{ locked, lockCount, registered }`；`start(hwnd)` 幂等、`stop()` 反注册并还原过程（`RunEvent::Exit` 调用）。句柄取 `WebviewWindow::hwnd().0 as isize`，**不引入 `windows` crate**。
- **前端链路**：`unlockSuccess()` → `sessionStart()`（先取**基线**，避免把解锁前的旧锁屏当新事件；随后每 `SESSION_POLL_MS`=800ms 轮询）→ `sessionPoll()`（`sessionBusy` 防重入，纯函数 `sessionLockDue(state, lastSeen)` 比较累计计数）→ 成立即 `lockApp()`；`lockApp()` → `sessionStop()`。计数是**累计值**，不漏事件。
- **为何不用「轮询输入桌面」**：`OpenInputDesktop` 在 **UAC 安全桌面**上同样判定为「已锁定」，会把弹 UAC 误当锁屏；会话通知只在真锁屏/解锁时到达。

### 笔记搜索
- `#noteSearch` 非空时 `renderGroupTree()` 切换为 `renderSearchResults()`：对 `notes` 的标题+正文做大小写不敏感子串匹配，时间降序输出扁平结果
- 结果复用树事件委托（点条目查看、✎ 编辑 / ↔ 移动 / ✕ 删除均可用），每条附分组路径+时间与命中片段（`searchSnippet`）；命中文字经 `highlightMatch` 先转义再包 `<mark>`，保持 XSS 管线；搜索状态下底部计数显示「找到 N 条结果」（`#footSuffix`）
- Esc 或 ✕（`#searchClearBtn`）清空搜索，恢复原分组树（展开状态保留）

### Markdown 导入（📥 目录导入 / 📄 打开单个文件）
- **入口（二合一）**：笔记 TAB 侧栏只有一个整宽按钮「📥 导入 Markdown ▾」（`#importMdBtn`，`.import-btn`，侧栏折叠时隐藏），点它弹出 `#importMenu`（复用 `.move-menu`/`.move-opt` 样式，`positionMenu()` 贴按钮定位、空间不足翻到上方）：**📁 选择文件夹导入（批量）** 与 **📄 打开单个文件（选分组）**；设置页「数据」区对应同样是单个按钮「📥 导入 / 打开」（`#settingsImportBtn`）。`openImportMenu()` / `closeImportMenu()` / `pickImportMode(mode)` 负责开关，目录走 `startMdImport()`、单文件走 `startMdOpen()`；点外部或再点按钮收起（`lockApp()` 一并关闭）
- **目录导入**：隐藏的 `<input type="file" id="mdImportInput" webkitdirectory directory multiple>` → WebView2（Chromium）弹系统「选择文件夹」对话框；递归读取其中所有 `.md` / `.markdown` / `.mdown` / `.mkd`（大小写不敏感，含子文件夹），按相对路径排序后逐个 `FileReader.readAsArrayBuffer` 读取
- **单文件「先打开、保存时选分组」**：隐藏的 `<input type="file" id="mdOpenInput" …>` 选中后 `openMdInEditor(file)` 解码并**直接放进编辑器**（不落库），底部出现 `#mdOpenHint`，保存按钮变「💾 保存到分组…」+「↩ 取消」；`pendingMdName` 记录待保存文件名。点它才由 `openNoteSavePicker()` 弹出 `#moveMenu`（`mode='save'`，当前分组预标 ✓），选目标分组 / 底部「＋ 新建分组并移入」→ `saveNoteToGroup(gid)` → `writeNote(gid)`（同名**不拦截**）；再点一次 = 收起选择器
- **编码**：先识别 UTF-8 BOM / UTF-16LE / UTF-16BE BOM；否则严格 `TextDecoder('utf-8', {fatal:true})`，抛错（中文 Windows 的 GBK 文件）回退 `TextDecoder('gbk')`，再兜底宽松 UTF-8（`decodeMdBytes`）
- **写入**：文件名（去扩展名、压空白、截断 60 字）作标题、文件内容 `trim()` 作正文；目录导入的目标是**顶级「导入」分组**（`ensureImportGroup()` 复用或新建），单文件保存的目标是用户所选分组（含「📥 未分组」）；`timestamp` 用**循环前一次性 `baseTs` 递减**（严格单调，保证树中顺序与文件夹一致，不能用 `Date.now()` 逐次相减）
- **重复判断改为「与全部笔记比对标题」（跨分组）**：导入前用 `mdTitleKey()`（`trim().toLowerCase()`）把所有**有效笔记**（不含回收站）建成 `title → notes[]` 索引，导入过程中新加的笔记也实时入索引（同批重名同样命中）。命中时：① 其中有一条**内容完全相同** → 跳过并计入「已导入过的文件」；② 都没有相同内容（仅标题相同，可能已在别处编辑过）→ **同样跳过**，但在结果里单列「同名文件」并给出已有笔记的**分组路径**。这样把「导入后又被移动到其它分组」的笔记也算作已导入，重复导入同一目录不会产生副本
- **单文件不走导入管线也不跳过**：直接写普通笔记（`openMdInEditor` → `saveNoteToGroup` → `writeNote`），只在选择器里提示「已存在同名笔记（位置）」；`dedup:false` 分支为保留能力（当前 UI 未使用）
- **上限与失败处理**：目录导入单次 ≤ `MAX_IMPORT_FILES`(2000) 个文件、≤ `MAX_IMPORT_BYTES`(20MB)；`persistData()` 抛错（如 `QuotaExceededError`）或导入途中被锁定 → **回滚**本次新增笔记与新建的空分组
- **结果弹层 `#importModal`**：`#importSrc` 显示来源；`#importReport` 含 成功 N 条（→ 分组）/ 跳过已导入 / 跳过同名（含位置）/ 忽略非 Markdown / 读取失败 / 上限或回滚提示；文件名与路径都经 `escapeHtml` 拼装
- **导入后**：切回「笔记」TAB、退出搜索模式、展开并选中目标分组（正在编辑时不打断编辑）

### 本地只读桥（本机工具读取笔记）
- **目的**：让本机工具（如 DeepSeek Harness）按 id / 标题 / 分组**只读**读取笔记。数据流是「应用解密 → 前端生成快照 → Rust 只读服务 → 本机工具」，**Rust 侧不接触 PIN/密钥、不解密任何数据**。
- **仓库两部分**（`notes.html` 之外）：
  - `src-tauri/src/bridge.rs`：零新依赖只读 HTTP 服务（`TcpListener` + `serde_json`）；绑 `127.0.0.1:0`（随机端口）、非阻塞 accept + 60ms 轮询 shutdown、每连接一线程；命令 `bridge_start/bridge_sync/bridge_stop/bridge_status`；退出时 `stop()` 避免留下指向死端口的发现文件
  - `tools/light-notes-mcp/`：Node 零依赖客户端（`bridge-client.mjs`）、工具清单（`tools.mjs`：`notes_status` / `notes_list` / `notes_search` / `notes_read` / `notes_groups`）、stdio MCP 服务器（`server.mjs`）、CLI（`notes-cli.mjs`）、`README.md`、`test/run.mjs`
- **只读端点**（全部要求 `Authorization: Bearer <token>`，非 GET 一律 405）：`/health`、`/notes`（元数据 + 分组路径 + 字节数 + 开头 120 字预览，**不含正文**）、`/notes/{id}`（全文）、`/search?q=&limit=`、`/groups`
- **发现文件**：`<app_local_data_dir>/bridge.json` 写 `{ app, readOnly, port, token, pid, since, endpoints }`；令牌 64 位十六进制（`RandomState` + 时间 + 栈地址 + pid 混合哈希，无需 `rand`），**每次解锁重新生成**
- **前端链路**：`tauriInvoke()` 封装 invoke；`buildBridgeSnapshot()` 只序列化 `notes` + `groups`（**显式剔除 `trash` 与 `jsonHistory`**）；`unlockSuccess()` → `bridgeStart()`；`persistData()` 落库成功后 → `scheduleBridgeSync()`（600ms 防抖）→ `bridgeSyncNow()`；`lockApp()` → `bridgeStop()`；`refreshBridgeStatus()` 进设置页时核对真实状态；`init()` 先 `bridgeStop()` 一次，**防止页面重载后 Rust 侧留着上一次的明文快照**（未解锁必须不提供任何数据）。目录监听建的笔记也经 `persistData()` 自动同步，DSH 能立刻读到
- **生命周期**：未解锁 / 开关关闭 → 不监听；锁定 → 立即停止并删发现文件；应用退出 → 同样停止
- **测试**：`cargo test --manifest-path src-tauri/Cargo.toml --lib`（**52 项** = 只读桥 14 + 目录监听 14 + 笔记导出 14 + SQL 导入 6 + 系统锁屏 4，含真实 TCP 端到端、真实文件系统轮询、真实写盘与 PowerShell 脚本语法自检）；`node tools/light-notes-mcp/test/run.mjs`（**723 项**：假桥驱动的客户端/工具/MCP 协议行为、`notes.html` 提取函数的行为断言、跨语言解码链，以及静态不变量——`notes.html`/`bridge.rs`/`watch.rs`/`export.rs`/`sql_import.rs`/`session.rs`/`lib.rs` 的安全性、命令必须 async 且 `payload` 形参必须带包装、切页不得被跨进程工作拖慢、子进程不得弹控制台窗口、打印样式不得裁剪内容、编辑器默认状态（空状态）与窗口默认最大化、系统锁屏联动与两个新 TAB（纯文本两模式、SQL 分组 / 单文件 / 只读 / 独立目录监听 / 多选批量删除移动）的接线，加 `notes.html` 结构自检「script 语法 / CSS 花括号配平 / id 唯一」）

### 目录监听（本地目录 ↔ 分组绑定）
- **目的**：把本地目录绑定到某个分组，目录中**新增** Markdown 文件自动建为该分组下的笔记，文件被**删除**则笔记移入回收站；**内容被修改不会同步**（需求即「只监听新增、删除」）。
- **分工**：`src-tauri/src/watch.rs` 只做「文件系统 → 路径差集 → 事件队列」，不读笔记内容、不碰密钥；前端负责把事件落库（建笔记 / 软删除）并把登记表写回 Rust 与 vault。
- **Rust 侧（零依赖轮询）**：`std::fs` 每 `intervalMs`（默认 2000，夹在 300~60000）扫一次 → `scan_files(root, kind)`（`kind` 取 `md` / `sql`，`Binding.kind` 决定；`scan_markdown()` 是 `kind="md"` 的包装）→ `diff_events()`（**纯函数**）算差集：不在 `known`/`pending` ⇒ `added`；在 `known` 但文件消失 ⇒ `removed`。命令 `watch_*` 7 个：`watch_read` 返回 base64 且**路径必须落在绑定目录内**（拒绝对路径/`..`，canonicalize 后校验前缀，单文件 ≤2 MiB）；`watch_check_dir` 支持可选 `kind`；`watch_browse_dir` 借 PowerShell 对话框，结果经 UTF-8 临时文件回传以避开 OEM 代码页乱码。`watch::stop()` 另在 `RunEvent::Exit` 调用。Markdown 与 SQL 两套绑定**共用同一个监听线程**（`known` 仍按 bindingId 分表）。
- **`known` 登记表 = 跨重启的补跑依据**：`{ 相对路径: noteId | null }` 随 vault 加密保存；`null` 表示「已登记但不对应笔记」（基线、空文件、读取失败项）。解锁时把它交给 Rust，于是**应用关闭/锁定期间的新增与删除会在下次解锁时补跑**，而不会把已有文件重新导入一遍。
- **绑定时的基线**：`addWatchBinding()` 先 `watch_check_dir` 拿当前文件列表，把 `known` 全填 `null`（**不导入已有文件**）；要导入已有文件点该行「导入现有」（同「选择文件夹导入」规则，`timestamp` 用 `baseTs - added` 保序）。
- **事件落库（前端）**：`watchTick()`（每 2s 轮询，`watchBusy` 防重入）→ `applyWatchEvents(events)`：`create` → `watch_read` 取 base64 → `decodeMdBytes`（UTF-8 BOM / UTF-16 / **GBK 回退**）→ `trim()` 后建笔记（标题取文件名、分组取绑定分组；**绑定分组已删则回落未分组**）；`trash` → 软删除进回收站；`forget` → 只撤销登记。读取失败或空文件也写入 `known`（值 `null`）以免每轮重试。一批处理完 `persistData()` + `renderGroupTree()` + `watchSetKnown()`。
- **决策逻辑是纯函数**：`planWatchEvent(binding, ev)` 返回 `ignore / create / trash / forget`，不碰 DOM，便于在 Node 侧断言。
- **设置页 UI**: 面板元素见「设置页」小节；绑定列表 `#watchList` 每行 = 小号开关（暂停/启用）+ 目录 + 「→ 分组路径 · 已登记 N 个文件」+「分组」/「导入现有」/「✕」，状态行 `#watchStatus` 显示启用数 / 监听中 / 最近变更。分组选择复用 `#moveMenu`（`watch` 改绑、`watch-new` 新增时选）。
- **生命周期**：解锁才启动（`unlockSuccess()` → `watchStart()`）、锁定即停止并清空内存绑定（`lockApp()`）、`init()` 先 `watchStop()` 清残留线程；删除分组时把指向它的绑定回落到未分组。

### 导出笔记（Markdown / PDF）
- **目的**：把笔记带出应用变成普通文件——阅读模式导单篇（`.md` 或 PDF），设置页导一批（多个 `.md` 到一个目录）。
- **分工**：前端把笔记渲染成 Markdown 文本 / 打印用的 HTML，**Rust 只负责写盘与弹系统对话框**（`src-tauri/src/export.rs`），Rust 侧不接触 PIN/密钥、不解密任何数据（收到的就是用户自己看得见的纯文本）。
- **阅读（查看）模式单篇导出**：`#exportNoteBtn`（「📤 导出 ▾」，只在 `mode === 'view'` 显示）→ `#exportMenu` 二选一：
  - **📄 导出为 Markdown**：`exportMarkdown(note)` 生成文本（标题作一级标题；**正文自己已有 H1 时不重复加**；CRLF 归一为 LF；末尾补换行；空笔记返回空串并由前端拒绝）→ `export_pick_save`（系统「保存文件」对话框，默认文件名取标题、初始目录取上次导出目录）→ `export_save_file` 写盘；取消对话框 = 静默返回。
  - **🖨️ 导出为 PDF**：把标题 + `mdToHtml(正文)` 填进 `#printRoot`（带 `.md-preview` 复用预览排版）→ `window.print()` → 打印对话框选「Microsoft Print to PDF」。**刻意不做静默 PrintToPdfAsync**（要引 `webview2-com` 与 unsafe COM，违背零依赖）。
  - **`#printRoot` 必须排在脚本块之前**；`@media print` 里 `body > *:not(#printRoot)` 全部隐藏 + `@page { size: A4; margin: 16mm }`。
  - ⚠️ 打印相关的两条「内容被截断」坑（必须解除 body 的固定高度与 flex、`#printRoot` 的滚动裁剪；打印期间不得清空 `#printRoot`）与分页细节（`pre`/`table` 允许跨页）见「开发注意事项 18」。
- **设置页批量导出**：面板见「设置页」小节。选择状态统一是**笔记 id 集合** `exportPickIds`——**勾中分组 = 该分组及其全部子分组的笔记**（`exportGroupNoteIds(gid)` = `gid + collectDescendantIds(gid)`；`gid` 为 null 只取未分组），也可逐条勾选。目标目录手输或「浏览…」（`export_pick_dir`），**记住在 `light_notes_ui.exportDir`**（单篇导出也复用为初始目录）。
- **落盘规则**：每篇一个 `.md`（文件名由 Rust 净化）、批内同名自动加「 (2)」、**默认不覆盖**（勾选后才覆盖）、目标目录必须已存在、上限 2000 文件 / 单篇 8 MB / 单批 64 MB；返回 `{ count, bytes, renamedCount, written[], failed[] }`。完整口径见「开发注意事项 18」。
- **写盘是「只写不删」**：`export.rs` 不删除、不移动、不重命名任何已有文件（唯一 `remove_file` 只删它自己的 PowerShell 临时文件），也不建目录树。
- **测试**：Rust `export` 模块 14 项 + Node 侧断言（`exportMarkdown`、勾选逻辑、「只在 view 模式显示」「打印容器排在脚本块前」「默认不覆盖」「打印不裁剪」等静态守卫），计数见「本地只读桥 → 测试」。

### Markdown 导入实现要点
- `importMdFromFiles(fileList, cfg)` 是**目录导入的统一入口**：`cfg.target = { group, created }` 指定目标分组（不传则用「导入」分组）、`cfg.srcLabel` 定制来源文案、`cfg.dedup === false` 关闭跳过判断；读取/编码/上限/回滚/结果弹层逻辑都在这里
- 单文件打开是一条独立链路：`startMdOpen()` → `openMdInEditor(file)`（解码入编辑器、置 `pendingMdName`）→ `saveNote()` 拦截并 `openNoteSavePicker()` → `saveNoteToGroup(gid)` → `writeNote(gid)`
- 相关工具：`mdTitleKey()` 标题比对键、`titleFromFileName()` 取标题、`decodeMdBytes()` 解码、`newNoteId(used)` 生成不冲突 id、`ensureImportGroup()` 取/建「导入」分组、`positionMenu()` 浮层定位、`clearPendingMd()` 放弃待保存文件

### 纯文本（TAB #pageText）与 SQL 文件（TAB #pageSql）
- **纯文本**：与 Markdown 笔记**完全独立**的数据（vault `textNotes`），**不做任何 Markdown 渲染**——正文原样进等宽 textarea（编辑）与等宽只读区 `#textPre`（阅读），摘要/标题/搜索全取原文（不走 `extractPlainText`），页面里没有 `md-preview` / `md-toolbar`。**阅读 / 编辑模式与笔记模块同口径**：点列表 = 阅读模式（`#textViewer` 用 `textContent` 原样输出），「✏️ 编辑」→ `#textEditor`，「💾 保存」后**留在编辑模式**（保留原 timestamp），「↩ 取消」丢弃改动（已有笔记回阅读、新笔记放弃），「↩ 关闭」回空状态，`Ctrl+Enter` 也保存；**不做自动保存**（与显式保存/取消互斥）；落库失败回滚内存；锁定清空内存与 DOM 明文。
- **SQL**：侧栏是**它自己的分组树**（`sqlGroups` + `#sqlTree`，与笔记分组互不影响；＋ 新建分组 / 子分组、✎ 改名、↔ 移动（防环）、✕ 删除后条目回落「未分组」，删除时监听绑定也回落）；导入入口「📥 导入 SQL ▾」（`#sqlImportMenu`）二选一：**📂 按目录批量导入**（内联面板 `#sqlImportPanel` → `sql_scan_dir` → 逐个 `sql_read_file`（UTF-8/UTF-16/GBK，只剥 BOM 不 trim），落到**当前选中的 SQL 分组**）／ **📄 打开单个 SQL 文件**（`#sqlOpenInput` → `decodeMdBytes` → 弹 SQL 分组选择器 → `saveSqlToGroup`，同名同目录内容一致则跳过、有变化则更新）。上限 `MAX_SQL_FILES`(500) / `MAX_SQL_TOTAL_BYTES`(6MB)，单文件 >2 MiB 由 Rust 跳过；结果复用 `#importModal`。分组选择器复用 `#moveMenu`（模式 `sql` / `sql-multi` / `sql-group` / `sql-save` / `sql-watch` / `sql-watch-new`）。查看**只读**：`sqlPre.textContent` + 「只读」标记，可 📋 复制 / 🗑️ 删除（只删应用内副本）。
- **SQL 多选（批量删除 / 移动，与笔记模块同口径）**：`selectedSqlIds`(Set) + `lastSelSqlId`（Shift 锚点）；Ctrl/⌘ 点击切换、Shift 点击按 `sqlVisibleIds()` 连选、普通点击先 `clearSqlSelection()` 再查看；选中叶子加 `.multi-sel` 且图标变 ☑；侧栏出现 `#sqlSelBar`（已选 N 个 + 📁 移动 + 🗑️ 删除 + ✕ 取消）。批量移动走 `sql-multi` 模式（跨分组用哨兵 `\u0000mixed` 使都不标 ✓），`deleteSqlFiles(ids)` 只删应用内副本（确认文案写明磁盘文件不受影响）、落库失败回滚内存，`deleteSqlFile(id)` 只是 `deleteSqlFiles([id])` 的包装；锁定即清空多选。
- **搜索（纯文本 / SQL 同口径）**：`textNoteMatches(t,q)`（标题 + 内容）与 `sqlFileMatches(f,q)`（标题 + 内容 + 相对路径）是纯函数；命中时列表行显示 `matchSnippet()` 的 ±20 字片段（`<mark>` 高亮，先转义再拼装），空结果里写明搜索范围。
- **侧栏宽度**：笔记 / 纯文本 / SQL / JSON 历史栏**四处共用** `applySidebarWidth()` 与 `startSidebarResize(e, sideEl)`（JSON 历史栏手柄 `#jsonResizer`，其 DOM 引用命名为 `jsonHistoryPane`，避免与 `jsonHistory` 数组重名）；默认 240px、160~560 且受窗口约束、双击恢复默认、拖动结束才落库、窗口尺寸变化时重算。
- 这两份数据**不经只读桥外发**（`buildBridgeSnapshot()` 仍只含 notes + groups）。**SQL 模块只读**：查看区是 `<pre>` + 「只读」标记（`.ro-badge`），页面里没有 textarea / contenteditable，前端也没有写回 SQL 的函数。

## UI 设计模式

- **玻璃效果**: `backdrop-filter: blur()` + 半透明 `rgba` 背景
- **圆角**: 大圆角（20-40px）营造柔和感
- **配色**: 黑白灰（monochrome）——主色/文字用近黑（`#111111`），背景近白（`#f0f0f0`），玻璃面板为半透明白，边框/次要文字用不同深浅灰阶；警示（错误/危险）亦为黑白灰表达，不使用彩色
- **响应式**: `@media (max-width: 860px)` 左右布局改纵向；`480px` 适配移动端
- **自定义滚动条**: 4px 宽，圆角轨道和滑块
- **Tauri 窗口**: `src-tauri/tauri.conf.json` 主窗口 960×640（`minWidth` 860 / `minHeight` 540，适配左右布局），**`maximized: true` 启动即最大化**（用户要求；`center` 仅对还原后的尺寸生效）

## 开发注意事项

1. **加密不可恢复** — PIN 即解密密钥，忘 PIN = 数据永久丢失（客户端加密固有取舍）。改 PIN 表单与首启提示已明示。

2. **仅桌面可用（浏览器模式已关闭）** — 前端 `init()` 检测 `window.__TAURI_INTERNALS__`，非 Tauri 环境（任何浏览器直开 `file://` 或 `localhost:1420`）一律显示横幅并阻止运行，不落任何数据。`crypto.subtle` 缺失（非安全上下文）同样阻止。

3. **PBKDF2 派生耗时** — 600000 次迭代约几十~200ms，解锁期间有 `unlocking` 防重入标志。

4. **XSS 防护** — 所有注入点（`mdPreview`、树叶子、分组名、移动菜单）一律经 `mdToHtml`/`escapeHtml` 后再 `innerHTML`，不得拼接原始用户输入。新增渲染逻辑时需保持「先转义后拼装」管线：`mdToHtml` 内部**先整体 `escapeHtml` 再拼装修剪过的受控标签**，因此行内替换时捕获组已经是转义后的实体文本，**不得再次 `escapeHtml`**（会双重转义 `&`），URL 一律先过 `safeUrl` 白名单。

5. **ID 生成** — 笔记 id 用 `Date.now() + Math.random()`，分组 id 用 `g_` + 时间戳 + 随机。单用户本地应用可接受理论碰撞概率。

6. **数据迁移** — 旧版明文（`light_notes_data`/`light_notes_pin`）首次启动时自动迁移为加密 vault，用原 PIN 派生密钥，删除旧键。

7. **事件委托** — 合并树（`#groupTree`，含分组节点与笔记叶子）通过单一事件委托绑定，`renderGroupTree()` 后无需重新绑定。

8. **异步持久化** — 所有持久化操作为 async（`crypto.subtle` 异步），事件处理器内 fire-and-forget + `try/catch`。`persistData()` 必须**先 `localStorage.setItem` 成功、再更新内存 `vault`**：否则写入失败（如 `QuotaExceededError`）后内存 `vault` 已含未落库数据，调用方回滚内存数组也会在下次解锁时被「复活」（Markdown 导入的失败回滚路径依赖此顺序）。

9. **托盘（关闭即驻留 / 开机自启隐藏）** — `lib.rs` 启用 `tray-icon` feature：托盘菜单「显示主窗口 / 退出轻记」，左键单击托盘图标显示窗口；窗口关闭按钮 → `prevent_close()` + `hide()`，应用常驻托盘，只能经托盘「退出」真正结束进程。启动参数含 `--autostart`（开机自启写入的值）时 `setup` 先隐藏主窗口，仅驻留托盘等待点击。

10. **打包（exe 安装包 / 更新安装包）** — 一键脚本：双击根目录 `package.bat`（**GBK + CRLF**，勿改成 UTF-8/LF，否则 cmd 解析会错位）或命令行 `npm run build`（= `tauri build`）。`beforeBuildCommand` 先执行 `node scripts/prepare-dist.mjs` 把 `notes.html` 复制进 `dist/`（`frontendDist` 指向 `../dist`，避免内嵌 node_modules/target）；`bundle.targets` 为 `["nsis"]`，首次打包自动下载 NSIS 工具链（需联网），产出**单文件 exe 安装包** `src-tauri/target/release/bundle/nsis/轻记_<版本>_x64-setup.exe`（当前 1.9.0）；NSIS 语言含简体中文。安装包默认在目标机缺失 WebView2 时联网下载运行时（默认 webviewInstallMode）。
    - **脚本流程**（0 前置检查 node/notes.html → 1 读取当前版本号并校验 5 处一致 → 2 询问是否升版本 → 3 node_modules → 4 NSIS 工具链镜像 → 5 NSIS/MSI → 6 构建 → 7 清理旧版本安装包 + 定位产物）：版本号读自 `tauri.conf.json`，提示里直接给出 patch/minor/major 三种升级后的版本号；选择升级时调用 `node scripts\bump-version.mjs <级别>` 同步 5 处后再构建，使产物文件名与版本号始终一致。
    - **产物定位按版本精确匹配** `*_<版本>_x64-setup.exe`（不再「取目录里最新的 exe」，避免发错版本）；找不到时列出目录内 exe 让人工确认。
    - **打包成功后自动删除旧版本安装包（用户明确要求「每次打包后都删除旧版本的 exe」）**：第 7 步先 `call node scripts\clean-old-bundles.mjs --keep %APP_VER% <nul>`，再 `explorer /select` 打开目录（**打开那一刻目录里只剩本次版本**；手动清理用 `npm run clean:bundles`，`--dry-run` 只看不删）。脚本递归扫整个 bundle 目录，**只删文件名里带版本号的安装包**（`<名称>_<x.y.z>_<目标段>.exe|.msi`，MSI 目标段自带下划线故不能排除 `_`），`light-notes.exe` 之类不带版本号的文件一律不碰；**安全阀**：找不到 `--keep` 版本的产物就一个都不删、只警告——避免将来命名规则变化时误删成空。
    - **脚本内的坑（勿踩）**：① 调 `node`/`npm` 必须写 `call node ...`（本机 `node` 可能是 `.cmd` 包装器，不加 `call` 会让脚本静默结束）；② node 调用加 `<nul`（否则消费掉重定向 stdin，后面 `set /p` 读不到输入）；③ 取版本号用「node 输出到临时文件 + `set /p` 读回」，不用 `for /f` 管道捕获。
    - **国内下载 NSIS/WiX 失败**：走镜像环境变量 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR`（前缀式，如 `https://gh-proxy.com`；实测另有 ghfast.top / ghproxy.net）或 `..._TEMPLATE`（模板式 `<owner>/<repo>/releases/download/<version>/<asset>`）；`package.bat` 在工具链未缓存时会询问是否走镜像。缓存目录 `%LOCALAPPDATA%\tauri\NSIS`，下过一次就不再联网。

11. **版本号与升级发布流程** — 版本号在 `tauri.conf.json`/`Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` 五处，由 `scripts/bump-version.mjs` 以 `tauri.conf.json` 为唯一事实来源统一改写（**当前 1.9.0**）。三种用法：
    - `npm run bump -- minor`（或 `patch` / `major`）= `node scripts/bump-version.mjs <级别>`：提升并同步 5 处；
    - `node scripts/bump-version.mjs <级别> --dry-run`：只打印提升后的版本号（不写文件，`package.bat` 用它生成选项文案）；
    - `node scripts/bump-version.mjs check`：校验 5 处是否一致（一致退出码 0，不一致打印差并退 1）。
    两种发布方式：① **直接在 `package.bat` 里选升级级别**（推荐，脚本会调 bump 再构建，版本号与产物文件名必然一致）；② 先手动 `npm run bump -- minor` 再运行 `package.bat` 并选「不升级」。
    - **bump 脚本只改这 5 处文本，不触发 cargo 解析**（不联网），因此不会像 `cargo fetch`/`cargo update` 那样重写整个 `Cargo.lock`。
    - `notes.html` 里**不再硬编码版本号**（关于页运行时向 `plugin:app|version` 取），故无需在第六处维护。

12. **更新安装包不破坏本地数据** — 新版本 setup.exe 在旧版本机器上双击进入 NSIS **升级模式**（UpdateMode）：结束正在运行的旧程序（GUI 询问后自动关闭）、不触发卸载器删除动作，仅替换安装目录文件；笔记等数据位于 WebView2 配置目录（`%LOCALAPPDATA%\com.lightnotes.app`，localStorage），升级与手动卸载（默认不勾选「删除应用数据」）均不触碰。NSIS 卸载器仅在非更新模式手动卸载时删除 `HKCU Run` 开机启动值（值名与 productName「轻记」一致），故升级后开机启动设置保留。注意：`bundle.identifier` 一旦发布不可更改，否则会换数据目录导致「数据丢失」假象。

13. **Markdown 导入（零依赖实现）** — 目录选择不用 `tauri-plugin-dialog`（会加 Cargo 依赖 + capability 白名单），而是隐藏 `<input webkitdirectory>`：WebView2 是 Chromium，会弹系统「选择文件夹」对话框，内容经 `FileReader` 直读，**不需要文件系统权限**（不引入 `tauri-plugin-fs`）；单个文件用普通 `<input type="file" accept=".md,…">`。两者都需要用户手势，故 `input.click()` 必须由点击处理器同步调用。编码回退靠 Chromium 内置 `TextDecoder('gbk')`。目录导入**扁平**归入「导入」分组、**按标题与全部笔记比对后跳过已有**；单个文件是**先读进编辑器、点保存时才选分组**（不参与跳过判断）。若日后要与系统对话框深度集成或读非 UTF-8/GBK 编码，再考虑 `tauri-plugin-dialog` + Rust 侧 `std::fs` 扫描。

14. **本地只读桥（暴露给本机工具的安全约束）** — 该通道是**唯一**会把明文笔记带出应用的能力，改动时必须守住这几条：① 只绑定 `127.0.0.1`（**绝不 `0.0.0.0`**）且端口随机；② 所有端点强制 `Authorization: Bearer <token>`，令牌每次解锁重新生成，锁定即停止监听并删除发现文件；③ **只有 GET**，不得新增任何写入/删除端点（否则 agent 可以改笔记）；④ 快照**只含有效笔记与分组**，`trash` 与 `jsonHistory` 永不外发（`buildBridgeSnapshot()` 是唯一快照入口）；⑤ 开关默认关闭、状态存 `light_notes_ui.bridgeEnabled`，`init()` 启动时先停一次以清掉页面重载后 Rust 侧残留的旧快照。另需知悉的既有事实：4 位 PIN 的离线穷举成本极低（本机实测 600k 次 PBKDF2 单次派生 83ms，10⁴ 空间 12 进程并行约 40 秒），即**能读到 leveldb 密文的进程本来就能拿到全部明文**——所以本通道的安全设计重点在「授权显式化 + 不落盘 + 可停止」，而不是提高加密强度；不要把 PIN 写进任何配置文件或环境变量来「方便」工具读取。

15. **目录监听（只认新增 / 删除，且不写用户的文件）** — `src-tauri/src/watch.rs` 是**纯读取**的：只用 `read_dir`/`metadata`/`read`/`canonicalize`，**不得新增任何 `fs::write`/`remove_file`/`create_dir`**（唯一例外是 `browse_dir` 删自己的临时文件）；`watch_read` 的路径必须经 `resolve_inside()` 校验落在绑定目录内（拒绝绝对路径与 `..`、canonicalize 后比对前缀），并有 2 MiB 单文件上限与 5000 文件 / 深度 8 的扫描上限。语义红线：**只把「路径集合的差集」当事件**——不要引入 mtime/size 比较（那样会导致「保存文件就覆盖笔记」）；`known` 登记表是防重复与跨重启补跑的唯一依据，落库成功后才回写；读取失败/空文件要登记为 `null` 以免每轮重试；新增笔记时绑定的分组若已不存在必须回落到「未分组」（否则笔记会挂到空分组上不可见）；一批事件处理完要 `persistData()`（顺带经只读桥同步给 DSH）。监听线程生命周期必须绑解锁状态：解锁才 `watch_start`，锁定 `watch_stop`，`init()` 先停一次清残留。

16. **Tauri 命令：做 I/O 的必须写成 `async fn`（否则卡 UI 主线程）** — 已核实实现：`tauri-macros` 的 `body_blocking` 对同步命令是**内联执行**（`let result = $path(...)`），它跑在 IPC 回调线程上，Windows 上就是 **UI 主线程**；只有 `async fn` 才会经 `async_runtime::spawn` 抛到工作线程。所以凡是要**解析大 payload / 读文件 / 遍历目录 / 起子进程 / join 线程**的命令一律写 `async fn`——本项目 21 个命令（`bridge_*` 4 + `watch_*` 7 + `export_*` 4 + `sql_*` 3 + `autostart_*` 2 + `session_poll` 1）全部如此，新增命令同样适用。**参数契约**：Rust 端签名是 `payload: Value` 的命令，前端必须写 `invoke(cmd, { payload: {...} })`（漏掉包装会报 `missing required key payload`，测试已按命令逐一守卫）。历史教训：这些命令最初都是同步 `fn`，于是「点设置页 → 切回笔记」明显卡顿。前端配套两条规矩：① 切页这类交互不要在同一帧里串起跨进程调用——用 `requestAnimationFrame` 把设置页的读取推到本帧绘制之后；② 跨进程结果回来时用 `settingsVisible()` 守卫，别再去写已隐藏页面的 DOM。注意 async 命令体仍占一个 worker（长时间阻塞如系统对话框），更重的阻塞 I/O 改用 `tauri::async_runtime::spawn_blocking`。守卫见测试「Rust 命令不得阻塞 UI 主线程」与「切页不被跨进程工作拖慢」两节。

17. **子进程不得弹出控制台窗口（Windows）** — 从 GUI 进程（Tauri 应用没有控制台）启动 `reg.exe` / `powershell.exe` 这类控制台程序时，Windows 默认给子进程**新建一个控制台窗口**（用户实测「每次切到设置页都闪一个命令行弹窗」；`浏览…` 起 PowerShell 时同样会闪整个对话框时长）。修法：凡 spawn 控制台程序都必须设 `CREATE_NO_WINDOW`（`0x0800_0000`），本项目统一走 `crate::hide_console(&mut cmd)`（`lib.rs`，`std::os::windows::process::CommandExt::creation_flags`）。写法要求**两步式**（`let mut cmd = Command::new(..); cmd.args(..); hide_console(&mut cmd); cmd.output()`），不要用链式写法（没有插入点，必然漏掉隐藏窗口），`.spawn()` 同理不用。守卫见测试「子进程不得弹出控制台窗口」（含对链式写法的反向检查），`export.rs` 的两个 PowerShell 对话框同样纳入统计。

18. **导出写盘（唯一会改动用户磁盘的能力）** — `src-tauri/src/export.rs` 是仓库里唯一 `fs::write` 用户文件的地方（只读桥只读、目录监听只读，见 14/15），改动时必须守住：① **只写、只创建**——不删不移动不重命名已有文件，不替用户建目录树（目标目录必须已存在）；② 文件名一律过 `sanitize_file_stem()`（取最后一段分量、非法字符与控制字符换 `_`、折叠空白、避开 Windows 保留名 CON/PRN/AUX/NUL/COM1-9/LPT1-9、截断 120 字符、强制 `.md`）；③ **同名默认不覆盖**（`plan_names()` 批内去重 + 与目录现有文件避让并上报 `renamed`），只有前端勾了「覆盖同名文件」才覆盖；④ 拼出的路径必须仍在目标目录内（`full.parent() != Some(root.as_path())` 这道闸不能删）；⑤ 上限 2000 文件 / 单篇 8 MB / 单批 64 MB；⑥ **不接触 PIN/密钥/密文**。另：PDF 走 `window.print()` + `@media print`，不做静默 `PrintToPdfAsync`（要引 `webview2-com` 与 unsafe COM，违背零依赖）；`#printRoot` 必须排在脚本块之前，打印样式里必须解除 body 的 `100vh` flex 与 `.md-preview` 的 `overflow-y:auto`（否则 PDF 只印一屏、内容被截断），且**打印期间不得清空 `#printRoot`**。守卫见测试「导出：接线与安全约束」，含 Rust 侧把两个对话框脚本交给 PowerShell 解析器做语法自检。

19. **SQL 目录导入（只读，且不执行 SQL）** — `src-tauri/src/sql_import.rs` 与 `watch.rs` 同口径：只用 `read_dir`/`metadata`/`read`/`canonicalize`，**不得新增任何写操作**；`sql_read_file` 的路径必须经 `watch::resolve_inside()` 校验落在用户指定目录内，并有单文件 2 MiB / 单次 1000 文件 / 20000 目录项 / 深度 8 上限；选目录复用 `export::pick_folder`（自带 `hide_console`），**不自己起子进程**。前端**只读不写、不执行** SQL：导入是单向往 vault 存副本，删除只删应用内副本，绝不动磁盘文件。守卫见测试第 14 节。

## 项目规则

- **修改日志**: 每次对项目代码作出改动时，必须将改动摘要记录到 `modified.md` 文件中。格式要求：记录改动时间、改动文件、改动内容简述。
