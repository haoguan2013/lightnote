// notes.html 结构自检（零依赖）：脚本语法、CSS 花括号配平、id 唯一性、只读桥关键接线
import { readFileSync } from 'node:fs';
import { section, check, failedCount } from './helpers.mjs';

const html = readFileSync(new URL('../../../notes.html', import.meta.url), 'utf8');

section('notes.html 结构自检');

// 1) <script> 语法（只解析不执行）
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check('存在 1 个内联 script 块', scriptBlocks.length === 1, `实际 ${scriptBlocks.length}`);
try {
  new Function(scriptBlocks[0]);
  check('script 语法检查通过（new Function 解析）', true);
} catch (e) {
  check('script 语法检查通过（new Function 解析）', false, e.message);
}

// 2) CSS 花括号配平
const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
check('CSS 花括号配平', open === close, `${open}/${close}`);

// 3) id 唯一性
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
check('HTML id 无重复', dupes.length === 0, dupes.join(', '));
check('id 数量合理（> 70）', ids.length > 70, `实际 ${ids.length}`);

// 4) 只读桥 / 目录监听接线完整性
check('设置页含 bridgeToggle/bridgeStatus/bridgeErr',
  ['bridgeToggle', 'bridgeStatus', 'bridgeErr'].every((id) => ids.includes(id)));
check('设置页含目录监听相关元素',
  ['watchAddBtn', 'watchAddPanel', 'watchPathInput', 'watchBrowseBtn', 'watchCheckBtn',
   'watchGroupBtn', 'watchConfirmBtn', 'watchCancelBtn', 'watchList', 'watchStatus', 'watchErr']
    .every((id) => ids.includes(id)));
check('含导出相关元素（阅读模式按钮 + 批量导出面板 + 打印容器）',
  ['exportNoteBtn', 'exportMenu', 'exportOpenBtn', 'exportPanel', 'exportList', 'exportAllBtn',
   'exportNoneBtn', 'exportDirInput', 'exportBrowseBtn', 'exportOverwriteChk', 'exportRunBtn',
   'exportCloseBtn', 'exportStatus', 'exportErr', 'printRoot']
    .every((id) => ids.includes(id)));
check('tauriInvoke 封装存在', html.includes('function tauriInvoke('));
check('快照函数存在', html.includes('function buildBridgeSnapshot('));
check('未引入任何写入类接口调用',
  !/invoke\('(?:bridge|watch)_(?:write|delete|create|remove|rename|move|put)/.test(html));

if (failedCount()) process.exitCode = 1;

