// 前端与 Rust 侧的不变量回归测试：
// 1) 把 notes.html 中的纯逻辑函数（快照构建 / UI 偏好）提取出来做行为断言；
// 2) 静态检查关键接线与安全约束，防止后续改动把它们悄悄删掉。
import { readFileSync } from 'node:fs';
import { section, check, contains, notContains, eq, extractFunction } from './helpers.mjs';

const repoRoot = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('notes.html', repoRoot), 'utf8');
const rust = readFileSync(new URL('src-tauri/src/bridge.rs', repoRoot), 'utf8');

// ---------- 1. 行为：只读快照构建 ----------
section('快照构建（notes.html 提取函数）');

const snapshotSrc = extractFunction(html, 'buildBridgeSnapshot');
const buildSnapshot = new Function(
  'notes',
  'groups',
  `${snapshotSrc}; return buildBridgeSnapshot();`,
);

const raw = buildSnapshot(
  [
    { id: 7, title: '标题 A', content: '# 正文 A', timestamp: 111, groupId: 'g_1' },
    { id: 8, title: '', content: '无标题正文', timestamp: 222, groupId: null },
    { id: 9, timestamp: 333 },   // 缺字段（理论上不该出现，但必须不崩）
  ],
  [{ id: 'g_1', name: '工作', parentId: null, order: 0 }, { id: 'g_2', name: '子', parentId: 'g_1' }],
);
const snap = JSON.parse(raw);

eq('快照含 app 标识', snap.app, 'light-notes');
eq('快照含生成时间', typeof snap.generatedAt, 'number');
eq('笔记条数一致', snap.notes.length, 3);
eq('分组条数一致', snap.groups.length, 2);
eq('保留数字 id', snap.notes[0].id, 7);
eq('保留正文原文', snap.notes[0].content, '# 正文 A');
eq('空标题归一为空串', snap.notes[1].title, '');
eq('未分组 groupId 保持 null', snap.notes[1].groupId, null);
eq('缺字段不崩且正文归一', snap.notes[2].content, '');
eq('分组 order 缺省为 0', snap.groups[1].order, 0);
eq('分组 parentId 保留', snap.groups[1].parentId, 'g_1');
notContains('快照不含回收站字段', raw, 'trash');
notContains('快照不含 JSON 历史字段', raw, 'jsonHistory');
notContains('快照不含 deletedAt', raw, 'deletedAt');

// ---------- 2. 行为：UI 偏好（开关默认关闭） ----------
section('UI 偏好（开关默认关闭 / 可持久化）');

const prefsSrc = [extractFunction(html, 'loadUiPrefs'), extractFunction(html, 'saveUiPrefs')].join('\n');
function makePrefs(initial) {
  const store = new Map(Object.entries(initial || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const api = new Function(
    'localStorage',
    'UI_PREF_KEY',
    'clampSidebarWidth',
    'SIDEBAR_W_DEFAULT',
    `
      let sidebarWidth = SIDEBAR_W_DEFAULT;
      let bridgeEnabled = false;
      let exportDir = '';
      let sqlDir = '';
      ${prefsSrc}
      return {
        load: loadUiPrefs,
        save: saveUiPrefs,
        isEnabled: () => bridgeEnabled,
        width: () => sidebarWidth,
        dir: () => exportDir,
        setDir: (d) => { exportDir = d; },
        sqlDir: () => sqlDir,
        setSqlDir: (d) => { sqlDir = d; },
      };
    `,
  )(localStorage, 'light_notes_ui', (w) => w, 240);
  return { api, store };
}

const empty = makePrefs();
empty.api.load();
eq('无偏好时开关为关闭', empty.api.isEnabled(), false);

const legacy = makePrefs({ light_notes_ui: JSON.stringify({ sidebarWidth: 300 }) });
legacy.api.load();
eq('旧偏好（无 bridgeEnabled 字段）视为关闭', legacy.api.isEnabled(), false);
eq('旧偏好仍能恢复侧栏宽度', legacy.api.width(), 300);

const turnedOn = makePrefs({ light_notes_ui: JSON.stringify({ bridgeEnabled: true, sidebarWidth: 260 }) });
turnedOn.api.load();
eq('偏好为 true 时开关打开', turnedOn.api.isEnabled(), true);

const dirty = makePrefs({ light_notes_ui: '{坏 JSON' });
dirty.api.load();
eq('偏好损坏时回退为关闭', dirty.api.isEnabled(), false);

const saved = makePrefs();
saved.api.save();
const written = JSON.parse(saved.store.get('light_notes_ui'));
eq('保存时写入开关字段', written.bridgeEnabled, false);
eq('保存时保留侧栏宽度字段', written.sidebarWidth, 240);
eq('没有导出目录时保存为空串', written.exportDir, '');

const withDir = makePrefs({ light_notes_ui: JSON.stringify({ exportDir: 'D:\\导出' }) });
withDir.api.load();
eq('解锁时恢复上次的导出目录', withDir.api.dir(), 'D:\\导出');
withDir.api.setDir('E:\\notes');
withDir.api.save();
eq('导出目录可持久化', JSON.parse(withDir.store.get('light_notes_ui')).exportDir, 'E:\\notes');

const badDir = makePrefs({ light_notes_ui: JSON.stringify({ exportDir: 12345 }) });
badDir.api.load();
eq('导出目录类型不对时回退为空串', badDir.api.dir(), '');

// SQL 导入目录（「🗄️ SQL」TAB 记忆的源目录）同样存在 UI 偏好里
const noSqlDir = makePrefs();
noSqlDir.api.load();
eq('没有 SQL 目录时为空串', noSqlDir.api.sqlDir(), '');
noSqlDir.api.save();
eq('保存时写入 SQL 目录字段', JSON.parse(noSqlDir.store.get('light_notes_ui')).sqlDir, '');

const withSqlDir = makePrefs({ light_notes_ui: JSON.stringify({ sqlDir: 'D:\\db\\sql' }) });
withSqlDir.api.load();
eq('解锁时恢复上次的 SQL 导入目录', withSqlDir.api.sqlDir(), 'D:\\db\\sql');
withSqlDir.api.setSqlDir('E:\\scripts');
withSqlDir.api.save();
eq('SQL 导入目录可持久化', JSON.parse(withSqlDir.store.get('light_notes_ui')).sqlDir, 'E:\\scripts');

const badSqlDir = makePrefs({ light_notes_ui: JSON.stringify({ sqlDir: 42 }) });
badSqlDir.api.load();
eq('SQL 导入目录类型不对时回退为空串', badSqlDir.api.sqlDir(), '');

// ---------- 3. 静态：前端接线与安全约束 ----------
section('前端接线与安全约束（静态检查）');

contains('设置页存在「本地工具读取」开关', html, 'id="bridgeToggle"');contains('设置页有状态显示行', html, 'id="bridgeStatus"');
contains('设置页有错误提示位', html, 'id="bridgeErr"');
contains('开关有事件绑定', html, 'bridgeToggle.addEventListener');
contains('开关写入 UI 偏好', html, 'bridgeEnabled: bridgeEnabled');

contains('解锁成功即启动（若已开启）', extractFunction(html, 'unlockSuccess'), 'void bridgeStart()');
contains('锁定即停止并删发现文件', extractFunction(html, 'lockApp'), 'void bridgeStop()');
contains('落库成功后同步快照', extractFunction(html, 'persistData'), 'scheduleBridgeSync()');
contains('启动时清理上一次残留监听', extractFunction(html, 'init'), 'void bridgeStop()');
contains('进入设置页刷新真实状态', extractFunction(html, 'switchTab'), 'void refreshBridgeStatus()');

const startSrc = extractFunction(html, 'bridgeStart');
contains('未开启或未解锁时不启动', startSrc, 'if (!bridgeEnabled || !isUnlocked)');
const syncSrc = extractFunction(html, 'bridgeSyncNow');
contains('未运行时不同步', syncSrc, 'if (!bridgeRunning) return;');
const stopSrc = extractFunction(html, 'bridgeStop');
contains('停止后清空本地端口状态', stopSrc, 'bridgePort = null;');

contains('快照只含 notes 与 groups 两个集合', snapshotSrc, 'notes: notes.map');
notContains('快照构建不引用回收站', snapshotSrc, 'trash');
notContains('快照构建不引用 JSON 历史', snapshotSrc, 'jsonHistory');

// ---------- 4. 静态：Rust 侧安全约束 ----------
section('Rust 只读桥安全约束（静态检查）');

contains('只绑定回环地址', rust, 'TcpListener::bind(("127.0.0.1", 0))');
notContains('不监听全部网卡', rust, '0.0.0.0');
contains('所有端点校验 Bearer 令牌', rust, 'Bearer {token}');
contains('无令牌返回 401', rust, '401, "缺少或错误的访问令牌"');
contains('非 GET 一律拒绝', rust, 'if req.method != "GET"');
contains('非 GET 返回 405', rust, '405');
contains('停止时删除发现文件', rust, 'remove_file');
contains('有停止标志位', rust, 'shutdown.store(true');
notContains('Rust 侧不接触回收站', rust, 'trash');
notContains('Rust 侧不接触 JSON 历史', rust, 'jsonHistory');
notContains('Rust 侧不含解密代码', rust, 'AES');
contains('应用退出时停止桥', readFileSync(new URL('src-tauri/src/lib.rs', repoRoot), 'utf8'), 'bridge::stop(state.inner())');
contains('命令已注册', readFileSync(new URL('src-tauri/src/lib.rs', repoRoot), 'utf8'), 'bridge::bridge_start');

// ---------- 5. 行为：目录监听的事件计划（notes.html 提取函数） ----------
section('目录监听：事件计划（纯函数）');

const mdExtLiteral = html.match(/const MD_EXT_RE = (\/.*?\/i);/)[1];
const planSrc = `
  const MD_EXT_RE = ${mdExtLiteral};
  ${extractFunction(html, 'titleFromFileName')}
  ${extractFunction(html, 'watchMarkdownTitle')}
  ${extractFunction(html, 'planWatchEvent')}
  return { watchMarkdownTitle, planWatchEvent };
`;
const makePlan = (groupsStub, notesStub) => new Function('groups', 'notes', planSrc)(groupsStub, notesStub);

const groupList = [{ id: 'g1', name: '工作', parentId: null, order: 0 }];
const noteList = [{ id: 101, title: '已存在', content: 'x', timestamp: 1, groupId: 'g1' }];
const planner = makePlan(groupList, noteList);
const bind = (known, groupId = 'g1') => ({ id: 'w1', dir: 'D:/notes', groupId, enabled: true, known });

eq('文件名取标题（去扩展名）', planner.watchMarkdownTitle('子目录/我的笔记.md'), '我的笔记');
eq('子目录路径也能取到标题', planner.watchMarkdownTitle('a/b/c.markdown'), 'c');
eq('没有扩展名时原样作标题', planner.watchMarkdownTitle('README'), 'README');
eq('超长文件名截断到 60 字', planner.watchMarkdownTitle('x'.repeat(80) + '.md').length, 60);
eq('空路径不崩', planner.watchMarkdownTitle(''), '未命名');

const added = planner.planWatchEvent(bind({}), { bindingId: 'w1', relPath: '新笔记.md', kind: 'added' });
eq('新增 → 建笔记', added.action, 'create');
eq('新增笔记标题取自文件名', added.title, '新笔记');
eq('新增笔记落到绑定分组', added.groupId, 'g1');

const addedKnown = planner.planWatchEvent(bind({ '新笔记.md': null }), { bindingId: 'w1', relPath: '新笔记.md', kind: 'added' });
eq('已登记的路径不再重复建笔记', addedKnown.action, 'ignore');

const addedStale = planner.planWatchEvent(bind({}, 'g_deleted'), { bindingId: 'w1', relPath: 'a.md', kind: 'added' });
eq('绑定分组已被删除时回落到未分组', addedStale.groupId, null);

const removed = planner.planWatchEvent(bind({ 'a.md': 101 }), { bindingId: 'w1', relPath: 'a.md', kind: 'removed' });
eq('删除 → 对应笔记移入回收站', removed.action, 'trash');
eq('移入回收站的是登记的笔记 id', removed.noteId, 101);

const removedBaseline = planner.planWatchEvent(bind({ 'a.md': null }), { bindingId: 'w1', relPath: 'a.md', kind: 'removed' });
eq('基线条目被删除 → 只撤销登记', removedBaseline.action, 'forget');

const removedGone = planner.planWatchEvent(bind({ 'a.md': 999 }), { bindingId: 'w1', relPath: 'a.md', kind: 'removed' });
eq('登记笔记已不存在 → 只撤销登记（不复活）', removedGone.action, 'forget');

eq('未知事件类型被忽略', planner.planWatchEvent(bind({}), { bindingId: 'w1', relPath: 'a.md', kind: 'changed' }).action, 'ignore');
eq('未找到绑定时忽略', planner.planWatchEvent(null, { bindingId: 'w9', relPath: 'a.md', kind: 'added' }).action, 'ignore');

// 内容修改（kind=changed 不会出现，这里额外确认实现里没有把 mtime/size 当成事件源）
notContains('事件计划不依赖 mtime', planSrc, 'mtime');
notContains('事件计划不依赖文件大小', planSrc, 'size');

// ---------- 7. 行为：Rust → 前端 的解码链（跨语言契约） ----------
section('目录监听：文件内容解码链');

const decodeApi = new Function(`
  ${extractFunction(html, 'b64ToBuf')}
  ${extractFunction(html, 'decodeMdBytes')}
  return { b64ToBuf, decodeMdBytes };
`)();
const { b64ToBuf, decodeMdBytes } = decodeApi;

// Rust 侧 watch::tests::base64_matches_reference_vectors 已固定 b64_encode("轻记") = "6L276K6w"，
// 这里把同一串喂给前端解码链，保证两端契约一致
eq('Rust 的 base64 能被前端解码（UTF-8）', decodeMdBytes(b64ToBuf('6L276K6w')), '轻记');

const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('中文')]);
eq('UTF-8 BOM 被剥离', decodeMdBytes(utf8Bom), '中文');

