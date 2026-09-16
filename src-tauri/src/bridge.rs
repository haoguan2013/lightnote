//! 本地只读桥（Local read-only bridge）
//!
//! 把「轻记」中**已解锁**的笔记以只读方式暴露给本机工具（如 DeepSeek Harness）。
//!
//! 设计约束（与项目加密模型保持一致）：
//! - 只绑定 `127.0.0.1`，端口由系统随机分配，不监听外网；
//! - 每次启动（= 每次解锁）生成新令牌，所有请求必须携带 `Authorization: Bearer <token>`；
//! - **只有 GET**，只读；没有任何写入端点；
//! - 数据来自前端推送的快照（JS 侧已剔除回收站与 JSON 历史），Rust 侧不接触密钥、不解密任何数据；
//! - 生命周期绑定解锁状态：解锁且开关打开才监听，锁定立即停止监听并删除发现文件。
//!
//! 发现文件（供本机工具定位端口与令牌）：`<app_local_data_dir>/bridge.json`
//! `{ "app": "light-notes", "port": <u16>, "token": "<64 hex>", "pid": <u32>, "since": <ms>, "readOnly": true }`

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 发现文件名（位于应用本地数据目录，与本项目其它数据同级）
pub const DISCOVERY_FILE: &str = "bridge.json";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const DEFAULT_SEARCH_LIMIT: usize = 20;
const MAX_SEARCH_LIMIT: usize = 100;
const SNIPPET_PAD: usize = 60;
const MAX_GROUP_DEPTH: usize = 32;

// ---------- 状态 ----------

/// 桥的全局状态（由 Tauri 托管）：None = 未运行
#[derive(Default)]
pub struct Bridge {
    inner: Mutex<Option<Running>>,
}

struct Running {
    port: u16,
    token: String,
    snapshot: Arc<Mutex<Value>>,
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
    discovery: PathBuf,
    since: u64,
}

impl Running {
    /// 停止监听并回收线程；调用方负责删除发现文件
    fn stop(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

// ---------- 工具 ----------

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 生成 64 位十六进制（256 bit）访问令牌。
/// 不引入 `rand` 依赖：用标准库 `RandomState`（OS 随机种子）+ 时间 + 栈地址混合后哈希。
fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let stack_probe = 0u8;
    let addr = &stack_probe as *const u8 as usize;
    let mut out = String::with_capacity(64);
    for round in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(round);
        h.write_u64(now_ms());
        h.write_usize(addr);
        h.write_u64(std::process::id() as u64);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 单行化 + 截断，用于列表预览与搜索片段
fn flatten(text: &str, max_chars: usize) -> String {
    let one_line: String = text
        .chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .collect();
    let trimmed = one_line.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut s: String = trimmed.chars().take(max_chars).collect();
    s.push('…');
    s
}

// ---------- HTTP 请求 / 响应 ----------

#[derive(Debug, Clone)]
struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct HttpResponse {
    status: u16,
    body: String,
}

impl HttpResponse {
    fn json(status: u16, value: Value) -> Self {
        Self { status, body: value.to_string() }
    }
    fn error(status: u16, msg: &str) -> Self {
        Self::json(status, json!({ "ok": false, "error": msg }))
    }
    fn status_text(&self) -> &'static str {
        match self.status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            405 => "Method Not Allowed",
            _ => "Internal Server Error",
        }
    }
}

struct Meta {
    pid: u32,
    since: u64,
    port: u16,
}

fn split_target(target: &str) -> (String, HashMap<String, String>) {
    match target.split_once('?') {
        None => (target.to_string(), HashMap::new()),
        Some((path, qs)) => {
            let mut query = HashMap::new();
            for pair in qs.split('&') {
                if pair.is_empty() {
                    continue;
                }
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                query.insert(percent_decode(k), percent_decode(v));
            }
            (path.to_string(), query)
        }
    }
}

