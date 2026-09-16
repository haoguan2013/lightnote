// 轻记只读桥测试入口：node tools/light-notes-mcp/test/run.mjs
import { summary } from './helpers.mjs';

const sections = [];
try {
  const bridge = await import('./bridge.test.mjs');
  sections.push(bridge);
} catch (e) {
  process.stdout.write(`bridge.test.mjs 执行失败：${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 1;
}
try {
  const frontend = await import('./frontend.test.mjs');
  sections.push(frontend);
} catch (e) {
  process.stdout.write(`frontend.test.mjs 执行失败：${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 1;
}
try {
  const html = await import('./html-syntax.mjs');
  sections.push(html);
} catch (e) {
  process.stdout.write(`html-syntax.mjs 执行失败：${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 1;
}

summary(`轻记只读桥测试（${sections.length} 组）`);