const utf16le = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]);   // '中' 的 UTF-16LE
eq('UTF-16LE BOM 被识别', decodeMdBytes(utf16le), '中');

// GBK「中文笔记」= D6D0 CEC4 B1CA BCC7（非合法 UTF-8 → 必须回退 GBK，中文 Windows 的常见情形）
const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xca, 0xbc, 0xc7]);
eq('GBK 文件回退解码正确', decodeMdBytes(gbk), '中文笔记');
eq('空内容不报错', decodeMdBytes(new Uint8Array([])), '');

// 应用侧读取路径：Rust 返回 base64 → 前端 b64ToBuf → decodeMdBytes → trim 后入库
const fromRust = decodeMdBytes(b64ToBuf('IyDmoIfpopgK5q2j5paH')).trim();
eq('端到端：base64 → 文本（含 BOM 情形已在上文覆盖）', fromRust, '# 标题\n正文');

// ---------- 8. 静态：目录监听的接线与约束 ----------
section('目录监听：接线与约束（静态检查）');


const libRs = readFileSync(new URL('src-tauri/src/lib.rs', repoRoot), 'utf8');
const watchRs = readFileSync(new URL('src-tauri/src/watch.rs', repoRoot), 'utf8');
const watchProd = watchRs.split('#[cfg(test)]')[0];   // 只看生产代码（测试里会造临时文件）

contains('快照写入 include watchers（随 vault 加密持久化）', extractFunction(html, 'persistData'), 'sqlGroups, sqlWatchers }');
contains('建空库时也带 watchers 字段', extractFunction(html, 'buildVault'), 'sqlGroups, sqlWatchers }');
contains('解锁时载入 watchers', extractFunction(html, 'unlockApp'), 'payload.watchers');
contains('改 PIN 时全量重加密（watchers 随之保留）', extractFunction(html, 'submitChangePin'), 'encryptObject(payload, newKey, newSalt)');
contains('锁定清空 watchers', extractFunction(html, 'lockApp'), 'watchers = [];');
contains('锁定停止目录监听', extractFunction(html, 'lockApp'), 'void watchStop();');
contains('解锁启动目录监听（含关闭期间补跑）', extractFunction(html, 'unlockSuccess'), 'void watchStart();');
contains('删除分组时绑定回落到未分组', extractFunction(html, 'deleteGroup'), 'watchers.forEach(w => { if (w.groupId && ids.includes(w.groupId)) w.groupId = null; });');
contains('启动时清理上一次残留监听', extractFunction(html, 'init'), 'void watchStop();');
contains('进入设置页刷新监听状态', extractFunction(html, 'switchTab'), 'renderWatchUi();');
contains('绑定列表用事件委托', html, "watchList.addEventListener('click'");
for (const act of ['toggle', 'group', 'import', 'remove']) {
  contains(`绑定列表支持 ${act} 操作`, html, `act === '${act}'`);
}
contains('新增面板按钮已绑定', html, "watchConfirmBtn.addEventListener('click', () => void addWatchBinding());");
contains('分组选择器支持监听绑定', html, "openMoveMenu(btn, 'watch', id)");
contains('分组选择器支持新增绑定时选分组', html, "openMoveMenu(watchGroupBtn, 'watch-new', '')");
contains('事件应用后回传登记表', extractFunction(html, 'applyWatchEvents'), 'await watchSetKnown();');
contains('事件应用后落库', extractFunction(html, 'applyWatchEvents'), 'await persistData();');
contains('删除事件走回收站（软删除）', extractFunction(html, 'applyWatchEvents'), 'trash.push(');
contains('读取失败也登记，避免反复重试', extractFunction(html, 'applyWatchEvents'), 'binding.known[ev.relPath] = null;');
contains('目录监听只调这些命令', html, "tauriInvoke('watch_check_dir'");
contains('浏览目录走系统对话框命令', html, "tauriInvoke('watch_browse_dir')");
notContains('前端不直接读写文件系统', html, 'watch_write');
notContains('前端不提供删除文件的接口调用', html, "tauriInvoke('watch_delete");

contains('Rust 侧命令已注册', libRs, 'watch::watch_start');
contains('退出时停止监听', libRs, 'watch::stop(state.inner())');
contains('扫描只读目录', watchProd, 'std::fs::read_dir');
contains('读取文件内容只读', watchProd, 'std::fs::read');
contains('路径必须落在绑定目录内', watchProd, 'full.starts_with(&root)');
contains('有单文件大小上限', watchProd, 'MAX_FILE_BYTES');
contains('有递归深度上限', watchProd, 'MAX_DEPTH');
notContains('Rust 侧不写任何文件（除浏览对话框的临时文件）', watchProd, 'fs::write');
notContains('Rust 侧不删除目录', watchProd, 'remove_dir');
const removeCalls = [...watchProd.matchAll(/remove_file\(([^)]*)\)/g)].map((m) => m[1].trim());
check('Rust 侧只删自己的临时文件', removeCalls.length > 0 && removeCalls.every((a) => a === '&tmp'), removeCalls.join(' | '));

// ---------- 8.5 行为：导出的 Markdown 文本与勾选逻辑 ----------
section('导出：Markdown 文本与勾选逻辑（notes.html 提取函数）');

const exportMd = new Function(`${extractFunction(html, 'exportMarkdown')}; return exportMarkdown;`)();
eq('标题成为一级标题', exportMd({ title: '标题', content: '正文' }), '# 标题\n\n正文\n');
eq('正文自带 H1 时不重复加标题', exportMd({ title: '标题', content: '# 已有\n正文' }), '# 已有\n正文\n');
eq('无标题时只导出正文', exportMd({ title: '   ', content: '正文' }), '正文\n');
eq('只有标题也能导出', exportMd({ title: '标题', content: '' }), '# 标题\n');
eq('CRLF 归一为 LF', exportMd({ title: '', content: 'a\r\nb' }), 'a\nb\n');
eq('空笔记导出空串（调用方据此跳过）', exportMd({ title: '', content: '   ' }), '');
eq('缺字段不崩', exportMd({}), '');

const dirOfPath = new Function(`${extractFunction(html, 'dirOfPath')}; return dirOfPath;`)();
eq('取 Windows 路径的目录', dirOfPath('D:\\notes\\a.md'), 'D:\\notes');
eq('取 POSIX 路径的目录', dirOfPath('D:/notes/a.md'), 'D:/notes');
eq('没有目录部分时返回空串', dirOfPath('a.md'), '');

// 勾选逻辑：勾一个分组 = 勾中它及其全部子分组的笔记
const pickerSrc = [
  extractFunction(html, 'collectDescendantIds'),
  extractFunction(html, 'exportGroupNoteIds'),
  extractFunction(html, 'exportSetGroup'),
  extractFunction(html, 'exportSelectedNotes'),
].join('\n');
function makePicker(noteList, groupList, picked) {
  const set = new Set(picked || []);
  const api = new Function('notes', 'groups', 'exportPickIds', `${pickerSrc}
    return { groupIds: exportGroupNoteIds, setGroup: exportSetGroup, selected: exportSelectedNotes };`)(noteList, groupList, set);
  return { api, set };
}
const demoNotes = [
  { id: 1, groupId: null }, { id: 2, groupId: 'g_1' }, { id: 3, groupId: 'g_1' }, { id: 4, groupId: 'g_2' },
];
const demoGroups = [{ id: 'g_1', name: '甲', parentId: null }, { id: 'g_2', name: '乙', parentId: 'g_1' }];
const picker = makePicker(demoNotes, demoGroups, [2, 4]);
eq('勾选分组时含子分组的笔记', picker.api.groupIds('g_1').sort((a, b) => a - b).join(','), '2,3,4');
eq('未分组只取 groupId 为空的笔记', picker.api.groupIds(null).join(','), '1');
eq('叶子分组只取自己的笔记', picker.api.groupIds('g_2').join(','), '4');
eq('已勾选笔记按 notes 顺序返回', picker.api.selected().map((n) => n.id).join(','), '2,4');

picker.api.setGroup('g_1', true);
eq('勾选分组会补齐子树里的笔记', [...picker.set].sort((a, b) => a - b).join(','), '2,3,4');
picker.api.setGroup('g_2', false);
eq('取消勾选分组只影响它的子树', [...picker.set].sort((a, b) => a - b).join(','), '2,3');
picker.api.setGroup(null, true);
eq('勾选未分组只加入未分组的笔记', [...picker.set].sort((a, b) => a - b).join(','), '1,2,3');

// ---------- 8.6 静态：导出的接线与安全约束 ----------
section('导出：接线与安全约束（静态检查）');