fn parse_request(raw: &str) -> Result<HttpRequest, String> {
    let head = raw.split("\r\n\r\n").next().unwrap_or("");
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or("").trim().to_string();
    let target = parts.next().unwrap_or("").trim().to_string();
    if method.is_empty() || target.is_empty() {
        return Err("请求行无法解析".to_string());
    }
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let (path, query) = split_target(&target);
    Ok(HttpRequest { method, path, query, headers })
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).map_err(|e| format!("读取请求失败: {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > MAX_REQUEST_BYTES {
            return Err("请求头过大".to_string());
        }
    }
    let text = String::from_utf8_lossy(&buf).to_string();
    parse_request(&text)
}

fn write_response(stream: &mut TcpStream, res: &HttpResponse) {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        res.status,
        res.status_text(),
        res.body.as_bytes().len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(res.body.as_bytes());
    let _ = stream.flush();
}

// ---------- 路由 ----------

/// 分组 id → 完整路径（"父 / 子"），带环保护
fn group_paths(groups: &[Value]) -> HashMap<String, String> {
    let mut by_id: HashMap<String, (String, Option<String>)> = HashMap::new();
    for g in groups {
        if let Some(id) = g.get("id").and_then(|v| v.as_str()) {
            let name = g.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let parent = g
                .get("parentId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            by_id.insert(id.to_string(), (name, parent));
        }
    }
    let ids: Vec<String> = by_id.keys().cloned().collect();
    let mut out: HashMap<String, String> = HashMap::new();
    for id in ids {
        let mut names: Vec<String> = Vec::new();
        let mut cursor = Some(id.clone());
        let mut depth = 0;
        while let Some(cid) = cursor {
            if depth >= MAX_GROUP_DEPTH {
                break;
            }
            match by_id.get(&cid) {
                None => break,
                Some((name, parent)) => {
                    names.push(name.clone());
                    cursor = parent.clone();
                }
            }
            depth += 1;
        }
        names.reverse();
        out.insert(id, names.join(" / "));
    }
    out
}

fn note_matches(note: &Value, needle: &str) -> bool {
    let title = note.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
    title.to_lowercase().contains(needle) || content.to_lowercase().contains(needle)
}

/// 命中处前后各取一段（按字符边界安全切分）
fn snippet_of(note: &Value, needle: &str) -> String {
    let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let lower = content.to_lowercase();
    match lower.find(needle) {
        None => flatten(content, SNIPPET_PAD * 2),
        Some(byte_pos) => {
            let before = content[..byte_pos].chars().count();
            let hit_len = needle.chars().count();
            let chars: Vec<char> = content.chars().collect();
            let start = before.saturating_sub(SNIPPET_PAD);
            let end = (before + hit_len + SNIPPET_PAD).min(chars.len());
            let mut s = String::new();
            if start > 0 {
                s.push('…');
            }
            s.extend(chars[start..end].iter());
            if end < chars.len() {
                s.push('…');
            }
            flatten(&s, SNIPPET_PAD * 2 + 4)
        }
    }
}

fn clamp_limit(req: &HttpRequest) -> usize {
    req.query
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT)
}

