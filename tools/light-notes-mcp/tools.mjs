// 轻记只读桥 —— 工具实现（零依赖）
//
// 这里定义「工具清单 + 实现」：MCP 服务器（server.mjs）与命令行（notes-cli.mjs）共用同一份，
// 保证模型看到的工具与人工敲命令得到的结果完全一致。
//
// 只读保证：所有工具最终只调用轻记的 GET 接口（/health /notes /notes/{id} /search /groups），
// 轻记侧也不存在任何写入端点。
import { callBridge, readDiscovery, fmtTime, BridgeUnavailableError, DEFAULT_DISCOVERY } from './bridge-client.mjs';

const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_SEARCH_LIMIT = 100;

function clampLimit(value, def, max) {
  const n = Number.isFinite(value) ? Math.floor(value) : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function noteLine(n) {
  const title = n.title && n.title.trim() ? n.title.trim() : '（无标题）';
  const preview = n.preview ? ` — ${n.preview}` : '';
  return `- [${n.id}] ${title}（${n.groupPath || '未分组'} · ${fmtTime(n.timestamp)} · ${n.bytes} 字节）${preview}`;
}

// ---------- 工具实现 ----------

export async function toolStatus(opts) {
  const discovery = readDiscovery();
  const health = await callBridge('/health', opts);
  return {
    text: [
      '轻记本地只读桥可用。',
      `- 只读接口：127.0.0.1:${discovery.port}（发现文件 ${discovery.discoveryPath || DEFAULT_DISCOVERY}）`,
      `- 笔记 ${health.noteCount} 篇 / 分组 ${health.groupCount} 个`,
      `- 快照生成于 ${fmtTime(health.generatedAt)}，本次解锁开始于 ${fmtTime(health.since)}`,
      '- 回收站与 JSON 历史不会被提供。',
    ].join('\n'),
    isError: false,
  };
}

export async function toolList(args = {}, opts) {
  const data = await callBridge('/notes', opts);
  let notes = data.notes || [];
  const group = typeof args.group === 'string' ? args.group.trim().toLowerCase() : '';
  if (group) {
    notes = notes.filter((n) => String(n.groupPath || '未分组').toLowerCase().includes(group));
  }
  notes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const total = notes.length;
  const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const shown = notes.slice(0, limit);
  const head = group
    ? `分组「${args.group}」下共 ${total} 篇笔记${total > shown.length ? `，显示最新 ${shown.length} 篇` : ''}：`
    : `共 ${total} 篇笔记${total > shown.length ? `，显示最新 ${shown.length} 篇` : ''}：`;
  const text = shown.length ? [head, ...shown.map(noteLine)].join('\n') : `${head}（无）`;
  return { text, isError: false };
}

export async function toolSearch(args = {}, opts) {
  const q = typeof args.query === 'string' ? args.query.trim() : '';
  if (!q) return { text: 'notes_search 需要参数 query（搜索关键字）。', isError: true };
  const limit = clampLimit(args.limit, 20, MAX_SEARCH_LIMIT);
  const data = await callBridge(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, opts);
  if (!data.matched) return { text: `没有命中「${q}」的笔记（匹配标题与正文，大小写不敏感）。`, isError: false };
  const lines = (data.results || []).map(
    (r) => `- [${r.id}] ${r.title || '（无标题）'}（${r.groupPath || '未分组'} · ${fmtTime(r.timestamp)}）\n  …${r.snippet}…`,
  );
  return {
    text: [`命中 ${data.matched} 篇，返回 ${lines.length} 篇（可用 notes_read 读取全文）：`, ...lines].join('\n'),
    isError: false,
  };
}

export async function toolGroups(_args = {}, opts) {
  const data = await callBridge('/groups', opts);
  const groups = data.groups || [];
  if (!groups.length) return { text: '当前没有任何分组（笔记都在「未分组」下）。', isError: false };
  const lines = groups.map((g) => `- ${g.path}　（id ${g.id} · ${g.noteCount} 篇）`);
  return { text: [`共 ${groups.length} 个分组：`, ...lines].join('\n'), isError: false };
}

/** 按标题解析笔记：精确优先，其次唯一子串；不唯一时返回候选（绝不猜） */
export async function resolveByTitle(title, opts) {
  const data = await callBridge('/notes', opts);
  const notes = data.notes || [];
  const key = title.trim().toLowerCase();
  const exact = notes.filter((n) => String(n.title || '').trim().toLowerCase() === key);
  const hits = exact.length ? exact : notes.filter((n) => String(n.title || '').toLowerCase().includes(key));
  if (!hits.length) {
    return {
      text: `没有标题含有「${title}」的笔记。可以改用 notes_search 按正文关键字搜索，或先用 notes_list 浏览。`,
      isError: false,
    };
  }
  if (hits.length > 1) {
    return {
      text: [
        `标题匹配「${title}」的笔记有 ${hits.length} 篇，请用 id 明确指定要读哪一篇：`,
        ...hits.map(noteLine),
      ].join('\n'),
      isError: false,
    };
  }
  return { id: hits[0].id };
}

export async function toolRead(args = {}, opts) {
  let id = Number.isInteger(args.id) ? args.id : null;
  if (id === null && typeof args.title === 'string' && args.title.trim()) {
    const resolved = await resolveByTitle(args.title, opts);
    if (resolved.id === undefined) return resolved;   // 未找到或候选列表
    id = resolved.id;
  }
  if (id === null) {
    return { text: 'notes_read 需要 id 或 title（先用 notes_list / notes_search 取得 id）。', isError: true };
  }
  const data = await callBridge(`/notes/${id}`, opts);
  const n = data.note;
  const header = `# ${n.title || '（无标题）'}\n（分组：${n.groupPath || '未分组'} · 更新：${fmtTime(n.timestamp)} · id ${n.id} · ${n.bytes} 字节）\n`;
  return { text: `${header}\n---\n\n${n.content}`, isError: false };
}

// ---------- 工具清单（MCP tools/list） ----------

export const TOOLS = [
  {
    name: 'notes_status',
    description:
      '查看「轻记」（Light Notes）本地只读桥是否可用：返回只读端口、笔记与分组数量、快照时间。'
      + '读取任何笔记前先用它确认应用已解锁且已开启「本地工具读取」。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: toolStatus,
  },
  {
    name: 'notes_list',
    description:
      '列出「轻记」中的笔记元数据（id、标题、分组路径、更新时间、字节数、开头预览），按更新时间倒序。'
      + '不含回收站。可选 group 参数按分组路径/名称子串过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: '按分组路径或名称过滤（子串匹配，如「工作」或「工作 / 项目A」）' },
        limit: { type: 'integer', description: `最多返回条数（默认 ${DEFAULT_LIST_LIMIT}，上限 ${MAX_LIST_LIMIT}）` },
      },
      additionalProperties: false,
    },
    run: toolList,
  },
  {
    name: 'notes_search',
    description:
      '在「轻记」中按关键字搜索笔记（匹配标题与正文，大小写不敏感），返回命中笔记的 id、标题、分组路径与命中片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字' },
        limit: { type: 'integer', description: `最多返回条数（默认 20，上限 ${MAX_SEARCH_LIMIT}）` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: toolSearch,
  },
  {
    name: 'notes_read',
    description:
      '读取「轻记」中指定笔记的完整 Markdown 正文。优先用 id；也可以用 title（精确或唯一子串）——'
      + '标题不唯一时会返回候选列表而不猜。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '笔记 id（来自 notes_list / notes_search）' },
        title: { type: 'string', description: '笔记标题（不知道 id 时使用）' },
      },
      additionalProperties: false,
    },
    run: toolRead,
  },
  {
    name: 'notes_groups',
    description: '列出「轻记」的分组树（id、名称、父分组、完整路径、直接笔记数）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: toolGroups,
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** 供 MCP tools/call 使用：任何传输层失败都转成带指引的错误文本（isError: true） */
export async function runTool(name, args, opts) {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { text: `未知工具：${name}（可用：${[...TOOL_MAP.keys()].join(', ')}）`, isError: true };
  try {
    return await tool.run(args || {}, opts);
  } catch (e) {
    if (e instanceof BridgeUnavailableError) return { text: e.message, isError: true };
    return { text: `调用失败：${e && e.message ? e.message : String(e)}`, isError: true };
  }
}

export { clampLimit };