const exportRs = readFileSync(new URL('src-tauri/src/export.rs', repoRoot), 'utf8');
const exportProd = exportRs.split('#[cfg(test)]')[0];

contains('阅读模式才显示导出按钮', extractFunction(html, 'setEditorButtons'), "show(exportNoteBtn, mode === 'view')");
contains('导出按钮有下拉菜单', html, 'id="exportMenu"');
contains('导出菜单接线', html, 'pickExportMode(opt.dataset.mode)');
contains('单篇 Markdown 走系统保存对话框', html, "tauriInvoke('export_pick_save'");
contains('单篇 Markdown 落盘', html, "tauriInvoke('export_save_file'");
contains('单篇 PDF 调 window.print()', extractFunction(html, 'exportNotePdf'), 'window.print()');
contains('打印容器存在', html, 'id="printRoot"');
check('打印容器排在脚本块之前（否则脚本执行时取不到）',
  html.indexOf('id="printRoot"') > 0 && html.indexOf('id="printRoot"') < html.indexOf('<script>'));
contains('打印时只输出 #printRoot', html, 'body > *:not(#printRoot)');
contains('打印使用 A4 页边距', html, '@page { size: A4;');

// 打印样式必须解除「屏幕布局的尺寸约束」：应用是满窗口桌面布局（html/body height:100vh、body display:flex），
// #printRoot 又带 .md-preview 的 flex:1 + overflow-y:auto——不解除的话打印页只有一屏高，
// 后面的内容全被裁掉。用户实测过「导出 PDF 时内容被截断」，下面几条就是这个 bug 的守卫。
const printCss = html.slice(html.indexOf('@media print {'), html.indexOf('@page { size: A4;'));
check('打印样式块确实取自 @media print', printCss.includes('#printRoot'), '未切到打印样式块');
contains('打印时解除 body 的固定高度', printCss, 'height: auto !important;');
contains('打印时解除 body 的 flex 布局', printCss, 'display: block !important;');
contains('打印时解除 #printRoot 的 flex', printCss, 'flex: none !important;');
contains('打印时解除 #printRoot 的滚动裁剪', printCss, 'overflow: visible !important;');
contains('长代码块 / 长表格允许跨页', printCss, 'break-inside: auto; page-break-inside: auto;');

const pdfSrc = extractFunction(html, 'exportNotePdf');
notContains('打印期间不清空打印容器（清空会让后续页变空白）', pdfSrc, "printRoot.innerHTML = ''");
contains('afterprint 只恢复状态、不清内容', pdfSrc, "classList.remove('printing')");
contains('打印容器只在锁定时清空', extractFunction(html, 'lockApp'), 'clearPrintRoot();');
contains('清空打印容器会一并复位打印状态', extractFunction(html, 'clearPrintRoot'), "classList.remove('printing')");

contains('批量导出走目录对话框', html, "tauriInvoke('export_pick_dir'");
contains('批量导出落盘', html, "tauriInvoke('export_write_files'");
contains('批量导出默认不覆盖（由勾选框控制）', html, 'overwrite: !!(exportOverwriteChk && exportOverwriteChk.checked)');
contains('勾选分组含子分组', extractFunction(html, 'exportGroupNoteIds'), 'collectDescendantIds(gid)');
contains('勾选列表用事件委托', html, "exportList.addEventListener('change'");
contains('导出目录记忆在 UI 偏好', html, 'exportDir: exportDir');
contains('导出结果不写已隐藏的设置页', extractFunction(html, 'renderExportUi'), 'if (!settingsVisible()) return;');
contains('锁定清空导出勾选', extractFunction(html, 'lockApp'), 'exportPickIds.clear();');
contains('锁定关闭导出菜单', extractFunction(html, 'lockApp'), 'closeExportMenu();');
contains('锁定关闭导出面板', extractFunction(html, 'lockApp'), 'closeExportPanel();');
contains('进入设置页渲染导出面板', extractFunction(html, 'switchTab'), 'renderExportUi();');

contains('Rust 侧导出命令已注册', libRs, 'export::export_write_files');
contains('Rust 导出要写文件', exportProd, 'std::fs::write');
const exportRemove = [...exportProd.matchAll(/remove_file\(([^)]*)\)/g)].map((m) => m[1].trim());
check('Rust 导出只删自己的临时文件（不碰用户文件）',
  exportRemove.length > 0 && exportRemove.every((a) => a === '&tmp'), exportRemove.join(' | '));
contains('文件名净化去掉非法字符', exportProd, 'matches!(ch');
contains('文件名避开 Windows 设备保留名', exportProd, 'RESERVED_NAMES');
contains('同名默认不覆盖（自动加序号）', exportProd, '!overwrite && dir.join(&candidate).exists()');
contains('目标目录必须已存在', exportProd, 'if !raw_dir.exists()');
contains('写入路径必须落在目标目录内', exportProd, 'full.parent() != Some(root.as_path())');
contains('有批量文件数上限', exportProd, 'MAX_FILES');
contains('有单篇正文大小上限', exportProd, 'MAX_CONTENT_BYTES');
contains('PowerShell 参数经单引号转义', exportProd, 'ps_quote');
notContains('Rust 导出不解密任何数据（只收前端给的纯文本）', exportProd, 'decrypt');
notContains('Rust 导出不碰 PIN / 密钥', exportProd, 'vault');

// ---------- 9. 静态：命令不得阻塞 UI 主线程 ----------
section('Rust 命令不得阻塞 UI 主线程（静态检查）');

// Tauri 的同步命令由 tauri-macros 的 body_blocking 内联执行，跑在 IPC 回调线程
// （Windows 上即 UI 主线程）上；只有 async fn 才会被 async_runtime::spawn 抛到工作线程。
// 因此凡是要做 I/O（解析大快照 / 读文件 / 遍历目录 / 起进程 / join 线程）的命令必须 async，
// 否则点一次设置页就会卡一下（用户实测过的现象）。
const bridgeRs = readFileSync(new URL('src-tauri/src/bridge.rs', repoRoot), 'utf8');
const sessionRs = readFileSync(new URL('src-tauri/src/session.rs', repoRoot), 'utf8');
const sqlRs = readFileSync(new URL('src-tauri/src/sql_import.rs', repoRoot), 'utf8');

const asyncCommands = [
  ['bridge.rs', bridgeRs, 'bridge_start'],
  ['bridge.rs', bridgeRs, 'bridge_sync'],
  ['bridge.rs', bridgeRs, 'bridge_stop'],
  ['bridge.rs', bridgeRs, 'bridge_status'],
  ['watch.rs', watchRs, 'watch_start'],
  ['watch.rs', watchRs, 'watch_stop'],
  ['watch.rs', watchRs, 'watch_poll'],
  ['watch.rs', watchRs, 'watch_set_known'],
  ['watch.rs', watchRs, 'watch_read'],
  ['watch.rs', watchRs, 'watch_check_dir'],
  ['watch.rs', watchRs, 'watch_browse_dir'],
  ['lib.rs', libRs, 'autostart_status'],
  ['lib.rs', libRs, 'autostart_set'],
  ['export.rs', exportRs, 'export_write_files'],
  ['export.rs', exportRs, 'export_save_file'],
  ['export.rs', exportRs, 'export_pick_dir'],
  ['export.rs', exportRs, 'export_pick_save'],
  ['session.rs', sessionRs, 'session_poll'],
  ['sql_import.rs', sqlRs, 'sql_scan_dir'],
  ['sql_import.rs', sqlRs, 'sql_read_file'],
  ['sql_import.rs', sqlRs, 'sql_browse_dir'],
];
for (const [file, source, name] of asyncCommands) {
  check(`${file} 的 ${name} 是 async fn`, new RegExp(`async fn ${name}\\s*[(<]`).test(source));
  // 反向守卫：不得存在「不是 async 的」同名命令（`f` 前不能是 `async `）
  check(`${file} 不含同步版 ${name}`, !new RegExp(`(?<!async )fn ${name}\\s*\\(`).test(source));
}

contains('bridge 命令注明 async 理由（主线程内联执行）', bridgeRs, '内联跑在 IPC 回调线程');
contains('watch 命令块注明 async 理由', watchRs, 'body_blocking');
contains('autostart 命令注明 async 理由', libRs, '开发注意事项 16');
contains('export 命令块注明 async 理由', exportRs, '开发注意事项 16');

// ---------- 10. 静态：切页不被跨进程工作拖慢 ----------
section('切页不被跨进程工作拖慢（静态检查）');

const switchTabSrc = extractFunction(html, 'switchTab');
contains('设置页的读取延后到本帧绘制之后', switchTabSrc, 'requestAnimationFrame(');
contains('切走后不再继续做设置页的活', switchTabSrc, "if (activeTab !== 'settings') return;");
contains('设置页可见性辅助函数存在', html, 'function settingsVisible()');
contains('开机启动状态只在设置页可见时渲染', extractFunction(html, 'refreshAutostart'),
  'if (settingsVisible()) renderAutostartToggle();');
contains('只读桥状态只在设置页可见时渲染', extractFunction(html, 'refreshBridgeStatus'),
  'if (settingsVisible()) renderBridgeUi();');
contains('rAF 回调里才做设置页的读取', switchTabSrc, 'void refreshAutostart();');
contains('导出面板也在 rAF 回调里渲染', switchTabSrc, 'renderExportUi();');
notContains('切页路径里不再直接调用 renderGroupTree', switchTabSrc, 'renderGroupTree');

// ---------- 11. 静态：子进程不得弹出控制台窗口 ----------
section('子进程不得弹出控制台窗口（静态检查）');

// 从 GUI 进程启动 reg.exe / powershell.exe 这类控制台程序时，Windows 默认会给它新建一个
// 控制台窗口——用户实测「每次切到设置页都闪一个命令行弹窗，一秒后消失」。必须加 CREATE_NO_WINDOW。
contains('定义了 CREATE_NO_WINDOW', libRs, 'const CREATE_NO_WINDOW: u32 = 0x0800_0000;');
contains('hide_console 走 creation_flags', libRs, 'cmd.creation_flags(CREATE_NO_WINDOW);');
contains('hide_console 对 crate 可见', libRs, 'pub(crate) fn hide_console(cmd: &mut Command)');

const regSpawns = (libRs.match(/Command::new\("reg"\)/g) || []).length;
const hideCalls = (libRs.match(/hide_console\(&mut cmd\);/g) || []).length;
check('reg 子进程至少 3 处（查询 / 写入 / 删除）', regSpawns >= 3, String(regSpawns));
eq('每个 reg 子进程都跟着一次 hide_console', hideCalls, regSpawns);
contains('PowerShell 对话框同样隐藏控制台', watchRs, 'crate::hide_console(&mut cmd);');
contains('导出模块的 PowerShell 对话框也隐藏控制台', exportRs, 'crate::hide_console(&mut cmd);');

