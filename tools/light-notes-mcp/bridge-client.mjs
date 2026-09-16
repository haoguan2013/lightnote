// 轻记（Light Notes）本地只读桥 —— 传输层客户端（零依赖）
//
// 工作方式：读「发现文件」拿到端口与本次解锁的访问令牌，再请求 127.0.0.1 上的只读接口。
// 发现文件由轻记在解锁且「设置 → 安全 → 本地工具读取」打开时写入：
//   %LOCALAPPDATA%\com.lightnotes.app\bridge.json
//   { "app":"light-notes", "readOnly":true, "port":<n>, "token":"<64 hex>", "pid":<n>, "since":<ms> }
//
// 可用环境变量覆盖发现文件路径（便于测试/多环境）：LIGHT_NOTES_BRIDGE
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_DISCOVERY = process.env.LIGHT_NOTES_BRIDGE
  || join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'com.lightnotes.app', 'bridge.json');

const UNAVAILABLE_HINT =
  '轻记当前没有对外提供数据。请确认：①「轻记」应用已启动；② 已输入 PIN 解锁；'
  + '③「设置 → 安全 → 本地工具读取」开关已打开（默认关闭，打开后需在解锁状态下生效）。';

export class BridgeUnavailableError extends Error {}

/** 读取发现文件；失败一律抛出带操作指引的 BridgeUnavailableError */
export function readDiscovery(path = DEFAULT_DISCOVERY) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new BridgeUnavailableError(`读不到发现文件（${path}）。${UNAVAILABLE_HINT}`);
  }
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    throw new BridgeUnavailableError(`发现文件不是合法 JSON（${path}），可能写入未完成。${UNAVAILABLE_HINT}`);
  }
  if (!info || !info.port || !info.token) {
    throw new BridgeUnavailableError(`发现文件缺少 port/token（${path}）。${UNAVAILABLE_HINT}`);
  }
  return info;
}

/** 把 fetch 的各种嵌套错误（AggregateError / cause）压成一段可读文本 */
function describeFetchError(e) {
  const parts = [];
  const walk = (x, depth) => {
    if (!x || depth > 3) return;
    if (x.code) parts.push(String(x.code));
    if (x.message) parts.push(String(x.message));
    if (Array.isArray(x.errors)) x.errors.forEach((y) => walk(y, depth + 1));
    if (x.cause) walk(x.cause, depth + 1);
  };
  walk(e, 0);
  return parts.join(' | ');
}

/** 调用只读接口；path 形如 "/notes/12" 或 "/search?q=xxx"（需自行 encodeURIComponent） */
export async function callBridge(path, { discovery = DEFAULT_DISCOVERY, timeoutMs = 15000 } = {}) {
  const info = readDiscovery(discovery);
  const url = `http://127.0.0.1:${info.port}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${info.token}` },
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new BridgeUnavailableError(`请求超时（${timeoutMs}ms）：${url}`);
    }
    const detail = describeFetchError(e);
    if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|UND_ERR_SOCKET/i.test(detail)) {
      throw new BridgeUnavailableError(
        `连接被拒绝（127.0.0.1:${info.port}）：轻记可能已锁定或已退出——锁定会立即停止监听并删除发现文件。${UNAVAILABLE_HINT}`,
      );
    }
    throw new BridgeUnavailableError(`请求本地只读接口失败：${detail || String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data && data.error ? data.error : `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new BridgeUnavailableError(
        `访问令牌不被接受（${detail}）：发现文件可能是上一次解锁留下的旧副本。`
        + '请确认轻记处于解锁状态后重试；若仍失败，重新打开开关或重启工具进程。',
      );
    }
    throw new BridgeUnavailableError(`轻记只读接口返回错误：${detail}`);
  }
  return data;
}

/** 本地时间 "YYYY-MM-DD HH:mm" */
export function fmtTime(ms) {
  if (!ms || typeof ms !== 'number') return '（无时间）';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
