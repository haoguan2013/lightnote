// 测试辅助（零依赖）：断言计数 + 从源码中提取函数体
let passed = 0;
const failures = [];

export function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    process.stdout.write(`  ✗ ${name}${detail ? ' — ' + detail : ''}\n`);
  }
  return !!cond;
}

export function eq(name, actual, expected) {
  return check(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

export function contains(name, haystack, needle) {
  return check(name, String(haystack).includes(needle), `未找到 ${JSON.stringify(needle)}`);
}

export function notContains(name, haystack, needle) {
  return check(name, !String(haystack).includes(needle), `不应出现 ${JSON.stringify(needle)}`);
}

export function section(title) {
  process.stdout.write(`\n${title}\n`);
}

/** 统计结果并设置退出码；返回是否全部通过 */
export function failedCount() {
  return failures.length;
}

export function summary(label) {
  process.stdout.write(`\n${label}：${passed} 通过，${failures.length} 失败\n`);
  if (failures.length) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

/**
 * 从 IIFE 源码中提取具名函数源码（字符串/注释感知的括号配对）。
 * 用于把 notes.html 里的纯逻辑函数拿到 Node 中直接做行为断言。
 */
export function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到函数 ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const from = i;
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 的花括号不配对（起点 ${from}）`);
}