fn route(req: &HttpRequest, token: &str, snapshot: &Value, meta: &Meta) -> HttpResponse {
    // 1) 鉴权：所有端点一律需要令牌
    let expected = format!("Bearer {token}");
    match req.headers.get("authorization") {
        Some(v) if v == &expected => {}
        _ => return HttpResponse::error(401, "缺少或错误的访问令牌"),
    }
    // 2) 只读：仅支持 GET
    if req.method != "GET" {
        return HttpResponse::error(405, "本接口为只读，仅支持 GET");
    }

    let empty: Vec<Value> = Vec::new();
    let notes = snapshot.get("notes").and_then(|v| v.as_array()).unwrap_or(&empty);
    let groups = snapshot.get("groups").and_then(|v| v.as_array()).unwrap_or(&empty);
    let paths = group_paths(groups);

    let group_path_of = |note: &Value| -> Value {
        match note.get("groupId").and_then(|v| v.as_str()) {
            Some(gid) => match paths.get(gid) {
                Some(p) => Value::String(p.clone()),
                None => Value::String("（已删除的分组）".to_string()),
            },
            None => Value::String("未分组".to_string()),
        }
    };

    match req.path.as_str() {
        "/health" => HttpResponse::json(
            200,
            json!({
                "ok": true,
                "app": "light-notes",
                "readOnly": true,
                "port": meta.port,
                "pid": meta.pid,
                "since": meta.since,
                "generatedAt": snapshot.get("generatedAt").cloned().unwrap_or(Value::Null),
                "noteCount": notes.len(),
                "groupCount": groups.len(),
            }),
        ),
        "/notes" => {
            let list: Vec<Value> = notes
                .iter()
                .map(|n| {
                    let content = n.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    json!({
                        "id": n.get("id").cloned().unwrap_or(Value::Null),
                        "title": n.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "groupId": n.get("groupId").cloned().unwrap_or(Value::Null),
                        "groupPath": group_path_of(n),
                        "timestamp": n.get("timestamp").cloned().unwrap_or(Value::Null),
                        "bytes": content.as_bytes().len(),
                        "preview": flatten(content, 120),
                    })
                })
                .collect();
            HttpResponse::json(200, json!({ "ok": true, "count": list.len(), "notes": list }))
        }
        "/groups" => {
            let counts: HashMap<String, usize> = {
                let mut m: HashMap<String, usize> = HashMap::new();
                for n in notes {
                    if let Some(gid) = n.get("groupId").and_then(|v| v.as_str()) {
                        *m.entry(gid.to_string()).or_insert(0) += 1;
                    }
                }
                m
            };
            let mut sorted: Vec<&Value> = groups.iter().collect();
            sorted.sort_by_key(|g| {
                (
                    paths.get(g.get("id").and_then(|v| v.as_str()).unwrap_or("")).cloned().unwrap_or_default(),
                    g.get("order").and_then(|v| v.as_i64()).unwrap_or(0),
                )
            });
            let list: Vec<Value> = sorted
                .iter()
                .map(|g| {
                    let id = g.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    json!({
                        "id": id,
                        "name": g.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        "parentId": g.get("parentId").cloned().unwrap_or(Value::Null),
                        "path": paths.get(id).cloned().unwrap_or_default(),
                        "noteCount": counts.get(id).copied().unwrap_or(0),
                    })
                })
                .collect();
            HttpResponse::json(200, json!({ "ok": true, "groups": list }))
        }
        "/search" => {
            let q = req.query.get("q").cloned().unwrap_or_default();
            if q.trim().is_empty() {
                return HttpResponse::error(400, "缺少查询参数 q");
            }
            let needle = q.to_lowercase();
            let limit = clamp_limit(req);
            let mut hits: Vec<&Value> = notes.iter().filter(|n| note_matches(n, &needle)).collect();
            hits.sort_by_key(|n| {
                std::cmp::Reverse(n.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0))
            });
            let matched = hits.len();
            let results: Vec<Value> = hits
                .into_iter()
                .take(limit)
                .map(|n| {
                    json!({
                        "id": n.get("id").cloned().unwrap_or(Value::Null),
                        "title": n.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "groupPath": group_path_of(n),
                        "timestamp": n.get("timestamp").cloned().unwrap_or(Value::Null),
                        "snippet": snippet_of(n, &needle),
                    })
                })
                .collect();
            HttpResponse::json(
                200,
                json!({ "ok": true, "q": q, "matched": matched, "returned": results.len(), "results": results }),
            )
        }
        path if path.starts_with("/notes/") => {
            let raw_id = &path["/notes/".len()..];
            let id: i64 = match raw_id.parse::<i64>() {
                Ok(v) => v,
                Err(_) => return HttpResponse::error(400, "笔记 id 必须是数字"),
            };
            match notes
                .iter()
                .find(|n| n.get("id").and_then(|v| v.as_i64()) == Some(id))
            {
                None => HttpResponse::error(404, "未找到该笔记"),
                Some(n) => {
                    let content = n.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    HttpResponse::json(
                        200,
                        json!({
                            "ok": true,
                            "note": {
                                "id": n.get("id").cloned().unwrap_or(Value::Null),
                                "title": n.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                "content": content,
                                "groupId": n.get("groupId").cloned().unwrap_or(Value::Null),
                                "groupPath": group_path_of(n),
                                "timestamp": n.get("timestamp").cloned().unwrap_or(Value::Null),
                                "bytes": content.as_bytes().len(),
                            }
                        }),
                    )
                }
            }
        }
        _ => HttpResponse::error(404, "未知端点（可用：/health /notes /notes/{id} /search?q= /groups）"),
    }
}

