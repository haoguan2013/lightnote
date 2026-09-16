#!/usr/bin/env node
// 轻记只读桥 —— 命令行客户端（零依赖）
//
// 用途：在没有 MCP 配置、或需要人工核对时，直接从命令行读取「轻记」笔记。
// 与 MCP 服务器共用同一份工具实现（tools.mjs），因此输出格式完全一致。
//
// 用法：
//   node notes-cli.mjs status
//   node notes-cli.mjs list [--group 分组] [--limit N]
//   node notes-cli.mjs search <关键字> [--limit N]
//   node notes-cli.mjs read <id | 标题>
//   node notes-cli.mjs groups
//   任意子命令追加 --json 可打印接口原始 JSON
import { callBridge, BridgeUnavailableError } from './bridge-client.mjs';
import { runTool } from './tools.mjs';

const USAGE = `轻记只读桥 CLI

用法：
  node notes-cli.mjs status
  node notes-cli.mjs list [--group 分组] [--limit N]
  node notes-cli.mjs search <关键字> [--limit N]
  node notes-cli.mjs read <id | 标题>
  node notes-cli.mjs groups
  （任意子命令加 --json 输出接口原始 JSON）

前置条件：轻记应用已启动并解锁，且「设置 → 安全 → 本地工具读取」已打开。`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--group') flags.group = argv[++i];
    else if (a === '--limit') flags.limit = Number(argv[++i]);
    else if (a === '-h' || a === '--help') flags.help = true;
    else positional.push(a);
  }
  return { positional, flags };
}

async function rawJson(cmd, positional, flags) {
  switch (cmd) {
    case 'status': return callBridge('/health');
    case 'groups': return callBridge('/groups');
    case 'list': return callBridge('/notes');
    case 'search': {
      const q = positional[1];
      if (!q) throw new Error('search 需要关键字');
      const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
      return callBridge(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    }
    case 'read': {
      const key = positional[1];
      if (!key) throw new Error('read 需要 id 或标题');
      if (/^\d+$/.test(key)) return callBridge(`/notes/${key}`);
      const list = await callBridge('/notes');
      const key2 = key.trim().toLowerCase();
      const exact = (list.notes || []).filter((n) => String(n.title || '').trim().toLowerCase() === key2);
      const hits = exact.length ? exact : (list.notes || []).filter((n) => String(n.title || '').toLowerCase().includes(key2));
      if (hits.length !== 1) return { ambiguous: hits.length, candidates: hits };
      return callBridge(`/notes/${hits[0].id}`);
    }
    default: throw new Error(`未知子命令：${cmd}`);
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd || flags.help) {
    process.stdout.write(USAGE + '\n');
    return cmd ? 0 : 1;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(await rawJson(cmd, positional, flags), null, 2) + '\n');
    return 0;
  }

  let out;
  switch (cmd) {
    case 'status': out = await runTool('notes_status', {}); break;
    case 'groups': out = await runTool('notes_groups', {}); break;
    case 'list': out = await runTool('notes_list', { group: flags.group, limit: flags.limit }); break;
    case 'search': out = await runTool('notes_search', { query: positional[1], limit: flags.limit }); break;
    case 'read': {
      const key = positional[1];
      if (!key) throw new Error('read 需要 id 或标题');
      out = /^\d+$/.test(key)
        ? await runTool('notes_read', { id: Number(key) })
        : await runTool('notes_read', { title: key });
      break;
    }
    default:
      process.stderr.write(USAGE + '\n');
      return 1;
  }

  process.stdout.write(out.text + '\n');
  return out.isError ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    const msg = e instanceof BridgeUnavailableError ? e.message : `失败：${e && e.message ? e.message : String(e)}`;
    process.stderr.write(msg + '\n');
    process.exit(1);
  });
