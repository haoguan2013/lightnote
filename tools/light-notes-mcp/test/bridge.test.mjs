// 只读桥客户端与工具的行为测试：起一个「假桥」（模拟轻记接口与鉴权），验证工具输出与错误映射。
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { section, check, contains, notContains, eq } from './helpers.mjs';

const TOKEN = 'test-token-abcdef0123456789';

// 必须在导入客户端之前指定发现文件位置（模块加载时读取该环境变量）
const tmp = mkdtempSync(join(tmpdir(), 'ln-bridge-test-'));
const discovery = join(tmp, 'bridge.json');
process.env.LIGHT_NOTES_BRIDGE = discovery;

const { runTool } = await import('../tools.mjs');

// ---------- 假桥：与 Rust 侧同一份契约（Bearer 鉴权、GET-only、同样的 JSON 形状） ----------
const NOTES = [
  { id: 2, title: '项目 A 计划', content: '第一阶段：调研\n第二阶段：实现\n' + '填充'.repeat(80) + '\n机密尾巴XYZ-仅详情可见', timestamp: 200, groupId: 'g_a' },
  { id: 1, title: '随手记', content: '买牛奶', timestamp: 100, groupId: null },
  { id: 3, title: '项目 A 计划', content: '同名但不同内容的另一篇', timestamp: 300, groupId: 'g_b' },
];
const GROUP_PATH = { g_a: '工作', g_b: '工作 / 子项目' };

function listPayload() {
  return {
    ok: true,
    count: NOTES.length,
    notes: NOTES.map((n) => ({
      id: n.id,
      title: n.title,
      groupId: n.groupId,
      groupPath: n.groupId ? GROUP_PATH[n.groupId] : '未分组',
      timestamp: n.timestamp,
      bytes: Buffer.byteLength(n.content, 'utf8'),
      preview: n.content.replace(/\n/g, ' ').slice(0, 120),
    })),
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { ok: false, error: '缺少或错误的访问令牌' });
  if (req.method !== 'GET') return send(405, { ok: false, error: '只读' });

  if (url.pathname === '/health') {
    return send(200, { ok: true, app: 'light-notes', readOnly: true, port: server.address().port, pid: 999, since: 1700000000000, generatedAt: 1700000005000, noteCount: NOTES.length, groupCount: 2 });
  }
  if (url.pathname === '/notes') return send(200, listPayload());
  if (url.pathname === '/groups') {
    return send(200, { ok: true, groups: [{ id: 'g_a', name: '工作', parentId: null, path: '工作', noteCount: 1 }, { id: 'g_b', name: '子项目', parentId: 'g_a', path: '工作 / 子项目', noteCount: 1 }] });
  }
  if (url.pathname === '/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (!q) return send(400, { ok: false, error: '缺少查询参数 q' });
    const hits = NOTES.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    return send(200, {
      ok: true, q, matched: hits.length, returned: hits.length,
      results: hits.map((n) => ({ id: n.id, title: n.title, groupPath: n.groupId ? GROUP_PATH[n.groupId] : '未分组', timestamp: n.timestamp, snippet: `…${q}…` })),
    });
  }
  const m = url.pathname.match(/^\/notes\/(\d+)$/);
  if (m) {
    const n = NOTES.find((x) => x.id === Number(m[1]));
    if (!n) return send(404, { ok: false, error: '未找到该笔记' });
    return send(200, { ok: true, note: { ...n, groupPath: n.groupId ? GROUP_PATH[n.groupId] : '未分组', bytes: Buffer.byteLength(n.content, 'utf8') } });
  }
  return send(404, { ok: false, error: '未知端点' });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
writeFileSync(discovery, JSON.stringify({ app: 'light-notes', readOnly: true, port, token: TOKEN, pid: 999, since: 1700000000000 }));

// ---------- 断言 ----------
section('桥客户端 / 工具（假桥）');

const status = await runTool('notes_status', {});
eq('notes_status 成功', status.isError, false);
contains('notes_status 报端口', status.text, String(port));
contains('notes_status 报笔记数', status.text, '3 篇');
contains('notes_status 声明只读/不含回收站', status.text, '回收站与 JSON 历史不会被提供');

const list = await runTool('notes_list', {});
eq('notes_list 成功', list.isError, false);
contains('列表含 id', list.text, '[2]');
contains('列表含分组路径', list.text, '工作 / 子项目');
eq('列表按时间倒序（最新在前）', list.text.indexOf('[3]') < list.text.indexOf('[1]'), true);

const grouped = await runTool('notes_list', { group: '子项目' });
contains('按分组过滤', grouped.text, '共 1 篇');
notContains('过滤后不含其它分组笔记', grouped.text, '[1]');

const limited = await runTool('notes_list', { limit: 1 });
contains('limit 生效', limited.text, '显示最新 1 篇');

const search = await runTool('notes_search', { query: '调研' });
eq('notes_search 成功', search.isError, false);
contains('搜索命中含 id 与片段', search.text, '[2]');

const searchMiss = await runTool('notes_search', { query: '不存在的词xyz' });
contains('未命中给出明确说明', searchMiss.text, '没有命中');
eq('未命中不算错误', searchMiss.isError, false);

const searchNoQuery = await runTool('notes_search', {});
eq('缺少 query 视为错误', searchNoQuery.isError, true);

const readById = await runTool('notes_read', { id: 2 });
eq('按 id 读取成功', readById.isError, false);
contains('读取含正文', readById.text, '第二阶段：实现');
contains('读取含元信息', readById.text, 'id 2');

const readByTitle = await runTool('notes_read', { title: '随手记' });
contains('按唯一标题读取', readByTitle.text, '买牛奶');

const ambiguous = await runTool('notes_read', { title: '项目 A' });
eq('同名标题不算错误', ambiguous.isError, false);
contains('同名标题返回候选提示', ambiguous.text, '请用 id 明确指定');
notContains('同名标题只给预览、不给完整正文', ambiguous.text, '机密尾巴XYZ');
eq('候选列表给出两个 id', ambiguous.text.includes('[2]') && ambiguous.text.includes('[3]'), true);

const notFound = await runTool('notes_read', { title: '压根不存在的标题' });
contains('未找到标题给出指引', notFound.text, '没有标题含有');
eq('未找到不算错误', notFound.isError, false);

const noArg = await runTool('notes_read', {});
eq('缺少 id/title 视为错误', noArg.isError, true);

const groups = await runTool('notes_groups', {});
contains('分组树含路径', groups.text, '工作 / 子项目');
contains('分组树含计数', groups.text, '1 篇');

const unknown = await runTool('no_such_tool', {});
eq('未知工具报错', unknown.isError, true);
contains('未知工具列出可用工具', unknown.text, 'notes_read');

// 令牌错误（发现文件被旧副本覆盖）
writeFileSync(discovery, JSON.stringify({ app: 'light-notes', port, token: 'stale-token' }));
const stale = await runTool('notes_status', {});
eq('旧令牌报错', stale.isError, true);
contains('旧令牌错误指明是旧副本', stale.text, '发现文件可能是上一次解锁留下的旧副本');
contains('旧令牌错误给出重试指引', stale.text, '重新打开开关或重启工具进程');

// 发现文件缺失（应用未解锁 / 开关未开）
rmSync(discovery);
const missing = await runTool('notes_list', {});
eq('缺发现文件时报错', missing.isError, true);
contains('缺发现文件给出三步指引', missing.text, '已输入 PIN 解锁');
contains('缺发现文件提示开关默认关闭', missing.text, '默认关闭');

// 连接被拒绝（端口合法但无人监听：先占一个端口再释放）
const probe = createServer(() => {});
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const deadPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
writeFileSync(discovery, JSON.stringify({ app: 'light-notes', port: deadPort, token: TOKEN }));
const refused = await runTool('notes_status', {});
eq('端口无服务时报错', refused.isError, true);
contains('连接被拒给出锁定提示', refused.text, '连接被拒绝');
contains('连接被拒提示锁定会断流', refused.text, '锁定会立即停止监听');

// 恢复发现文件（假桥仍在监听；后续 MCP 用例需要一条可用的通路）
writeFileSync(discovery, JSON.stringify({ app: 'light-notes', readOnly: true, port, token: TOKEN, pid: 999, since: 1700000000000 }));

// ---------- MCP 协议层（真实 handleMessage，注入 send 捕获响应） ----------
section('MCP 协议（stdio JSON-RPC 处理器）');

const { handleMessage } = await import('../server.mjs');
const captured = [];
const send = (m) => captured.push(m);
const takeLast = () => captured[captured.length - 1];

await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }, send);
const init = takeLast();
eq('initialize 回应 id', init.id, 1);
eq('initialize 回显协议版本', init.result.protocolVersion, '2025-06-18');
eq('initialize 声明 serverInfo', init.result.serverInfo.name, 'light-notes');
check('initialize 声明 tools 能力', !!init.result.capabilities.tools);
contains('initialize instructions 说明只读与前置条件', init.result.instructions, '只读');
contains('initialize instructions 说明默认关闭', init.result.instructions, '默认关闭');