// ---------- 服务线程 ----------

fn handle_connection(mut stream: TcpStream, snapshot: &Arc<Mutex<Value>>, token: &str, meta: &Meta) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let res = match read_request(&mut stream) {
        Ok(req) => {
            let snap = snapshot.lock().map(|g| g.clone()).unwrap_or_else(|_| json!({}));
            route(&req, token, &snap, meta)
        }
        Err(msg) => HttpResponse::error(400, &msg),
    };
    write_response(&mut stream, &res);
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

/// 启动只读服务：绑定 127.0.0.1 的随机端口，返回可停止的句柄。
/// 与 Tauri 解耦（便于端到端测试）。
fn start_server(
    snapshot: Arc<Mutex<Value>>,
    token: String,
    discovery: PathBuf,
    pid: u32,
) -> Result<Running, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("无法绑定本地端口: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法读取本地端口: {e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞失败: {e}"))?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let snap_for_thread = snapshot.clone();
    let sd = shutdown.clone();
    let token_for_thread = token.clone();
    let since = now_ms();
    let handle = thread::spawn(move || {
        let meta = Meta { pid, since, port };
        while !sd.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _addr)) => handle_connection(stream, &snap_for_thread, &token_for_thread, &meta),
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(60));
                }
                Err(_) => thread::sleep(Duration::from_millis(150)),
            }
        }
    });

    Ok(Running {
        port,
        token,
        snapshot,
        shutdown,
        handle: Some(handle),
        discovery,
        since,
    })
}

fn write_discovery(running: &Running) -> Result<(), String> {
    if let Some(dir) = running.discovery.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    }
    let info = json!({
        "app": "light-notes",
        "readOnly": true,
        "port": running.port,
        "token": running.token,
        "pid": std::process::id(),
        "since": running.since,
        "endpoints": ["/health", "/notes", "/notes/{id}", "/search?q=", "/groups"],
    });
    std::fs::write(&running.discovery, info.to_string())
        .map_err(|e| format!("无法写入发现文件: {e}"))
}

fn remove_discovery(path: &PathBuf) {
    let _ = std::fs::remove_file(path);
}

// ---------- Tauri 命令 ----------

fn discovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_local_data_dir()
        .map(|d| d.join(DISCOVERY_FILE))
        .map_err(|e| format!("无法定位应用数据目录: {e}"))
}

fn lock_inner(state: &Bridge) -> Result<std::sync::MutexGuard<'_, Option<Running>>, String> {
    state.inner.lock().map_err(|_| "桥状态已损坏".to_string())
}

