# 轻记 · 四码笔记

> 一款极简的 Windows 桌面笔记应用：四位 PIN 码锁屏，数据在本机加密存储，不联网、无账号、无遥测。

界面黑白灰 + 毛玻璃（glassmorphism），单个 HTML 文件承载全部前端逻辑，零前端框架、零运行时依赖。

---

## 亮点

- **四位 PIN 锁屏** —— 输入第 4 位自动解锁，无按钮、无图标，只有一个输入框。
- **本机加密** —— PBKDF2-SHA256（600,000 次迭代）派生密钥 + AES-GCM 加密，数据只落在本机 WebView2 的 `localStorage`；不存 PIN、不存哈希，错误密钥由解密鉴权标签自然拒绝。
- **零依赖 Markdown** —— 自写解析器（CommonMark 核心 + GFM 表格 / 任务列表 / 删除线），实时预览，16 键工具栏；所有输出先转义再拼装，URL 走协议白名单。
- **本地目录双向绑定** —— 把本地文件夹绑到某个分组：目录里**新增** Markdown 自动成笔记，文件**删除**笔记进回收站（内容修改不覆盖，尊重你自己的文件）。
- **给 AI 工具开一扇只读窗** —— 内置只读本地桥 + 零依赖 MCP 服务器，让本机 agent（如 DeepSeek Harness）在解锁期间按 id / 标题 / 分组只读读取笔记；锁定即断流。
- **系统锁屏联动** —— Win+L 或屏保锁定后自动锁定笔记，回到 PIN 锁屏。
- **托盘常驻 / 开机自启** —— 关窗口不退出，驻留系统托盘。

## 功能一览

| TAB | 能力 |
|---|---|
| 📒 笔记 | Markdown 编辑 + 实时预览；任意层级分组树（文件管理器式，笔记直接挂在分组下）；多选批量移动 / 删除；回收站（30 天自动清理）；全文搜索；Markdown **目录导入**或**打开单个文件**；单篇导出 `.md` / PDF |
| 📝 纯文本 | 与 Markdown 完全隔离的原文笔记，等宽字体、**不做任何 Markdown 渲染**；阅读 / 编辑两模式，搜索带命中片段 |
| 🗄️ SQL | 导入本地 `.sql` 文件按目录批量建档（只读副本、不执行 SQL），独立分组树；多选批量移动 / 删除；可绑定 SQL 目录监听源文件增删 |
| 🧾 JSON 浏览器 | 粘贴 JSON → 格式化查看并自动存历史（上限 100 条），一键复制 |
| ⚙️ 设置 | 开机自启、修改 PIN、本地工具读取开关、Markdown / SQL 目录监听管理、批量导出（可勾选分组整棵子树） |

## 安全边界（请先读）

- **PIN 即密钥，忘记不可恢复** —— 客户端加密的固有取舍，没有任何后门或重置通道。
- **4 位 PIN 的强度有限** —— 10⁴ 空间对拿到本机密文的攻击者而言可以被离线穷举。该设计的重点是「随手锁住屏幕上的内容」，而不是抵抗本机取证；安全模型详见 `CLAUDE.md`。
- **只读桥是唯一把明文带出应用的通道** —— 只绑 `127.0.0.1`、端口随机、仅 GET、每次解锁重新签发令牌、开关默认关闭、锁定立即停止并删除发现文件。
- 应用不做任何联网请求。

## 环境要求

- Windows 10/11（NSIS 安装包与系统锁屏联动均为 Windows 专有实现）
- Node.js 18+ 与 Rust 工具链（仅从源码构建时需要；安装包用户只需 WebView2，缺失时安装器会引导下载）

## 从源码运行

```powershell
npm install
npm run dev      # = tauri dev，前端由 npx serve 提供在 http://localhost:1420
```

> 应用**仅作为 Tauri 桌面应用运行**：浏览器直接打开会被环境检测拦住，不落任何数据，也不降级为明文。

## 打包

```powershell
npm run build    # = tauri build
```

或双击根目录 `package.bat`（一键流程：校验版本号一致 → 可选升版本 → 准备依赖 → 构建 → 清理旧安装包 → 打开产物目录）。

产物：`src-tauri/target/release/bundle/nsis/轻记_<版本>_x64-setup.exe`（单文件安装包）。
版本号以 `src-tauri/tauri.conf.json` 为唯一事实来源，`npm run bump -- patch|minor|major` 会同步仓库内 5 处版本号，`check` 子命令校验一致性。

## 测试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust：只读桥 / 目录监听 / 导出 / SQL 导入 / 系统锁屏
node tools/light-notes-mcp/test/run.mjs                 # Node：客户端与 MCP 协议行为 + 前端静态不变量（当前 723 项）
```

Node 侧用假桥验证真实 HTTP 行为，并从 `notes.html` 提取函数做行为断言，另外守住一批静态红线：只读桥只绑回环、目录监听与 SQL 导入不得写用户文件、Tauri 命令必须 `async`（否则卡 UI 主线程）、子进程必须 `CREATE_NO_WINDOW`（否则闪黑框）、导出默认不覆盖同名文件等。

## 仓库结构

```
notes.html                    前端全部实现（HTML + CSS + JS，单文件 IIFE）
src-tauri/
  src/lib.rs                  应用装配、托盘、开机自启命令、hide_console
  src/bridge.rs               本地只读 HTTP 桥（零依赖，仅回环）
  src/watch.rs                目录监听（新增 / 删除差集）
  src/sql_import.rs           SQL 目录扫描与只读读取
  src/export.rs               导出写盘 + 系统对话框
  src/session.rs              系统锁屏联动（WTS 会话通知）
  tauri.conf.json             窗口、打包、版本号唯一事实来源
tools/light-notes-mcp/        零依赖 Node MCP 服务器 / CLI / 测试
scripts/                      打包前复制、版本号 bump、旧安装包清理
package.bat                   一键打包
CLAUDE.md                     架构、数据模型与开发注意事项（改代码前请读）
modified.md                   改动日志
```

## 数据存在哪

笔记 / 分组 / 回收站 / 纯文本 / SQL 副本 / JSON 历史 / 目录监听绑定**全部**序列化进一个加密保险库，写在本机 WebView2 用户目录（`%LOCALAPPDATA%\com.lightnotes.app`）。
升级安装包、卸载（默认不勾选「删除应用数据」）都不会触碰这些数据。

## 授权

仓库暂未附带开源许可证文件；如需他人复用，请先补 `LICENSE`。
