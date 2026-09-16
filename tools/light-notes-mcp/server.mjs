#!/usr/bin/env node
// 轻记 stdio MCP 服务器（零依赖）
//
// 把「轻记」的本地只读接口包装成 MCP 工具，供 DeepSeek Harness 等 MCP 客户端调用：
//   notes_status / notes_list / notes_search / notes_read / notes_groups
// 协议：JSON-RPC 2.0，stdin/stdout 换行分隔（MCP stdio transport）。
// 注意：stdout 只输出协议消息，任何日志一律走 stderr。
import { TOOLS, runTool } from './tools.mjs';

const PROTOCOL_FALLBACK = '2025-06-18';
const SERVER_INFO = { name: 'light-notes', version: '1.0.0' };
const INSTRUCTIONS =
  '轻记（Light Notes）只读笔记工具。仅在「轻记」应用已启动、已解锁，且「设置 → 安全 → 本地工具读取」'
  + '开关打开时可用（默认关闭；锁定应用会立即断开）。只读：没有任何写入或删除笔记的能力。'
  + '回收站与 JSON 历史不会被提供。';

function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(...parts) {
  process.stderr.write('[light-notes-mcp] ' + parts.join(' ') + '\n');
}

function reply(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * 处理一条 JSON-RPC 消息。send 参数便于测试注入（默认写 stdout）。
 * 返回值无意义；响应一律通过 send 发出。
 */
export async function handleMessage(msg, send = writeMessage) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  const replyVia = (result) => send({ jsonrpc: '2.0', id, result });
  const replyErrVia = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      replyVia({
        protocolVersion: typeof (params && params.protocolVersion) === 'string'
          ? params.protocolVersion
          : PROTOCOL_FALLBACK,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
      return;

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;   // 通知不需要响应

    case 'ping':
      if (isRequest) replyVia({});
      return;

    case 'tools/list':
      if (!isRequest) return;
      replyVia({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;

    case 'tools/call': {
      if (!isRequest) return;
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (typeof name !== 'string') {
        replyErrVia(-32602, 'tools/call 缺少 name');
        return;
      }
      const out = await runTool(name, args);
      replyVia({
        content: [{ type: 'text', text: out.text }],
        isError: !!out.isError,
      });
      return;
    }

    default:
      if (isRequest) replyErrVia(-32601, `未实现的方法：${String(method)}`);
      return;
  }
}

// ---------- stdio 循环（换行分隔的 JSON-RPC） ----------

function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log('忽略无法解析的行（不是 JSON-RPC 消息）');
        continue;
      }
      Promise.resolve()
        .then(() => handleMessage(msg))
        .catch((e) => {
          const id = msg && msg.id;
          if (id !== undefined && id !== null) replyError(id, -32603, `内部错误：${e && e.message ? e.message : e}`);
          else log('处理消息失败：' + (e && e.message ? e.message : String(e)));
        });
    }
  });

  process.stdin.on('end', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  log('已启动（stdio MCP）。工具：' + TOOLS.map((t) => t.name).join(', '));
}

// 仅在被直接执行时启动 stdio 循环（被 import 时只暴露 handleMessage，便于测试）
import { pathToFileURL } from 'node:url';
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