// 反向守卫：链式写法（Command::new(..).args(..).output()）无法插入 hide_console，一旦出现即视为漏改
const chained = [
  ...libRs.matchAll(/Command::new\("[^"]+"\)\s*\.(?:\s*\n\s*)?args/g),
  ...watchRs.matchAll(/Command::new\("[^"]+"\)\s*\.(?:\s*\n\s*)?args/g),
  ...exportRs.matchAll(/Command::new\("[^"]+"\)\s*\.(?:\s*\n\s*)?args/g),
  ...sqlRs.matchAll(/Command::new\("[^"]+"\)\s*\.(?:\s*\n\s*)?args/g),
].length;
eq('没有链式 spawn（那种写法必定漏掉 hide_console）', chained, 0);
const spawnCalls = [...libRs.matchAll(/\.spawn\(\)/g)].length
  + [...watchRs.matchAll(/\.spawn\(\)/g)].length
  + [...exportRs.matchAll(/\.spawn\(\)/g)].length
  + [...sqlRs.matchAll(/\.spawn\(\)/g)].length;
eq('没有用 .spawn() 起的子进程（只用 .output() 并显式隐藏窗口）', spawnCalls, 0);

// ---------- 12. 静态：编辑器默认状态（空状态）/ 新建入口 / 代码块底色 / 窗口最大化 ----------
section('编辑器默认状态与窗口配置（静态检查）');

// 用户要求：解锁后不要默认显示编辑界面 —— 改为显示空状态卡片，点「＋ 新建笔记」或左侧笔记才进编辑器
contains('存在空状态容器', html, 'class="editor-empty" id="editorEmpty"');
contains('空状态里有新建笔记按钮', html, 'id="newNoteBtn"');
contains('侧栏也有新建笔记入口', html, 'id="newNoteSideBtn"');
contains('解锁后显示空状态', extractFunction(html, 'unlockSuccess'), 'showEditorEmpty()');
notContains('解锁后不再自动聚焦正文（编辑器已隐藏）', extractFunction(html, 'unlockSuccess'), 'mdTextarea.focus()');
contains('复位编辑器后回到空状态', extractFunction(html, 'cancelEdit'), 'showEditorEmpty();');
contains('新建笔记切回编辑器', extractFunction(html, 'newNote'), 'showEditorPanel();');
for (const fn of ['viewNote', 'startEdit', 'viewTrashNote', 'openMdInEditor']) {
  contains(`${fn} 打开笔记时离开空状态`, extractFunction(html, fn), 'showEditorPanel()');
}
contains('空状态按钮已绑定', html, "newNoteBtn.addEventListener('click', newNote);");
contains('侧栏按钮已绑定', html, "newNoteSideBtn.addEventListener('click', newNote);");

// 代码块底色（用户指定 #f5f5f5，屏幕端）
const preCssStart = html.indexOf('.md-preview pre {');
contains('代码块底色为 #f5f5f5', html.slice(preCssStart, preCssStart + 400), 'background: #f5f5f5;');

// 用户要求：窗口默认最大化（tauri.conf.json 主窗口）
const tauriConf = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', repoRoot), 'utf8'));
const mainWindow = (tauriConf.app && tauriConf.app.windows && tauriConf.app.windows[0]) || {};
eq('窗口默认最大化', mainWindow.maximized, true);

// ---------- 13. 系统锁屏联动（Win+L → 自动锁定笔记） ----------
section('系统锁屏联动（行为 + 静态检查）');

// 行为：纯函数 sessionLockDue —— 只有「Rust 侧锁屏计数比本地已处理的多」才需要锁定
const sessionLockDue = new Function(`${extractFunction(html, 'sessionLockDue')}; return sessionLockDue;`)();
eq('计数变大才需要锁定', sessionLockDue({ lockCount: 3 }, 2), true);
eq('计数相同不锁定', sessionLockDue({ lockCount: 2 }, 2), false);
eq('计数没变（未发生锁屏）不锁定', sessionLockDue({ lockCount: 0 }, 0), false);
eq('一次锁屏也算（首解锁后基线相同）', sessionLockDue({ lockCount: 1 }, 0), true);
eq('状态缺失不锁定', sessionLockDue(null, 0), false);
eq('计数缺失不锁定', sessionLockDue({ locked: true }, 0), false);
eq('本地计数非法（-1）时按 0 处理、偏保守地锁定', sessionLockDue({ lockCount: 1 }, -1), true);

// 静态：Rust 侧会话通知（零新依赖，只用系统 DLL 导入项）
contains('会话模块存在 WTS 登记调用', sessionRs, 'WTSRegisterSessionNotification');
contains('会话模块解绑时反注册', sessionRs, 'WTSUnRegisterSessionNotification');
contains('会话模块链接 wtsapi32', sessionRs, '#[link(name = "wtsapi32")]');
contains('会话模块监听 WM_WTSSESSION_CHANGE', sessionRs, 'WM_WTSSESSION_CHANGE');
contains('会话模块识别锁屏事件', sessionRs, 'WTS_SESSION_LOCK');
contains('会话模块识别解锁事件', sessionRs, 'WTS_SESSION_UNLOCK');
contains('锁屏事件累加计数', sessionRs, 'LOCK_COUNT.fetch_add(1');
contains('解锁事件清除已锁状态', sessionRs, 'LOCKED.store(false');
contains('子类化窗口过程', sessionRs, 'SetWindowLongPtrW');
contains('其它消息原样转发（不吞消息）', sessionRs, 'CallWindowProcW');
contains('子类化失败时回退默认窗口过程', sessionRs, 'DefWindowProcW');
contains('WTS 登记使用「仅本会话」标志', sessionRs, 'WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)');
contains('登记失败会还原窗口过程', sessionRs, 'SetWindowLongPtrW(hwnd, GWLP_WNDPROC, prev)');

// 静态：命令注册与生命周期（注册 / 退出解绑）
contains('会话命令已注册', libRs, 'session::session_poll');
contains('启动时登记会话通知', libRs, 'session::start(hwnd.0 as isize)');
contains('退出时解绑会话通知', libRs, 'session::stop()');

// 静态：前端接线 —— 解锁才轮询、发现锁屏即锁笔记、锁定即停止轮询
contains('前端轮询 session_poll', html, "tauriInvoke('session_poll')");
contains('解锁后启动锁屏轮询', extractFunction(html, 'unlockSuccess'), 'sessionStart();');
contains('锁定时停止锁屏轮询', extractFunction(html, 'lockApp'), 'sessionStop();');
contains('发现锁屏即锁定笔记', extractFunction(html, 'sessionPoll'), 'lockApp();');
contains('首次轮询只取基线', html, 'sessionBaseline = true;');
contains('轮询间隔常量存在', html, 'const SESSION_POLL_MS =');
const sessionPollSrc = extractFunction(html, 'sessionPoll');
contains('轮询防重入', sessionPollSrc, 'if (sessionBusy) return;');
contains('非 Windows / 未登记时静默忽略', sessionPollSrc, 'catch (_) {');

// ---------- 14. 纯文本笔记（📝 TAB）与 SQL 文件（🗄️ TAB） ----------
section('纯文本笔记 / SQL 文件（行为 + 静态检查）');

// 行为：SQL 条目的身份键 —— 「同目录 + 同相对路径」视为同一份文件（Windows 不区分大小写与分隔符）
const sqlKey = new Function(
  `${extractFunction(html, 'normSqlDir')}\n${extractFunction(html, 'sqlEntryKey')}\nreturn sqlEntryKey;`,
)();
eq('同一目录不同写法视为同一个键（大小写与分隔符归一）', sqlKey('D:\\DB\\SQL\\', 'sub/a.SQL'), sqlKey('d:/db/sql', 'sub\\a.sql'));
eq('末尾多余分隔符不影响身份', sqlKey('D:\\db\\sql\\\\', 'a.sql'), sqlKey('D:\\db\\sql', 'a.sql'));
check('不同目录是不同条目', sqlKey('D:\\db\\sql', 'a.sql') !== sqlKey('D:\\db\\sql2', 'a.sql'));
check('不同相对路径是不同条目', sqlKey('D:\\db', 'a.sql') !== sqlKey('D:\\db', 'b.sql'));

// 行为：标题取相对路径最后一段去掉 .sql
const sqlTitleFromRel = new Function(
  `const SQL_EXT_RE = ${html.match(/const SQL_EXT_RE = (\/.*?\/i);/)[1]};\n${extractFunction(html, 'sqlTitleFromRel')}\nreturn sqlTitleFromRel;`,
)();
eq('SQL 标题取文件名去扩展名', sqlTitleFromRel('db/init.sql'), 'init');
eq('子目录里的 SQL 只取最后一段', sqlTitleFromRel('a/b/c/建表.SQL'), '建表');
eq('Windows 反斜杠分隔也能取到标题', sqlTitleFromRel('db\\sub\\view.sql'), 'view');
eq('没有扩展名时原样作标题', sqlTitleFromRel('README'), 'README');
eq('超长文件名截断到 60 字', sqlTitleFromRel('x'.repeat(80) + '.sql').length, 60);
eq('空路径不崩', sqlTitleFromRel(''), '未命名');

// 行为：再次导入同一份文件时的动作（内容一致 → 跳过，内容有变化 → 更新）
const planSqlImport = new Function(`${extractFunction(html, 'planSqlImport')}; return planSqlImport;`)();
eq('首次导入 → 新增', planSqlImport(null, 'select 1;'), 'add');
eq('内容一致 → 跳过', planSqlImport({ content: 'select 1;' }, 'select 1;'), 'skip');
eq('内容有变化 → 更新', planSqlImport({ content: 'select 1;' }, 'select 2;'), 'update');
eq('缺 content 字段时按空串比较（不崩）', planSqlImport({}, ''), 'skip');

// 行为：体积显示
const formatBytes = new Function(`${extractFunction(html, 'formatBytes')}; return formatBytes;`)();
eq('小于 1KB 用字节', formatBytes(512), '512 B');
eq('KB 保留一位小数', formatBytes(2048), '2.0 KB');
eq('MB 保留两位小数', formatBytes(3 * 1024 * 1024), '3.00 MB');
eq('非法值按 0 处理', formatBytes(undefined), '0 B');

// 行为：纯文本摘要（原样文本，不剥 Markdown 标记）
const plainSnippet = new Function(`${extractFunction(html, 'plainSnippet')}; return plainSnippet;`)();
eq('摘要折掉空白', plainSnippet('a\n\n  b\tc', 24), 'a b c');
eq('摘要超长截断加省略号', plainSnippet('x'.repeat(30), 10), 'xxxxxxxxxx…');
eq('空内容给空串', plainSnippet(null, 10), '');

const textTitleApi = new Function(
  `${extractFunction(html, 'plainSnippet')}\n${extractFunction(html, 'textNoteTitle')}\nreturn textNoteTitle;`,
)();
eq('纯文本标题优先用标题字段', textTitleApi({ title: '标题', content: '正文' }), '标题');
eq('无标题时取正文开头', textTitleApi({ title: '  ', content: '第一行内容在这里' }), '第一行内容在这里');
eq('无标题无正文给「无标题」', textTitleApi({}), '无标题');
eq('纯文本标题不剥 Markdown 标记（不按 md 渲染）', textTitleApi({ content: '# 不是标题' }), '# 不是标题');

// 静态：两个新 TAB 的 DOM 与切换接线
contains('顶部有「📝 纯文本」TAB', html, 'data-tab="text"');
contains('顶部有「🗄️ SQL」TAB', html, 'data-tab="sql"');
contains('纯文本页存在', html, 'id="pageText"');
contains('SQL 页存在', html, 'id="pageSql"');
contains('纯文本 TAB 有计数徽标', html, 'id="textCount"');
contains('SQL TAB 有计数徽标', html, 'id="sqlCount"');
const switchTabSrc2 = extractFunction(html, 'switchTab');
contains('切页切换纯文本页', switchTabSrc2, "pageText.classList.toggle('active', name === 'text')");
contains('切页切换 SQL 页', switchTabSrc2, "pageSql.classList.toggle('active', name === 'sql')");
contains('切到纯文本页渲染列表', switchTabSrc2, 'renderTextList();');
contains('切到 SQL 页渲染分组树', switchTabSrc2, 'renderSqlTree();');
contains('切页保持纯文本页原状态（不再强制落库）', switchTabSrc2, "if (textEditing && textEditor.style.display !== 'none')");
notContains('离开纯文本页不再调用已删除的 flushTextNote', switchTabSrc2, 'flushTextNote');

// 静态：纯文本「不通过 Markdown 渲染」——正文原样出现在只读区（阅读模式）与 textarea（编辑模式）
const pageTextHtml = html.slice(html.indexOf('id="pageText"'), html.indexOf('id="pageSql"'));
notContains('纯文本页没有 Markdown 预览区', pageTextHtml, 'md-preview');
notContains('纯文本页没有 Markdown 工具栏', pageTextHtml, 'md-toolbar');
notContains('纯文本页不引用 mdToHtml', pageTextHtml, 'mdToHtml');
notContains('纯文本摘要不剥 Markdown 标记', extractFunction(html, 'textNoteTitle'), 'extractPlainText');
contains('纯文本正文区是等宽 textarea', pageTextHtml, 'class="plain-textarea"');

// 静态：阅读 / 编辑模式切换（与笔记模块同口径）
contains('阅读模式面板存在', pageTextHtml, 'id="textViewer"');
contains('阅读模式用等宽只读区', pageTextHtml, 'id="textPre"');
contains('阅读模式有编辑按钮', pageTextHtml, 'id="textEditBtn"');
contains('编辑模式有保存按钮', pageTextHtml, 'id="textSaveBtn"');
contains('编辑模式有取消按钮', pageTextHtml, 'id="textCancelBtn"');
contains('点列表条目进阅读模式（不是直接编辑）', extractFunction(html, 'selectTextNote'), 'textEditing = false');
contains('阅读区用 textContent 原样输出', extractFunction(html, 'renderTextViewer'), 'textPre.textContent');
notContains('阅读区不经过 Markdown 渲染', extractFunction(html, 'renderTextViewer'), 'mdToHtml');
contains('编辑按钮绑定「进编辑模式」', html, "textEditBtn.addEventListener('click', startTextEdit)");
contains('保存按钮绑定「保存」', html, "textSaveBtn.addEventListener('click', () => void saveTextNote())");
contains('取消按钮绑定「取消编辑」', html, "textCancelBtn.addEventListener('click', cancelTextEdit)");
contains('关闭按钮绑定「回空状态」', html, "textCloseBtn.addEventListener('click', closeTextNote)");
contains('新建直接进编辑模式', extractFunction(html, 'newTextNote'), 'textEditing = true');
contains('取消编辑：已有笔记回阅读模式', extractFunction(html, 'cancelTextEdit'), 'renderTextViewer();');
contains('取消编辑：新笔记回空状态', extractFunction(html, 'cancelTextEdit'), 'showTextEmpty();');
contains('取消编辑会丢弃改动的提示', extractFunction(html, 'cancelTextEdit'), 'textEditing = false;');
contains('编辑模式载入正文', extractFunction(html, 'startTextEdit'), 'textArea.value = t.content');
contains('保存后留在编辑模式', extractFunction(html, 'saveTextNote'), "'✓ 已保存'");
contains('保存失败会回滚内存', extractFunction(html, 'saveTextNote'), 'textNotes.filter(t => t.id !== rec.id)');
contains('保存写入 vault', extractFunction(html, 'saveTextNote'), 'await persistData();');
contains('保存不覆盖原 timestamp（与笔记模块一致）', extractFunction(html, 'saveTextNote'), 'timestamp: Date.now()');
contains('删除需确认', extractFunction(html, 'deleteTextNote'), 'confirm(');
contains('删除当前笔记时关闭面板', extractFunction(html, 'deleteTextNote'), 'closeTextNote();');
contains('Ctrl+Enter 立即保存', html, "(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
contains('纯文本列表用事件委托', html, "textList.addEventListener('click'");
contains('纯文本搜索接线', html, "textSearch.addEventListener('input'");
notContains('已移除自动保存定时器', html, 'TEXT_AUTOSAVE_MS');
notContains('已移除自动保存函数', html, 'scheduleTextAutosave');
notContains('已移除脏检查函数', html, 'textDirtyNow');
contains('锁定复位编辑态', extractFunction(html, 'lockApp'), 'textEditing = false;');
contains('锁定清空阅读区明文', extractFunction(html, 'lockApp'), 'textPre.textContent');

// 静态：SQL 导入链路（目录 → Rust 只读读取 → 入库）与安全约束
contains('SQL 导入面板存在', html, 'id="sqlImportPanel"');
contains('SQL 目录输入框存在', html, 'id="sqlDirInput"');
contains('SQL 扫描命令接线', html, "tauriInvoke('sql_scan_dir'");
contains('SQL 读取命令接线', html, "tauriInvoke('sql_read_file'");
contains('SQL 选目录走系统对话框命令', html, "tauriInvoke('sql_browse_dir'");
contains('导入按钮串起扫描与读取', extractFunction(html, 'runSqlImport'), "tauriInvoke('sql_read_file'");
contains('导入前先扫描（拿不到清单就报错返回）', extractFunction(html, 'runSqlImport'), 'if (!scan || !scan.ok)');
contains('按身份键去重', extractFunction(html, 'runSqlImport'), 'sqlEntryKey(dir, f.relPath)');
contains('内容一致跳过 / 有变化更新', extractFunction(html, 'runSqlImport'), "planSqlImport(exist, content) === 'skip'");
contains('有单次文件数上限', extractFunction(html, 'runSqlImport'), 'MAX_SQL_FILES');
contains('有单次总体积上限', extractFunction(html, 'runSqlImport'), 'MAX_SQL_TOTAL_BYTES');
contains('导入途中被锁定则不写入', extractFunction(html, 'runSqlImport'), '导入过程中应用已锁定，本次导入未保存');
contains('写入失败回滚新增条目', extractFunction(html, 'runSqlImport'), 'sqlFiles.filter(f => !ids.has(f.id))');
contains('写入失败回滚已更新条目', extractFunction(html, 'runSqlImport'), 'backup.forEach(b => {');
contains('导入后落库', extractFunction(html, 'runSqlImport'), 'await persistData();');
contains('记住导入目录到 UI 偏好', extractFunction(html, 'runSqlImport'), 'saveUiPrefs();');
contains('导入结果复用统一结果弹层', extractFunction(html, 'showSqlImportReport'), 'importModal.style.display');
contains('导入结果里的路径都转义', extractFunction(html, 'showSqlImportReport'), 'escapeHtml(f)');
contains('SQL 分组树用事件委托', html, "sqlTree.addEventListener('click'");
contains('SQL 删除需确认且不动磁盘文件', extractFunction(html, 'deleteSqlFiles'), '磁盘上的文件不受影响');
contains('SQL 搜索接线', html, "sqlSearch.addEventListener('input'");
notContains('前端不提供 SQL 写入/执行接口', html, "tauriInvoke('sql_write");
notContains('前端不执行 SQL', html, 'executeSql');
notContains('前端不提供删除磁盘文件的接口', html, "tauriInvoke('sql_delete");

// 静态：SQL 查看区原样显示（textContent，不解析 HTML / 不渲染 Markdown）
contains('SQL 正文用 textContent 输出', extractFunction(html, 'viewSqlFile'), 'sqlPre.textContent');
notContains('SQL 查看不经过 Markdown 渲染', extractFunction(html, 'viewSqlFile'), 'mdToHtml');
notContains('SQL 页面无 Markdown 预览区', html.slice(html.indexOf('id="pageSql"'), html.indexOf('id="pageJson"')), 'md-preview');

// 静态：Rust 侧只读约束
const sqlProd = sqlRs.split('#[cfg(test)]')[0];contains('Rust 命令已注册', libRs, 'sql_import::sql_scan_dir');
contains('扫描只读目录', sqlProd, 'std::fs::read_dir');
contains('读取文件内容只读', sqlProd, 'std::fs::read');
contains('复用绑定目录的越界校验', sqlProd, 'crate::watch::resolve_inside');
contains('有单文件大小上限', sqlProd, 'MAX_FILE_BYTES');
contains('有递归深度上限', sqlProd, 'MAX_DEPTH');
contains('有扫描数量上限', sqlProd, 'MAX_SCAN_ENTRIES');
contains('选目录复用导出模块的对话框（自带 CREATE_NO_WINDOW）', sqlProd, 'crate::export::pick_folder');
notContains('Rust 侧不写任何文件', sqlProd, 'fs::write');
notContains('Rust 侧不删除文件', sqlProd, 'remove_file');
notContains('Rust 侧不删除目录', sqlProd, 'remove_dir');
notContains('Rust 侧不起子进程', sqlProd, 'Command::new');
notContains('Rust 侧不碰密钥 / 密文', sqlProd, 'vault');

// 静态：vault 持久化 / 生命周期（新数据随 vault 加密保存，锁定即清空）
contains('纯文本随 vault 加密持久化', extractFunction(html, 'persistData'), 'textNotes, sqlFiles, sqlGroups, sqlWatchers }');
contains('SQL 文件随 vault 加密持久化', extractFunction(html, 'buildVault'), 'textNotes, sqlFiles, sqlGroups, sqlWatchers }');
contains('解锁时载入纯文本', extractFunction(html, 'unlockApp'), 'payload.textNotes');
contains('解锁时载入 SQL', extractFunction(html, 'unlockApp'), 'payload.sqlFiles');
contains('改 PIN 时全量重加密（含纯文本与 SQL）', extractFunction(html, 'submitChangePin'), 'watchers, textNotes, sqlFiles, sqlGroups, sqlWatchers }');
contains('锁定清空纯文本', extractFunction(html, 'lockApp'), 'textNotes = [];');
contains('锁定清空 SQL', extractFunction(html, 'lockApp'), 'sqlFiles = [];');
contains('锁定清空 SQL 查看区明文', extractFunction(html, 'lockApp'), 'sqlPre.textContent = \'\';');
contains('锁定清空纯文本编辑区明文', extractFunction(html, 'lockApp'), 'textArea.value = \'\';');
contains('锁定关闭 SQL 导入面板', extractFunction(html, 'lockApp'), 'closeSqlImportPanel();');
contains('解锁渲染纯文本列表', extractFunction(html, 'unlockSuccess'), 'renderTextList();');
contains('解锁渲染 SQL 分组树', extractFunction(html, 'unlockSuccess'), 'renderSqlTree();');
contains('解锁恢复 SQL 导入目录', extractFunction(html, 'unlockSuccess'), 'sqlDirInput.value = sqlDir;');
contains('启动时渲染两个新列表', extractFunction(html, 'init'), 'renderSqlLimitHint();');
contains('锁定清空 SQL 搜索', extractFunction(html, 'lockApp'), 'sqlSearchQuery = \'\';');

// 静态：三个模块的侧栏宽度（拖动 / 记忆 / 双击恢复默认）共用同一套逻辑与同一个宽度
const pageSqlHtml = html.slice(html.indexOf('id="pageSql"'), html.indexOf('id="pageJson"'));
contains('纯文本侧栏带 id', html, 'class="sidebar" id="textSidebar"');
contains('SQL 侧栏带 id', html, 'class="sidebar" id="sqlSidebar"');
contains('纯文本侧栏有拖动手柄', html, 'id="textSidebarResizer"');
contains('SQL 侧栏有拖动手柄', html, 'id="sqlSidebarResizer"');
const sidebarCss = html.slice(html.indexOf('.sidebar {'), html.indexOf('.sidebar {') + 220);
contains('侧栏 CSS 默认宽度 240px（三个模块共用）', sidebarCss, 'width: 240px;');
contains('默认宽度常量仍是 240', html, 'const SIDEBAR_W_DEFAULT = 240;');
contains('宽度应用到三个侧栏', extractFunction(html, 'applySidebarWidth'), '[textSidebar, sqlSidebar, jsonHistoryPane]');
// JSON 历史栏也支持拖动（与笔记模块同一套逻辑与同一宽度）
contains('JSON 历史栏带 id', html, 'class="json-card json-history" id="jsonHistory"');
contains('JSON 历史栏有拖动手柄', html, 'id="jsonResizer"');
contains('JSON 历史栏可定位手柄', html, '.json-history {');
contains('JSON 手柄拖动已绑定', html, "jsonResizer.addEventListener('pointerdown', e => startSidebarResize(e, jsonHistoryPane))");
contains('JSON 手柄支持双击恢复默认', html, "jsonResizer.addEventListener('dblclick', resetSidebarWidth)");
contains('拖动逻辑接受被拖侧栏参数', extractFunction(html, 'startSidebarResize'), 'sideEl');
contains('笔记侧栏拖动传自身元素', html, "sidebarResizer.addEventListener('pointerdown', e => startSidebarResize(e, groupSidebar))");
contains('纯文本侧栏拖动已绑定', html, "textSidebarResizer.addEventListener('pointerdown', e => startSidebarResize(e, textSidebar))");
contains('SQL 侧栏拖动已绑定', html, "sqlSidebarResizer.addEventListener('pointerdown', e => startSidebarResize(e, sqlSidebar))");
check('四个侧栏都支持双击恢复默认宽度（笔记 / 纯文本 / SQL / JSON）',
  (html.match(/addEventListener\('dblclick', resetSidebarWidth\)/g) || []).length === 4,
  String((html.match(/addEventListener\('dblclick', resetSidebarWidth\)/g) || []).length));
contains('拖动结束才落库（避免每帧写偏好）', extractFunction(html, 'startSidebarResize'), 'saveUiPrefs();');
contains('窗口尺寸变化时重算侧栏宽度', html, "window.addEventListener('resize', applySidebarWidth)");

// 行为：宽度夹取（默认 240 / 最小 160 / 最大 560 / 同时受窗口宽度约束）
const clampMade = new Function('window', 'SIDEBAR_W_MIN', 'SIDEBAR_W_MAX',
  `${extractFunction(html, 'clampSidebarWidth')}; return clampSidebarWidth;`);
const clampWide = clampMade({ innerWidth: 1600 }, 160, 560);
const clampNarrow = clampMade({ innerWidth: 800 }, 160, 560);
eq('宽度下限 160', clampWide(50), 160);
eq('宽度上限 560', clampWide(9999), 560);
eq('区间内原样返回', clampWide(300), 300);
eq('窄窗口下受窗口宽度约束（800-420=380）', clampNarrow(9999), 380);
eq('窄窗口也不会低于下限', clampNarrow(50), 160);

// 静态：SQL 模块**只读**（无可编辑控件、无保存函数、正文用 textContent 原样输出）
contains('SQL 查看区标注「只读」', pageSqlHtml, 'class="ro-badge"');
notContains('SQL 页面没有输入控件', pageSqlHtml, '<textarea');
notContains('SQL 页面没有可编辑容器', pageSqlHtml, 'contenteditable');
notContains('前端没有写回 SQL 的函数', html, 'saveSqlFile');
contains('SQL 树点击只打开只读查看', html, 'viewSqlFile(id);');

// 行为：搜索匹配（标题 + 内容）与命中片段
const tMatch = new Function(`${extractFunction(html, 'textNoteMatches')}; return textNoteMatches;`)();
eq('纯文本：标题命中', tMatch({ title: '建表脚本', content: 'x' }, '建表'), true);
eq('纯文本：内容命中（标题不含）', tMatch({ title: 'a', content: 'select * from t' }, 'select'), true);
eq('纯文本：大小写不敏感', tMatch({ title: 'A', content: 'SELECT' }, 'select'), true);
eq('纯文本：都不含则未命中', tMatch({ title: 'a', content: 'b' }, 'zzz'), false);
eq('纯文本：空查询视为全部命中', tMatch({ title: 'a', content: '' }, '   '), true);

const sMatch = new Function(
  `const SQL_EXT_RE = ${html.match(/const SQL_EXT_RE = (\/.*?\/i);/)[1]};
   ${extractFunction(html, 'sqlTitleFromRel')}
   ${extractFunction(html, 'sqlEntryTitle')}
   ${extractFunction(html, 'sqlFileMatches')}
   return sqlFileMatches;`,
)();
eq('SQL：标题（文件名）命中', sMatch({ title: 'init', content: 'x' }, 'ini'), true);
eq('SQL：内容命中（标题不含）', sMatch({ title: 'init', content: 'CREATE TABLE t' }, 'create table'), true);
eq('SQL：相对路径命中', sMatch({ title: 'a', relPath: 'db/sub/a.sql', content: '' }, 'sub'), true);
eq('SQL：标题缺省时用文件名兜底匹配', sMatch({ relPath: 'db/建表.sql', content: '' }, '建表'), true);
eq('SQL：都不含则未命中', sMatch({ title: 'a', content: 'b' }, 'zzz'), false);

const snippetOf = new Function(
  `${extractFunction(html, 'escapeHtml')}\n${extractFunction(html, 'highlightMatch')}\n${extractFunction(html, 'matchSnippet')}\nreturn matchSnippet;`,
)();
check('命中片段带高亮标记', snippetOf('aaa NEEDLE bbb', 'needle').includes('<mark>'), snippetOf('aaa NEEDLE bbb', 'needle'));
check('命中片段截断处加省略号', snippetOf('x'.repeat(60) + 'NEEDLE' + 'y'.repeat(60), 'needle', 5).startsWith('…'));
eq('未命中时片段为空串', snippetOf('abc', 'zzz'), '');
eq('片段把命中内容转义（XSS 安全）', snippetOf('<img src=x>NEEDLE', 'needle').includes('&lt;img'), true);

// 静态：搜索接线（两个模块都用同一套匹配函数）
contains('纯文本列表用匹配函数过滤', extractFunction(html, 'renderTextList'), 'textNoteMatches(t, q)');
contains('纯文本搜索显示命中片段', extractFunction(html, 'renderTextList'), 'matchSnippet(t.content, q)');
contains('SQL 搜索用匹配函数过滤', extractFunction(html, 'renderSqlSearchResults'), 'sqlFileMatches(f, q)');
contains('SQL 搜索结果显示命中片段', extractFunction(html, 'renderSqlSearchResults'), 'matchSnippet(f.content, q)');
contains('SQL 搜索提示搜索范围', extractFunction(html, 'renderSqlSearchResults'), '搜索范围：标题 / 内容 / 相对路径');
contains('纯文本搜索提示搜索范围', extractFunction(html, 'renderTextList'), '搜索范围：标题 / 内容');

// ---------- 15. SQL 分组（与笔记模块同逻辑的一套独立分组） ----------
section('SQL 分组 / 打开单个 SQL 文件 / SQL 目录监听（行为 + 静态检查）');

contains('SQL 侧栏是分组树', html, 'class="group-tree" id="sqlTree"');
contains('SQL 有新建分组按钮', html, 'id="sqlNewGroupBtn"');
contains('SQL 分组树渲染入口存在', html, 'function renderSqlTree()');
contains('SQL 未分组虚拟根', extractFunction(html, 'renderSqlUngroupedRoot'), '未分组');
contains('SQL 分组节点带 CRUD 按钮', extractFunction(html, 'renderSqlGroupNode'), 'data-act="child"');
contains('SQL 分组可重命名', extractFunction(html, 'renderSqlGroupNode'), 'data-act="rename"');
contains('SQL 分组可移动', extractFunction(html, 'renderSqlGroupNode'), 'data-act="moveto"');
contains('SQL 分组可删除', extractFunction(html, 'renderSqlGroupNode'), 'data-act="delete"');
contains('SQL 条目可移动 / 删除', extractFunction(html, 'renderSqlLeaf'), 'data-act="move"');
contains('SQL 分组数据独立于笔记分组', extractFunction(html, 'sqlChildrenMap'), 'sqlGroups');
contains('SQL 分组路径标签', extractFunction(html, 'sqlGroupPathLabel'), 'sqlGroups.find');
contains('删除 SQL 分组时条目回落未分组', extractFunction(html, 'deleteSqlGroup'), 'f.groupId = null');
contains('删除 SQL 分组时监听绑定回落', extractFunction(html, 'deleteSqlGroup'), 'sqlWatchers.forEach');
contains('SQL 分组删除要确认', extractFunction(html, 'deleteSqlGroup'), 'confirm(');
contains('SQL 分组建树与笔记同规则（同级 order 追加）', extractFunction(html, 'addSqlGroup'), 'order = siblings.length');
contains('SQL 分组树可插入行内输入框', html, 'insertInlineInput(id, name => { createSqlGroup(id, name); }, sqlTree, sqlGetDepth)');
contains('SQL 分组树点击用事件委托', html, "const groupItem = e.target.closest('.tree-item[data-sqlgroup]')");
contains('点箭头只展开折叠', html, "if (e.target.closest('.tree-chevron')) { toggleSqlGroup(id || null); return; }");
contains('SQL 分组选择器复用 #moveMenu', extractFunction(html, 'openSqlMoveMenu'), 'moveMenu._state');
contains('SQL 分组选择器排除自身与子孙', extractFunction(html, 'buildSqlMoveTargets'), 'sqlCollectDescendantIds(id)');
contains('SQL 移动落库（含防环）', extractFunction(html, 'moveSqlItemToGroup'), 'sqlCollectDescendantIds(g.id).includes(target)');
check('SQL 模式在分组选择器里被分发', /st\.mode === 'sql' \|\| st\.mode === 'sql-multi' \|\| st\.mode === 'sql-group'/.test(html));
check('SQL 批量移动模式在分组选择器里被分发（新建分组并移入也认）',
    /st\.mode === 'sql' \|\| st\.mode === 'sql-multi' \|\| st\.mode === 'sql-group' \|\| st\.mode === 'sql-save'/.test(html));
check('SQL 保存模式在分组选择器里被分发', /st\.mode === 'sql-save'/.test(html));
check('SQL 监听模式在分组选择器里被分发', /st\.mode === 'sql-watch'/.test(html));

// 导入目标分组 = 当前选中的 SQL 分组
contains('目录批量导入落到当前 SQL 分组', extractFunction(html, 'runSqlImport'), 'const targetGid = currentSqlGroupId');
contains('新条目带 groupId', extractFunction(html, 'runSqlImport'), 'groupId: targetGid');
contains('导入报告显示目标分组', extractFunction(html, 'showSqlImportReport'), 'r.targetName');
contains('导入后展开目标分组', extractFunction(html, 'runSqlImport'), 'expandedSqlGroups.add(targetGid');

// 打开单个 SQL 文件
contains('有隐藏的单文件输入', html, 'id="sqlOpenInput"');
contains('导入菜单有二选一', html, 'id="sqlImportMenu"');
contains('导入菜单区分目录 / 单文件', html, 'data-mode="file"');
contains('单文件入口函数存在', html, 'function startSqlOpen()');
contains('单文件读取后弹分组选择器', extractFunction(html, 'openSqlInPicker'), "openSqlMoveMenu(sqlImportBtn, 'sql-save', '')");
contains('单文件读取会解码（UTF-8 / GBK）', extractFunction(html, 'openSqlInPicker'), 'decodeMdBytes(buf)');
contains('单文件保存到所选分组', extractFunction(html, 'saveSqlToGroup'), 'groupId: gid || null');
contains('单文件同名同内容跳过', extractFunction(html, 'saveSqlToGroup'), '该文件内容未变化');
contains('单文件同名有变化则更新', extractFunction(html, 'saveSqlToGroup'), '已更新同名 SQL 文件');
contains('单文件保存失败回滚', extractFunction(html, 'saveSqlToGroup'), 'sqlFiles = sqlFiles.filter(f => f.id !== rec.id)');
contains('单文件输入已绑定', html, "sqlOpenInput.addEventListener('change'");
contains('导入按钮打开菜单（不再直接展开面板）', html, "if (sqlImportMenu.style.display === 'block') { closeSqlImportMenu(); return; }");
contains('点外部关闭 SQL 导入菜单', html, "e.target.closest('#sqlImportMenu') !== sqlImportMenu");

// SQL 目录监听（设置页，与 Markdown 分开）
contains('设置页有独立的 SQL 监听行', html, 'id="sqlWatchAddBtn"');
contains('设置页有独立的 SQL 监听面板', html, 'id="sqlWatchAddPanel"');
contains('设置页有独立的 SQL 绑定列表', html, 'id="sqlWatchList"');
contains('设置页有独立的 SQL 状态行', html, 'id="sqlWatchStatus"');
contains('设置页有独立的 SQL 错误位', html, 'id="sqlWatchErr"');
contains('Markdown 绑定列表仍是独立元素', html, 'class="watch-list" id="watchList"');
contains('SQL 绑定列表是另一个独立元素', html, 'class="watch-list" id="sqlWatchList"');
contains('Markdown 状态行仍是独立元素', html, 'id="watchStatus"');
contains('SQL 状态行是另一个独立元素', html, 'id="sqlWatchStatus"');
contains('SQL 绑定写入 vault', extractFunction(html, 'persistData'), 'sqlGroups, sqlWatchers }');
contains('建空库也带 SQL 字段', extractFunction(html, 'buildVault'), 'sqlGroups, sqlWatchers }');
contains('解锁载入 SQL 分组', extractFunction(html, 'unlockApp'), 'payload.sqlGroups');
contains('解锁载入 SQL 监听绑定', extractFunction(html, 'unlockApp'), 'payload.sqlWatchers');
contains('改 PIN 时一并保留 SQL 数据', extractFunction(html, 'submitChangePin'), 'sqlGroups, sqlWatchers }');
contains('锁定清空 SQL 分组', extractFunction(html, 'lockApp'), 'sqlGroups = [];');
contains('锁定清空 SQL 监听绑定', extractFunction(html, 'lockApp'), 'sqlWatchers = [];');
contains('解锁渲染 SQL 监听状态', extractFunction(html, 'unlockSuccess'), 'renderSqlWatchUi();');
contains('进入设置页渲染 SQL 监听', extractFunction(html, 'switchTab'), 'renderSqlWatchUi();');
contains('SQL 绑定列表用事件委托', html, "sqlWatchList.addEventListener('click'");
for (const act of ['toggle', 'group', 'import', 'remove']) {
  contains(`SQL 绑定列表支持 ${act} 操作`, html, `act === '${act}'`);
}
contains('SQL 监听检查目录时带 kind', html, "{ payload: { dir: dir, kind: 'sql' } }");
contains('监听启动时两套绑定都交给 Rust', extractFunction(html, 'watchStart'), "kind: 'md'");
contains('SQL 绑定以 kind=sql 交给 Rust', extractFunction(html, 'watchStart'), "kind: 'sql'");
contains('登记表按 bindingId 合并两套绑定', extractFunction(html, 'watchKnownPayload'), 'sqlWatchActive()');
contains('事件处理按绑定类型分流到 SQL', extractFunction(html, 'applyWatchEvents'), 'sqlWatcherById(ev.bindingId)');
contains('SQL 新增事件建条目', extractFunction(html, 'applyWatchEvents'), 'srcDir: sqlBinding.dir');
contains('SQL 删除事件标记（不静默丢弃副本）', extractFunction(html, 'applyWatchEvents'), 'victim.missing = true');
contains('事件处理后重绘 SQL 树', extractFunction(html, 'applyWatchEvents'), 'renderSqlTree();');
contains('SQL 监听统计单独记录', extractFunction(html, 'applyWatchEvents'), 'sqlWatchStats = { created: sqlCreated');
contains('SQL 绑定可以「导入现有」', html, 'function importSqlWatchExisting(id)');

// 行为：SQL 目录监听的事件计划（纯函数）
const planSqlWatchEvent = new Function(
  'sqlGroups', 'sqlFiles',
  `${extractFunction(html, 'planSqlWatchEvent')}; return planSqlWatchEvent;`,
)([{ id: 'sg1', name: '建表' }], [{ id: 9 }]);
const sqlBind = (known, groupId = 'sg1') => ({ id: 'sw1', dir: 'D:/db', groupId, enabled: true, known });
eq('SQL 新增 → 建条目', planSqlWatchEvent(sqlBind({}), { bindingId: 'sw1', relPath: 'a.sql', kind: 'added' }).action, 'create');
eq('SQL 新增落到绑定分组', planSqlWatchEvent(sqlBind({}), { bindingId: 'sw1', relPath: 'a.sql', kind: 'added' }).groupId, 'sg1');
eq('SQL 已登记不重复导入', planSqlWatchEvent(sqlBind({ 'a.sql': null }), { bindingId: 'sw1', relPath: 'a.sql', kind: 'added' }).action, 'ignore');
eq('SQL 绑定分组已删则回落未分组', planSqlWatchEvent(sqlBind({}, 'sg_gone'), { bindingId: 'sw1', relPath: 'a.sql', kind: 'added' }).groupId, null);
eq('SQL 删除 → 标记已有条目', planSqlWatchEvent(sqlBind({ 'a.sql': 9 }), { bindingId: 'sw1', relPath: 'a.sql', kind: 'removed' }).action, 'mark');
eq('SQL 删除的是基线条目 → 只撤销登记', planSqlWatchEvent(sqlBind({ 'a.sql': null }), { bindingId: 'sw1', relPath: 'a.sql', kind: 'removed' }).action, 'forget');
eq('SQL 条目已不存在 → 只撤销登记', planSqlWatchEvent(sqlBind({ 'a.sql': 999 }), { bindingId: 'sw1', relPath: 'a.sql', kind: 'removed' }).action, 'forget');
eq('SQL 未知事件被忽略', planSqlWatchEvent(sqlBind({}), { bindingId: 'sw1', relPath: 'a.sql', kind: 'changed' }).action, 'ignore');
eq('SQL 未找到绑定时忽略', planSqlWatchEvent(null, { bindingId: 'sw9', relPath: 'a.sql', kind: 'added' }).action, 'ignore');

// Rust 侧：绑定类型
const watchProdSrc = watchProd;
contains('Rust 绑定带 kind 字段', watchProdSrc, 'pub kind: String');
contains('Rust 旧前端缺 kind 时默认 md', watchProdSrc, 'fn kind_md() -> String');
contains('Rust 按类型识别 SQL 文件', watchProdSrc, 'fn is_sql(name: &str) -> bool');
contains('Rust 扫描按 kind 过滤', watchProdSrc, 'fn is_watched(name: &str, kind: &str) -> bool');
contains('Rust 扫描按绑定的 kind 执行', watchProdSrc, 'scan_files(Path::new(&b.dir), &b.kind)');
contains('Rust 检查目录支持 kind 参数', watchProdSrc, 'pub fn check_dir_kind(dir: &str, kind: &str)');
contains('检查命令读取可选 kind', watchProdSrc, 'payload.get("kind")');

// ---------- 16. Tauri 命令的参数契约 ---------- —— Rust 端签名是 `payload: Value` 的命令，
// 前端必须写成 `invoke(cmd, { payload: {...} })`；漏掉这层包装时 Tauri 直接报
// `invalid args 'payload' for command xxx: missing required key payload`（SQL 导入首次上线就踩过）。
const payloadCommands = [
  'bridge_start', 'bridge_sync', 'watch_start', 'watch_set_known', 'watch_read', 'watch_check_dir',
  'sql_scan_dir', 'sql_read_file', 'sql_browse_dir',
  'export_write_files', 'export_save_file', 'export_pick_dir', 'export_pick_save',
];
const rustByCommand = {
  bridge_start: bridgeRs, bridge_sync: bridgeRs,
  watch_start: watchRs, watch_set_known: watchRs, watch_read: watchRs, watch_check_dir: watchRs,
  sql_scan_dir: sqlRs, sql_read_file: sqlRs, sql_browse_dir: sqlRs,
  export_write_files: exportRs, export_save_file: exportRs, export_pick_dir: exportRs, export_pick_save: exportRs,
};
for (const cmd of payloadCommands) {
  const rustAt = rustByCommand[cmd].indexOf(`fn ${cmd}(`);
  check(`Rust 端 ${cmd} 仍是 payload 形参`, rustAt > 0 && rustByCommand[cmd].slice(rustAt, rustAt + 200).includes('payload'));
  // 严格判定：命令名后必须紧跟 `, { payload`（允许换行）——宽松的「300 字符内出现 payload」
  // 会被邻近的其它调用蒙混过去
  const re = new RegExp(`tauriInvoke\\('${cmd}'\\s*,\\s*\\{\\s*payload\\s*:`);
  const at = html.indexOf(`tauriInvoke('${cmd}'`);
  check(`前端调用 ${cmd} 带 { payload } 包装`, re.test(html),
    at >= 0 ? `实际：${html.slice(at, at + 90).split('\n')[0].trim()}` : '未找到调用点');
}

// ---------- 17. SQL 批量删除 / 移动（多选，与笔记模块同口径） ---------- ——
// 「Ctrl/⌘ 点击多选、Shift 连选、选择栏批量删除/移动」这套交互在笔记模块已有先例，
// SQL 侧必须完全照做：① 选择是 Set，锁定即清空；② 删除只删应用内副本、磁盘文件不动；
// ③ 批量移动复用同一个 #moveMenu（mode='sql-multi'），跨分组时不标 ✓。
section('SQL 批量删除 / 移动（多选，行为 + 静态检查）');

// 行为：多选状态机（toggle / 连选 / 计数 / 失效 id 剔除），用假 DOM 驱动提取出的函数
function makeSqlSelHarness(visibleIds, files) {
  const factory = new Function('files', 'visibleIds', `
    let sqlFiles = files;
    let selectedSqlIds = new Set();
    let lastSelSqlId = null;
    const sqlTree = { querySelectorAll: () => visibleIds.map(id => ({ dataset: { sql: String(id) } })) };
    const sqlSelBar = { style: { display: 'none' } };
    const sqlSelCount = { textContent: '' };
    let renders = 0;
    // renderSqlTree 在真实代码里顺带同步选择栏，harness 必须照做（否则计数断言失真）
    function renderSqlTree() { renders++; updateSqlSelBar(); }
    ${extractFunction(html, 'sqlFileById')}
    ${extractFunction(html, 'sqlVisibleIds')}
    ${extractFunction(html, 'updateSqlSelBar')}
    ${extractFunction(html, 'toggleSqlSelection')}
    ${extractFunction(html, 'selectSqlRange')}
    ${extractFunction(html, 'clearSqlSelection')}
    return {
      toggle: toggleSqlSelection, range: selectSqlRange, clear: clearSqlSelection,
      ids: () => Array.from(selectedSqlIds).sort((a, b) => a - b),
      anchor: () => lastSelSqlId,
      bar: () => sqlSelBar.style.display,
      label: () => sqlSelCount.textContent,
      renders: () => renders,
      drop: id => { sqlFiles = sqlFiles.filter(f => f.id !== id); updateSqlSelBar(); },
    };
  `);
  return factory(files, visibleIds);
}
const selHarness = () => makeSqlSelHarness([1, 2, 3, 4, 5], [1, 2, 3, 4, 5].map(id => ({ id, relPath: 'a' + id + '.sql' })));

let sel = selHarness();
eq('初始不显示选择栏', sel.bar(), 'none');
sel.toggle(3);
eq('Ctrl/⌘ 点击选中一条', sel.ids().join(','), '3');
eq('选中后显示选择栏', sel.bar(), 'flex');
eq('选择栏显示已选数量', sel.label(), '已选 1 个');
sel.toggle(3);
eq('再点一次取消选中', sel.ids().length, 0);
eq('全部取消后隐藏选择栏', sel.bar(), 'none');

sel = selHarness();
sel.toggle(2);
sel.range(5);
eq('Shift 向后连选（含锚点）', sel.ids().join(','), '2,3,4,5');
eq('Shift 连选不移动锚点', sel.anchor(), 2);

sel = selHarness();
sel.toggle(4);
sel.range(2);
eq('Shift 向前连选', sel.ids().join(','), '2,3,4');

sel = selHarness();
sel.range(3);
eq('没有锚点时 Shift 等同单选', sel.ids().join(','), '3');

sel = selHarness();
sel.toggle(3);
sel.range(99);
eq('目标不在可见列表时 Shift 不改变选择', sel.ids().join(','), '3');

sel = selHarness();
sel.toggle(1);
sel.toggle(3);
sel.clear();
eq('取消选择清空全部', sel.ids().length, 0);
eq('取消选择隐藏选择栏', sel.bar(), 'none');

sel = selHarness();
sel.toggle(3);
sel.toggle(5);
sel.drop(3);
eq('已删除的条目从多选中剔除', sel.ids().join(','), '5');
eq('剔除后计数同步', sel.label(), '已选 1 个');
sel.drop(5);
eq('条目全部失效后隐藏选择栏', sel.bar(), 'none');
eq('每次多选变化都会重绘树', sel.renders() > 0, true);

// 行为：批量删除（确认 / 落库 / 回滚 / 关闭当前查看）
// 注：extractFunction 从 `function` 起截取，会丢掉前面的 `async`，这里补回来
const extractAsync = name => 'async ' + extractFunction(html, name);
function makeSqlDeleteHarness(files, opts = {}) {
  const factory = new Function('files', 'curId', 'answer', 'persistOk', `
    const SQL_EXT_RE = ${html.match(/const SQL_EXT_RE = (\/.*?\/i);/)[1]};
    let sqlFiles = files;
    let currentSqlId = curId;
    let selectedSqlIds = new Set([1, 2]);
    let lastSelSqlId = 2;
    const sqlPre = { textContent: 'select 1' };
    let emptied = 0, renders = 0, lastMsg = '';
    const alerts = [];
    function showSqlEmpty() { emptied++; }
    function renderSqlTree() { renders++; }
    function errText(e) { return String((e && e.message) || e); }
    function confirm(msg) { lastMsg = msg; return answer; }
    function alert(msg) { alerts.push(msg); }
    async function persistData() { if (!persistOk) throw new Error('QuotaExceededError'); }
    ${extractFunction(html, 'sqlTitleFromRel')}
    ${extractFunction(html, 'sqlEntryTitle')}
    ${extractFunction(html, 'sqlFileById')}
    ${extractAsync('deleteSqlFiles')}
    ${extractAsync('deleteSqlFile')}
    return {
      multi: deleteSqlFiles, single: deleteSqlFile,
      ids: () => sqlFiles.map(f => f.id),
      cur: () => currentSqlId,
      emptied: () => emptied, renders: () => renders,
      msg: () => lastMsg, alerts: () => alerts,
      picked: () => Array.from(selectedSqlIds).length,
    };
  `);
  return factory(
    files,
    opts.curId === undefined ? null : opts.curId,
    opts.answer !== false,
    opts.persistOk !== false,
  );
}
const sqlFilesFixture = [
  { id: 1, title: 'init', relPath: 'init.sql' },
  { id: 2, title: 'seed', relPath: 'seed.sql' },
  { id: 3, title: 'migrate', relPath: 'migrate.sql' },
];

let del = makeSqlDeleteHarness(sqlFilesFixture, { answer: false });
await del.multi([1, 2]);
eq('批量删除先确认：取消则一条都不删', del.ids().join(','), '1,2,3');
eq('批量删除的确认文案写明条数', del.msg().includes('2 个 SQL 文件'), true);
eq('取消时不动磁盘（也不落库、不重绘）', del.renders(), 0);

del = makeSqlDeleteHarness(sqlFilesFixture);
await del.multi([1, 2]);
eq('确认后批量删除选中条目', del.ids().join(','), '3');
eq('批量删除后清空多选', del.picked(), 0);

del = makeSqlDeleteHarness(sqlFilesFixture, { curId: 1 });
await del.multi([1, 2]);
eq('删除当前查看的条目时关闭查看区', del.cur(), null);
eq('删除当前查看的条目时回到空状态', del.emptied(), 1);

del = makeSqlDeleteHarness(sqlFilesFixture, { curId: 3 });
await del.multi([1, 2]);
eq('删除其它条目时不动当前查看', del.cur(), 3);

del = makeSqlDeleteHarness(sqlFilesFixture, { persistOk: false });
await del.multi([1, 2]);
eq('落库失败回滚内存（条目仍在）', del.ids().join(','), '1,2,3');
eq('落库失败提示失败原因', del.alerts().length === 1 && del.alerts()[0].includes('删除失败'), true);

del = makeSqlDeleteHarness(sqlFilesFixture);
await del.single(2);
eq('单个删除复用同一条批量链路', del.ids().join(','), '1,3');
eq('单个删除的确认文案带标题', del.msg().includes('seed'), true);

del = makeSqlDeleteHarness(sqlFilesFixture);
await del.multi([]);
eq('空选择不弹确认框', del.msg(), '');
eq('空选择不删任何条目', del.ids().join(','), '1,2,3');

// 静态：多选接线（树点击 / 选择栏 / 移动菜单 / 锁定清理）
contains('SQL 多选状态是 Set', html, 'let selectedSqlIds = new Set();');
contains('SQL 多选有 Shift 锚点', html, 'let lastSelSqlId = null;');
contains('SQL 侧栏有多选操作栏', html, 'id="sqlSelBar"');
contains('多选操作栏有计数', html, 'id="sqlSelCount"');
contains('多选操作栏有移动按钮', html, 'id="sqlSelMoveBtn"');
contains('多选操作栏有删除按钮', html, 'id="sqlSelDeleteBtn"');
contains('多选操作栏有取消按钮', html, 'id="sqlSelClearBtn"');
contains('多选操作栏复用 .sel-bar 样式', html, 'class="sel-bar" id="sqlSelBar"');
contains('Ctrl/⌘ 点击 = 切换多选（不打开查看）', html, 'toggleSqlSelection(id)');
contains('Shift 点击 = 连选', html, 'selectSqlRange(id)');
contains('普通点击先清空多选再打开', html, 'if (selectedSqlIds.size) clearSqlSelection();');
contains('树叶子点击时读 id', html, 'const id = Number(fileItem.dataset.sql);');
contains('选中叶子带 .multi-sel 标记', extractFunction(html, 'renderSqlLeaf'), "picked ? ' multi-sel' : ''");
contains('选中叶子图标变 ☑', extractFunction(html, 'renderSqlLeaf'), "picked ? '☑' : '📄'");
contains('搜索结果叶子也标多选', extractFunction(html, 'renderSqlSearchResults'), "' multi-sel'");
contains('重绘树时同步选择栏', extractFunction(html, 'renderSqlTree'), 'updateSqlSelBar();');
contains('搜索结果重绘也同步选择栏', extractFunction(html, 'renderSqlSearchResults'), 'updateSqlSelBar();');
contains('选择栏移动按钮打开批量模式', html, "openSqlMoveMenu(sqlSelMoveBtn, 'sql-multi', Array.from(selectedSqlIds))");
contains('选择栏删除按钮走批量删除', html, 'deleteSqlFiles(Array.from(selectedSqlIds))');
contains('选择栏取消按钮清空多选', html, 'sqlSelClearBtn.addEventListener');
contains('已选条目上的按钮作用于整个选择', html, "const multi = selectedSqlIds.has(id) && selectedSqlIds.size > 1;");
contains('已选条目上的删除走批量', html, 'deleteSqlFiles(multi ? Array.from(selectedSqlIds) : [id])');
contains('批量移动用 sql-multi 模式', extractFunction(html, 'openSqlMoveMenu'), "mode === 'sql-multi'");
contains('批量移动跨分组时不标 ✓', extractFunction(html, 'openSqlMoveMenu'), "'\\u0000mixed'");
contains('批量移动显示条数', extractFunction(html, 'openSqlMoveMenu'), "sel.length + ' 个 SQL 文件'");
contains('批量移动复用同一个目标列表', extractFunction(html, 'buildSqlMoveTargets'), "mode === 'sql-group'");
contains('批量移动落库改 groupId', extractFunction(html, 'moveSqlItemToGroup'), "if (mode === 'sql' || mode === 'sql-multi')");
contains('批量移动后清空多选', extractFunction(html, 'moveSqlItemToGroup'), 'clearSqlSelection()');
contains('批量移动落库失败会提示（不静默）', extractFunction(html, 'moveSqlItemToGroup'), "'❌ 移动失败：'");
contains('锁定清空 SQL 多选', extractFunction(html, 'lockApp'), 'selectedSqlIds.clear();');
contains('单个删除转发到批量删除', extractFunction(html, 'deleteSqlFile'), 'deleteSqlFiles([id])');
contains('批量删除只删应用内副本（文案声明磁盘不受影响）', extractFunction(html, 'deleteSqlFiles'), '磁盘上的文件不受影响');
check('批量删除落库失败回滚内存', /sqlFiles = backup;/.test(extractFunction(html, 'deleteSqlFiles')));
notContains('SQL 多选不含任何磁盘删除调用', extractFunction(html, 'deleteSqlFiles'), "tauriInvoke('");
