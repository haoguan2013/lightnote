# 轻记 ↔ DeepSeek Harness 只读桥（tools/light-notes-mcp）

把「轻记」中**已解锁**的笔记以**只读**方式提供给本机工具（DeepSeek Harness 等）。
零依赖：只用 Node 内置模块。

## 安全模型（重要）

- **解密只发生在轻记应用内**：本目录的所有代码只消费轻记推送的快照，不接触 PIN、不持有密钥、不读 leveldb。
- 只读接口**只绑定 127.0.0.1**（端口随机），**只有 GET 查询端点**，没有任何写入/删除能力。
- 每次解锁重新生成访问令牌；令牌与端口写在发现文件里，所有请求必须带 `Authorization: Bearer <token>`。
- **锁定应用立即停止监听并删除发现文件**；开关默认关闭，必须在「设置 → 安全 → 本地工具读取」显式打开。
- 快照**只含有效笔记与分组**，回收站与 JSON 历史不会被提供。
- 已知边界：笔记内容一旦被读进 agent，就会进入模型上下文、会话记录与后续记忆；本机其它以当前用户身份运行的进程也能读到发现文件与令牌。

## 前置条件

1. 「轻记」应用已启动；
2. 已输入 PIN 解锁；
3. 「设置 → 安全 → 本地工具读取」开关已打开（默认关闭）。

三者缺一，工具会返回明确的指引文本（不会静默失败）。

## 命令行用法

```powershell
node tools\light-notes-mcp\notes-cli.mjs status
node tools\light-notes-mcp\notes-cli.mjs list --group 工作 --limit 20
node tools\light-notes-mcp\notes-cli.mjs search 关键词
node tools\light-notes-mcp\notes-cli.mjs read 12
node tools\light-notes-mcp\notes-cli.mjs read "访谈记录"
node tools\light-notes-mcp\notes-cli.mjs groups
# 任意子命令加 --json 输出接口原始 JSON
```

## 只读接口一览（供其它客户端直接使用）

| 端点 | 说明 |
|---|---|
| `GET /health` | 是否可用、端口、pid、笔记/分组数量、快照时间 |
| `GET /notes` | 笔记元数据列表（含分组路径、字节数、开头 120 字预览） |
| `GET /notes/{id}` | 单篇笔记全文（Markdown 原文） |
| `GET /search?q=&limit=` | 按标题+正文搜索（大小写不敏感），返回命中片段 |
| `GET /groups` | 分组树（路径与直接笔记数） |

发现文件：`%LOCALAPPDATA%\com.lightnotes.app\bridge.json`

```json
{ "app": "light-notes", "readOnly": true, "port": 51234, "token": "<64 hex>", "pid": 1234, "since": 1700000000000 }
```

## 接入 DeepSeek Harness（MCP）

在 DSH 的 profile patch 里加一行 MCP 服务器（`%APPDATA%\dsh-desktop\harness\profiles\<profile>\cordis.patch.yml`）：

```yaml
- insert:
    - id: mcp-light-notes
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: light_notes
        transport: stdio
        command: node
        args:
          - 'D:\Projects\tauri-notes\tools\light-notes-mcp\server.mjs'
        # 单次调用超时（读取大笔记留足余量）
        toolCallTimeoutMs: 30000
        # 轻记未解锁/未开启时不要拖垮 harness 启动
        failOnStartupError: false
```

保存后重载插件或重启 harness，即可看到工具：
`mcp__light_notes__notes_status`、`notes_list`、`notes_search`、`notes_read`、`notes_groups`。

> 若自定义了发现文件位置（环境变量 `LIGHT_NOTES_BRIDGE`），需在同一行的 `env` 里显式转发该变量。

## 测试

```powershell
node tools\light-notes-mcp\test\run.mjs
```

测试会起一个**假桥**（模拟轻记的接口与鉴权）验证客户端与工具逻辑，并对
`notes.html` / `src-tauri/src/bridge.rs` 做静态回归检查（只读、绑定 127.0.0.1、
不含回收站与 JSON 历史、锁定即停等不变量）。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 「读不到发现文件」 | 应用未启动、未解锁，或开关未打开 |
| 「连接被拒绝」 | 应用在读取瞬间被锁定/退出（锁定会立即断流）；重新解锁即可 |
| 「缺少或错误的访问令牌」 | 发现文件是上一次解锁的旧副本；重新解锁后重试 |
| 工具调用报 401/超时 | MCP 子进程缓存了旧发现文件路径；重启 harness，或先手工跑 `notes-cli.mjs status` 确认 |