/// 启动桥（解锁后调用）：payload 为前端提供的只读快照 JSON 字符串。
/// 已在运行时：更新快照并返回当前端口（幂等）。
///
/// **为什么是 `async fn`**：Tauri 的同步命令会**内联跑在 IPC 回调线程（UI 主线程）**上
/// （见 `tauri-macros` 的 `body_blocking`：`let result = $path(...)`），而本命令要解析
/// 可能上兆字节的快照、绑定端口、写发现文件。改成 async 后由 async 运行时的工作线程执行，
/// UI 不再被这类 I/O 阻塞（见 CLAUDE.md 开发注意事项 16）。
#[tauri::command]
pub async fn bridge_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, Bridge>,
    payload: String,
) -> Result<Value, String> {
    let snapshot_value: Value =
        serde_json::from_str(&payload).map_err(|e| format!("快照不是合法 JSON: {e}"))?;
    if !snapshot_value.get("notes").map(|v| v.is_array()).unwrap_or(false) {
        return Err("快照缺少 notes 数组".to_string());
    }
    let mut guard = lock_inner(&state)?;
    if let Some(existing) = guard.as_ref() {
        if let Ok(mut snap) = existing.snapshot.lock() {
            *snap = snapshot_value;
        }
        return Ok(json!({ "running": true, "port": existing.port, "reused": true }));
    }
    let snapshot = Arc::new(Mutex::new(snapshot_value));
    let token = random_token();
    let discovery = discovery_path(&app)?;
    remove_discovery(&discovery); // 清理上次异常退出可能残留的旧发现文件
    let running = start_server(snapshot, token, discovery, std::process::id())?;
    write_discovery(&running)?;
    let port = running.port;
    let since = running.since;
    *guard = Some(running);
    Ok(json!({ "running": true, "port": port, "since": since, "reused": false }))
}

/// 更新快照（保存笔记后调用）。未运行时静默忽略。
/// async：每次保存都要解析约 1MB 快照，绝不能占着 UI 主线程做（见开发注意事项 16）。
#[tauri::command]
pub async fn bridge_sync(state: tauri::State<'_, Bridge>, payload: String) -> Result<(), String> {
    let snapshot_value: Value =
        serde_json::from_str(&payload).map_err(|e| format!("快照不是合法 JSON: {e}"))?;
    let guard = lock_inner(&state)?;
    if let Some(running) = guard.as_ref() {
        if let Ok(mut snap) = running.snapshot.lock() {
            *snap = snapshot_value;
        }
    }
    Ok(())
}

/// 停止桥（与 Tauri 解耦，供命令与应用退出钩子共用）
pub fn stop(state: &Bridge) -> Result<(), String> {
    let taken = {
        let mut guard = lock_inner(state)?;
        guard.take()
    };
    if let Some(running) = taken {
        let discovery = running.discovery.clone();
        running.stop();
        remove_discovery(&discovery);
    }
    Ok(())
}

/// 停止桥（锁定应用时调用）：停止监听并删除发现文件。
/// async：`stop()` 会 join 监听线程，不能让 UI 主线程等它（见开发注意事项 16）。
#[tauri::command]
pub async fn bridge_stop(state: tauri::State<'_, Bridge>) -> Result<(), String> {
    stop(&state)
}