const before = captured.length;
await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, send);
await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }, send);
eq('通知不产生响应', captured.length, before);

await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, send);
const listRes = takeLast();
const toolNames = listRes.result.tools.map((t) => t.name).sort();
eq('工具数量为 5', toolNames.length, 5);
eq('工具名齐全', toolNames.join(','), 'notes_groups,notes_list,notes_read,notes_search,notes_status');
check('每个工具都有描述与 inputSchema', listRes.result.tools.every((t) => t.description && t.inputSchema && t.inputSchema.type === 'object'));
const searchSchema = listRes.result.tools.find((t) => t.name === 'notes_search').inputSchema;
eq('notes_search 要求 query 参数', (searchSchema.required || []).join(','), 'query');

await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'notes_read', arguments: { id: 2 } } }, send);
const callRes = takeLast();
eq('tools/call 回应 id', callRes.id, 3);
eq('tools/call 返回单条 text 内容', callRes.result.content[0].type, 'text');
contains('tools/call 返回正文', callRes.result.content[0].text, '第二阶段：实现');
check('tools/call 成功时 isError 为假', !callRes.result.isError);

await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'notes_read', arguments: { id: 9999 } } }, send);
const missingNote = takeLast();
eq('读取不存在的笔记标记 isError', missingNote.result.isError, true);

await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} }, send);
const noName = takeLast();
eq('tools/call 缺 name 返回 -32602', noName.error.code, -32602);

await handleMessage({ jsonrpc: '2.0', id: 6, method: 'ping' }, send);
eq('ping 返回空结果', JSON.stringify(takeLast().result), '{}');

await handleMessage({ jsonrpc: '2.0', id: 7, method: 'no/such/method' }, send);
eq('未知方法返回 -32601', takeLast().error.code, -32601);

// 只读契约：模块不允许出现写入类调用
const toolsSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../tools.mjs', import.meta.url), 'utf8'));
for (const bad of ["method: 'POST'", 'POST ', 'DELETE', 'PUT ']) {
  check(`tools.mjs 不含写入动词 ${JSON.stringify(bad)}`, !toolsSrc.includes(bad));
}

server.close();
rmSync(tmp, { recursive: true, force: true });
eq('未捕获异常未发生', true, true);