/// 查询桥状态（设置页显示用）
#[tauri::command]
pub async fn bridge_status(state: tauri::State<'_, Bridge>) -> Result<Value, String> {
    let guard = lock_inner(&state)?;
    Ok(match guard.as_ref() {
        None => json!({ "running": false, "port": Value::Null }),
        Some(r) => json!({ "running": true, "port": r.port, "since": r.since }),
    })
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "test-token-0123456789";

    fn snapshot() -> Value {
        // 正文刻意做得比列表 preview（120 字）长，用来验证列表不泄露完整正文
        let long_content = format!(
            "第一阶段：调研\n第二阶段：实现\nMARKER-abc\n{}\n机密尾巴XYZ-仅详情可见",
            "填充内容".repeat(60)
        );
        json!({
            "app": "light-notes",
            "generatedAt": 1_700_000_000_000u64,
            "notes": [
                { "id": 2, "title": "项目 A 计划", "content": long_content, "timestamp": 200, "groupId": "g_a" },
                { "id": 1, "title": "随手记", "content": "买牛奶", "timestamp": 100, "groupId": null },
                { "id": 3, "title": "子组笔记", "content": "嵌套分组的笔记", "timestamp": 300, "groupId": "g_b" }
            ],
            "groups": [
                { "id": "g_a", "name": "工作", "parentId": null, "order": 0 },
                { "id": "g_b", "name": "子项目", "parentId": "g_a", "order": 1 }
            ]
        })
    }

    fn meta() -> Meta {
        Meta { pid: 4242, since: 1_700_000_000_000, port: 45123 }
    }

    fn req(method: &str, target: &str, auth: Option<&str>) -> HttpRequest {
        let (path, query) = split_target(target);
        let mut headers = HashMap::new();
        if let Some(a) = auth {
            headers.insert("authorization".to_string(), a.to_string());
        }
        HttpRequest { method: method.to_string(), path, query, headers }
    }

    fn body_of(res: &HttpResponse) -> Value {
        serde_json::from_str(&res.body).expect("响应体应为合法 JSON")
    }

    #[test]
    fn percent_decode_handles_chinese_and_plus() {
        assert_eq!(percent_decode("%E5%B7%A5%E4%BD%9C"), "工作");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn split_target_parses_query() {
        let (path, q) = split_target("/search?q=%E5%B7%A5%E4%BD%9C&limit=5");
        assert_eq!(path, "/search");
        assert_eq!(q.get("q").map(String::as_str), Some("工作"));
        assert_eq!(q.get("limit").map(String::as_str), Some("5"));
    }

    #[test]
    fn parse_request_rejects_garbage() {
        assert!(parse_request("").is_err());
        assert!(parse_request("GARBAGE").is_err());
        let r = parse_request("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer x\r\n\r\n").unwrap();
        assert_eq!(r.method, "GET");
        assert_eq!(r.path, "/health");
        assert_eq!(r.headers.get("authorization").map(String::as_str), Some("Bearer x"));
    }

    #[test]
    fn auth_is_required_everywhere() {
        let snap = snapshot();
        for target in ["/health", "/notes", "/notes/2", "/search?q=a", "/groups"] {
            let res = route(&req("GET", target, None), TOKEN, &snap, &meta());
            assert_eq!(res.status, 401, "{target} 无令牌应 401");
            let res = route(&req("GET", target, Some("Bearer wrong")), TOKEN, &snap, &meta());
            assert_eq!(res.status, 401, "{target} 错误令牌应 401");
        }
    }

    #[test]
    fn writes_are_rejected() {
        let snap = snapshot();
        let auth = format!("Bearer {TOKEN}");
        for m in ["POST", "PUT", "DELETE", "PATCH"] {
            let res = route(&req(m, "/notes", Some(&auth)), TOKEN, &snap, &meta());
            assert_eq!(res.status, 405, "{m} 应 405");
        }
    }

    #[test]
    fn health_reports_counts_and_never_leaks_content() {
        let res = route(&req("GET", "/health", Some(&format!("Bearer {TOKEN}"))), TOKEN, &snapshot(), &meta());
        assert_eq!(res.status, 200);
        let v = body_of(&res);
        assert_eq!(v["ok"], true);
        assert_eq!(v["readOnly"], true);
        assert_eq!(v["noteCount"], 3);
        assert_eq!(v["groupCount"], 2);
        assert_eq!(v["pid"], 4242);
        assert_eq!(v["port"], 45123);
        assert!(!res.body.contains("买牛奶"), "健康检查不得包含笔记内容");
    }

    #[test]
    fn notes_list_has_no_full_content_and_has_group_path() {
        let res = route(&req("GET", "/notes", Some(&format!("Bearer {TOKEN}"))), TOKEN, &snapshot(), &meta());
        let v = body_of(&res);
        assert_eq!(v["count"], 3);
        // 列表只给预览（前 120 字），正文尾部不得出现
        assert!(!res.body.contains("机密尾巴XYZ"), "列表不得包含完整正文");
        let notes = v["notes"].as_array().unwrap();
        let first = notes.iter().find(|n| n["id"] == 2).unwrap();
        assert!(first["preview"].as_str().unwrap().contains("第一阶段"));
        assert_eq!(
            first["bytes"].as_u64().unwrap() as usize,
            snapshot()["notes"][0]["content"].as_str().unwrap().len()
        );
        let nested = notes.iter().find(|n| n["id"] == 3).unwrap();
        assert_eq!(nested["groupPath"], "工作 / 子项目");
        let ungrouped = notes.iter().find(|n| n["id"] == 1).unwrap();
        assert_eq!(ungrouped["groupPath"], "未分组");
    }

    #[test]
    fn note_detail_returns_content_and_validates_id() {
        let auth = format!("Bearer {TOKEN}");
        let res = route(&req("GET", "/notes/2", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(res.status, 200);
        let v = body_of(&res);
        assert_eq!(v["note"]["title"], "项目 A 计划");
        assert!(v["note"]["content"].as_str().unwrap().contains("第二阶段"));

        let missing = route(&req("GET", "/notes/999", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(missing.status, 404);

        let bad = route(&req("GET", "/notes/abc", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(bad.status, 400);
    }

    #[test]
    fn search_matches_title_and_content_case_insensitively() {
        let auth = format!("Bearer {TOKEN}");
        // 命中标题：「项目 A 计划」（snippet 取正文开头，因为标题命中时正文里没有该词）
        let by_title = route(&req("GET", "/search?q=%E9%A1%B9%E7%9B%AE&limit=99", Some(&auth)), TOKEN, &snapshot(), &meta());
        let v = body_of(&by_title);
        assert_eq!(v["q"], "项目");
        assert_eq!(v["matched"], 1);
        assert_eq!(v["results"][0]["id"], 2);
        assert_eq!(v["results"][0]["groupPath"], "工作");
        // 命中正文：snippet 必须定位到命中处并带上下文
        let by_content = route(&req("GET", "/search?q=%E8%B0%83%E7%A0%94", Some(&auth)), TOKEN, &snapshot(), &meta());
        let vl = body_of(&by_content);
        assert_eq!(vl["matched"], 1);
        let snippet = vl["results"][0]["snippet"].as_str().unwrap();
        assert!(snippet.contains("调研"), "snippet 应包含命中词: {snippet}");
        assert!(snippet.contains("第二阶段"), "snippet 应带上下文: {snippet}");
        // 大小写不敏感（MARKER-abc）
        let upper = route(&req("GET", "/search?q=marker-ABC", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(body_of(&upper)["matched"], 1);
        // 未命中
        let miss = route(&req("GET", "/search?q=zzzz", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(body_of(&miss)["matched"], 0);
        // limit 上限 100、下限 1
        assert_eq!(clamp_limit(&req("GET", "/search?q=a&limit=99999", Some(&auth))), MAX_SEARCH_LIMIT);
        assert_eq!(clamp_limit(&req("GET", "/search?q=a&limit=0", Some(&auth))), 1);
        // 空查询 / 缺参数 → 400
        let empty = route(&req("GET", "/search?q=", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(empty.status, 400);
        let missing_q = route(&req("GET", "/search", Some(&auth)), TOKEN, &snapshot(), &meta());
        assert_eq!(missing_q.status, 400);
    }

    #[test]
    fn groups_report_paths_and_counts() {
        let res = route(&req("GET", "/groups", Some(&format!("Bearer {TOKEN}"))), TOKEN, &snapshot(), &meta());
        let v = body_of(&res);
        let groups = v["groups"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        let child = groups.iter().find(|g| g["id"] == "g_b").unwrap();
        assert_eq!(child["path"], "工作 / 子项目");
        assert_eq!(child["noteCount"], 1);
    }

    #[test]
    fn unknown_endpoint_is_404() {
        let res = route(&req("GET", "/../etc/passwd", Some(&format!("Bearer {TOKEN}"))), TOKEN, &snapshot(), &meta());
        assert_eq!(res.status, 404);
    }

    #[test]
    fn group_path_survives_cycles() {
        let cyclic = json!([
            { "id": "a", "name": "A", "parentId": "b" },
            { "id": "b", "name": "B", "parentId": "a" }
        ]);
        let paths = group_paths(cyclic.as_array().unwrap());
        assert!(paths.contains_key("a") && paths.contains_key("b"));
    }

    #[test]
    fn token_is_hex_and_unique() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// 真实 TCP 端到端：起服务 → 用裸 socket 发 HTTP → 校验响应与鉴权 → 停止后端口不可连、发现文件被删
    #[test]
    fn serves_over_tcp_and_stops_cleanly() {
        let dir = std::env::temp_dir().join(format!("ln-bridge-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let discovery = dir.join("bridge.json");
        let _ = std::fs::remove_file(&discovery);

        let snap = Arc::new(Mutex::new(snapshot()));
        let running = start_server(snap.clone(), TOKEN.to_string(), discovery.clone(), 777).unwrap();
        write_discovery(&running).unwrap();
        let port = running.port;
        assert!(port > 0);

        let info: Value = serde_json::from_str(&std::fs::read_to_string(&discovery).unwrap()).unwrap();
        assert_eq!(info["port"], port);
        assert_eq!(info["token"], TOKEN);
        assert_eq!(info["readOnly"], true);

        // 无令牌 → 401
        let (status, body) = http_get(port, "/health", None);
        assert_eq!(status, 401);
        assert!(body.contains("令牌"));

        // 有令牌 → 200
        let (status, body) = http_get(port, "/health", Some(TOKEN));
        assert_eq!(status, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["noteCount"], 3);
        assert_eq!(v["pid"], 777);

        // 读单篇（含正文）
        let (status, body) = http_get(port, "/notes/2", Some(TOKEN));
        assert_eq!(status, 200);
        assert!(body.contains("第二阶段"));

        // 未命中 → 404
        let (status, _) = http_get(port, "/notes/999", Some(TOKEN));
        assert_eq!(status, 404);

        // 列表只给预览（不泄露完整正文）
        let (status, body) = http_get(port, "/notes", Some(TOKEN));
        assert_eq!(status, 200);
        assert!(body.contains("项目 A 计划"));
        assert!(!body.contains("机密尾巴XYZ"), "列表响应不得包含完整正文");

        // 中文搜索（真实 percent-encoded 请求行：q=调研）
        let (status, body) = http_get(port, "/search?q=%E8%B0%83%E7%A0%94", Some(TOKEN));
        assert_eq!(status, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["matched"], 1);
        assert_eq!(v["results"][0]["id"], 2);
        assert!(v["results"][0]["snippet"].as_str().unwrap().contains("调研"));

        // 快照同步生效
        *snap.lock().unwrap() = json!({ "notes": [], "groups": [], "generatedAt": 1 });
        let (status, body) = http_get(port, "/health", Some(TOKEN));
        assert_eq!(status, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["noteCount"], 0);

        // 停止 → 端口不再可连、发现文件删除
        let discovery_for_check = discovery.clone();
        running.stop();
        remove_discovery(&discovery);
        assert!(!discovery_for_check.exists(), "停止后应删除发现文件");
        let mut probe = TcpStream::connect(("127.0.0.1", port));
        let refused = match probe.as_mut() {
            Err(_) => true,
            Ok(s) => {
                let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
                let mut buf = [0u8; 1];
                let _ = s.write_all(b"GET /health HTTP/1.1\r\n\r\n");
                matches!(s.read(&mut buf), Ok(0) | Err(_))
            }
        };
        assert!(refused, "停止后不应再响应请求");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn http_get(port: u16, target: &str, token: Option<&str>) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).expect("应能连接本地端口");
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut req = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
        if let Some(t) = token {
            req.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
        req.push_str("\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        let status: u16 = raw
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .expect("响应应含状态码");
        let body = raw.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }
}
