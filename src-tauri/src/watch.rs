//! 目录监听（Directory watcher）
//!
//! 监听用户在设置页绑定的本地目录，**只识别新增与删除**的 Markdown 文件：
//! - 新增：目录里出现一个此前没有的 `.md/.markdown/.mdown/.mkd`（含子目录）
//! - 删除：此前登记过的文件现在不见了
//! - **内容被修改不算变化**（不产生事件）——与「只监听新增、删除」的需求一致
//!
//! 关键设计：
//! - **零新依赖**：`std::fs` 轮询（`read_dir` 递归 + 定时比较），不引入 `notify`；
//! - Rust 侧**不读笔记内容、不碰密钥**：只算路径差集，把事件交给前端，由前端解密态决定怎么落库；
//! - `known`（登记表）由前端持久化在加密 vault 里并在启动时回传，因此**应用重启/期间锁定也能量到
//!   期间的新增与删除**（补跑），而不是把已有文件重新导入一遍；
//! - `pending` 防止同一条变更在「已发出但前端还没落库」的窗口里被重复发出；
//! - 生命周期由前端绑定到解锁状态：解锁 → `watch_start`，锁定 → `watch_stop`。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 前端轮询默认间隔（同时也是 Rust 扫描间隔）
pub const DEFAULT_INTERVAL_MS: u64 = 2000;
const MIN_INTERVAL_MS: u64 = 300;
const MAX_INTERVAL_MS: u64 = 60_000;
/// 递归深度上限（防深层目录树拖慢扫描）
const MAX_DEPTH: usize = 8;
/// 单个绑定最多登记的文件数
const MAX_FILES: usize = 5000;
/// 单个文件读取上限（超过则跳过并在前端提示）
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// 待领取事件队列上限（超出计入 dropped）
const MAX_QUEUE: usize = 500;

// ---------- 数据结构 ----------

/// 一个「目录 ↔ 分组」绑定（前端只传 id / dir / kind；groupId 由前端持有）
///
/// `kind` 决定扫描哪些扩展名：`"md"`（默认，旧前端不带该字段）= Markdown 笔记目录，
/// `"sql"` = SQL 文件目录（与 Markdown 监听分开配置，各用各的分组）。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Binding {
    pub id: String,
    pub dir: String,
    #[serde(default = "kind_md")]
    pub kind: String,
}

fn kind_md() -> String {
    "md".to_string()
}

/// 变更事件：kind = "added" | "removed"
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub binding_id: String,
    pub rel_path: String,
    pub kind: String,
}

#[derive(Default)]
struct Shared {
    bindings: Vec<Binding>,
    /// bindingId → 已登记（= 已落库为笔记）的相对路径集合
    known: HashMap<String, HashSet<String>>,
    /// 已发出但前端尚未确认的事件（bindingId, relPath）
    pending: HashSet<(String, String)>,
    queue: Vec<Event>,
    dropped: usize,
    scanned_at: u64,
    scans: u64,
    interval_ms: u64,
}

struct Ctl {
    shutdown: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

/// 监听器（由 Tauri 托管）
#[derive(Default)]
pub struct Watcher {
    shared: Arc<Mutex<Shared>>,
    ctl: Mutex<Option<Ctl>>,
}

fn lock_shared(w: &Watcher) -> Result<MutexGuard<'_, Shared>, String> {
    w.shared.lock().map_err(|_| "监听状态已损坏".to_string())
}

fn lock_ctl(w: &Watcher) -> Result<MutexGuard<'_, Option<Ctl>>, String> {
    w.ctl.lock().map_err(|_| "监听线程状态已损坏".to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------- 纯逻辑：扫描与差集 ----------

fn is_markdown(name: &str) -> bool {
    match name.rsplit_once('.') {
        None => false,
        Some((_, ext)) => matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd"),
    }
}

/// SQL 文件（「🗄️ SQL」TAB 的目录监听用）
fn is_sql(name: &str) -> bool {
    match name.rsplit_once('.') {
        None => false,
        Some((_, ext)) => ext.eq_ignore_ascii_case("sql"),
    }
}

/// 按绑定类型判断某个文件名是否属于该监听范围
fn is_watched(name: &str, kind: &str) -> bool {
    match kind {
        "sql" => is_sql(name),
        _ => is_markdown(name),
    }
}

/// 相对路径统一用 `/` 分隔，作为稳定的 known 键（Windows 上也不受 `\` 影响）
fn rel_key(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 递归收集目录下符合 `kind` 的相对路径（跳过点目录/点文件，深度与数量有上限）
pub fn scan_files(root: &Path, kind: &str) -> Result<BTreeSet<String>, String> {
    if !root.exists() {
        return Err("目录不存在".to_string());
    }
    if !root.is_dir() {
        return Err("不是目录".to_string());
    }
    let mut out: BTreeSet<String> = BTreeSet::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // 无权限等：跳过该子树，不影响其它目录
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let path = entry.path();
            if ft.is_dir() {
                stack.push((path, depth + 1));
                continue;
            }
            if !ft.is_file() || !is_watched(&name, kind) {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(root) {
                out.insert(rel_key(rel));
            }
            if out.len() >= MAX_FILES {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

/// 计算一次扫描产生的事件（纯函数，便于单测）：
/// - 新增：文件存在、不在 known、不在 pending
/// - 删除：在 known、文件已不存在、不在 pending
/// 命中的路径会写入 pending，避免下一轮重复发出。
pub fn diff_events(
    binding_id: &str,
    present: &BTreeSet<String>,
    known: &HashSet<String>,
    pending: &mut HashSet<(String, String)>,
    out: &mut Vec<Event>,
) {
    for path in present {
        let key = (binding_id.to_string(), path.clone());
        if known.contains(path) || pending.contains(&key) {
            continue;
        }
        pending.insert(key);
        out.push(Event {
            binding_id: binding_id.to_string(),
            rel_path: path.clone(),
            kind: "added".to_string(),
        });
    }
    let mut known_sorted: Vec<&String> = known.iter().collect();
    known_sorted.sort();
    for path in known_sorted {
        if present.contains(path) {
            continue;
        }
        let key = (binding_id.to_string(), path.clone());
        if pending.contains(&key) {
            continue;
        }
        pending.insert(key);
        out.push(Event {
            binding_id: binding_id.to_string(),
            rel_path: path.clone(),
            kind: "removed".to_string(),
        });
    }
}

fn scan_once(s: &mut Shared) {
    s.scanned_at = now_ms();
    s.scans += 1;
    if s.bindings.is_empty() {
        return;
    }
    let bindings = s.bindings.clone();
    for b in bindings {
        let present = match scan_files(Path::new(&b.dir), &b.kind) {
            Ok(set) => set,
            Err(_) => continue, // 目录被删/不可读：本轮跳过（删除事件仍由 known 差集给出）
        };
        let known = s.known.entry(b.id.clone()).or_default().clone();
        let mut events: Vec<Event> = Vec::new();
        diff_events(&b.id, &present, &known, &mut s.pending, &mut events);
        for ev in events {
            if s.queue.len() >= MAX_QUEUE {
                s.dropped += 1;
                continue;
            }
            s.queue.push(ev);
        }
    }
}

// ---------- 路径安全与读取 ----------

/// 把相对路径解析到绑定目录内，拒绝绝对路径、`..`、以及符号链接跳出去
pub fn resolve_inside(dir: &str, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.trim().is_empty() {
        return Err("相对路径为空".to_string());
    }
    let p = Path::new(&rel);
    if p.is_absolute() {
        return Err("必须是相对路径".to_string());
    }
    for c in p.components() {
        match c {
            Component::Normal(_) => {}
            _ => return Err("相对路径包含非法片段".to_string()),
        }
    }
    let root = std::fs::canonicalize(dir).map_err(|e| format!("目录不可访问: {e}"))?;
    let full = std::fs::canonicalize(root.join(p)).map_err(|e| format!("文件不可访问: {e}"))?;
    if !full.starts_with(&root) {
        return Err("路径越界".to_string());
    }
    Ok(full)
}

/// 标准 base64（零依赖实现，供前端用 TextDecoder 解码 BOM/GBK）
pub fn b64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

// ---------- 与 Tauri 解耦的核心操作 ----------

/// 启动监听（先停旧的，保证基线一致）。known 由前端从 vault 回传。
pub fn start(
    w: &Watcher,
    bindings: Vec<Binding>,
    known: HashMap<String, HashSet<String>>,
    interval_ms: u64,
) -> Result<Value, String> {
    stop(w)?;
    let interval = if interval_ms == 0 {
        DEFAULT_INTERVAL_MS
    } else {
        interval_ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
    };
    {
        let mut s = lock_shared(w)?;
        s.bindings = bindings;
        s.known = known;
        s.pending.clear();
        s.queue.clear();
        s.dropped = 0;
        s.scans = 0;
        s.interval_ms = interval;
    }
    let shutdown = Arc::new(AtomicBool::new(false));
    let shared = w.shared.clone();
    let sd = shutdown.clone();
    let handle = thread::spawn(move || {
        while !sd.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(interval));
            if sd.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(mut s) = shared.lock() {
                scan_once(&mut s);
            }
        }
    });
    let info = {
        let s = lock_shared(w)?;
        json!({
            "ok": true,
            "running": true,
            "bindings": s.bindings.len(),
            "dirs": s.bindings.iter().map(|b| b.dir.clone()).collect::<Vec<_>>(),
            "intervalMs": s.interval_ms,
        })
    };
    {
        let mut ctl = lock_ctl(w)?;
        *ctl = Some(Ctl { shutdown, handle });
    }
    Ok(info)
}

/// 停止监听并清空队列与 pending（known 保留，前端下次启动会重新回传）
pub fn stop(w: &Watcher) -> Result<(), String> {
    let taken = {
        let mut ctl = lock_ctl(w)?;
        ctl.take()
    };
    if let Some(c) = taken {
        c.shutdown.store(true, Ordering::SeqCst);
        let _ = c.handle.join();
    }
    let mut s = lock_shared(w)?;
    s.bindings.clear();
    s.pending.clear();
    s.queue.clear();
    Ok(())
}

/// 取走待处理事件
pub fn poll(w: &Watcher) -> Result<Value, String> {
    let running = lock_ctl(w)?.is_some();
    let mut s = lock_shared(w)?;
    let events: Vec<Event> = s.queue.drain(..).collect();
    let dropped = s.dropped;
    s.dropped = 0;
    Ok(json!({
        "ok": true,
        "running": running,
        "events": events,
        "dropped": dropped,
        "scannedAt": s.scanned_at,
        "scans": s.scans,
        "bindings": s.bindings.len(),
    }))
}

/// 前端落库后回传登记表；已登记的路径从 pending 移除（这样它们之后真的被删除时仍能报出删除）
pub fn set_known(w: &Watcher, known: HashMap<String, HashSet<String>>) -> Result<Value, String> {
    let mut s = lock_shared(w)?;
    let all: HashSet<(String, String)> = known
        .iter()
        .flat_map(|(bid, set)| set.iter().map(move |p| (bid.clone(), p.clone())))
        .collect();
    s.pending.retain(|k| !all.contains(k));
    s.known = known;
    Ok(json!({ "ok": true, "bindings": s.known.len(), "pending": s.pending.len() }))
}

/// 读取绑定目录下的一个文件（只读，路径必须落在绑定目录内）
pub fn read_file(w: &Watcher, binding_id: &str, rel_path: &str) -> Result<Value, String> {
    let dir = {
        let s = lock_shared(w)?;
        s.bindings
            .iter()
            .find(|b| b.id == binding_id)
            .map(|b| b.dir.clone())
    }
    .ok_or_else(|| "未找到该目录绑定".to_string())?;
    let full = resolve_inside(&dir, rel_path)?;
    let meta = std::fs::metadata(&full).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大（{} 字节，上限 {} 字节）",
            meta.len(),
            MAX_FILE_BYTES
        ));
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("无法读取文件: {e}"))?;
    Ok(json!({ "ok": true, "size": bytes.len(), "base64": b64_encode(&bytes) }))
}

/// 只扫 Markdown 的便捷包装（Markdown 笔记目录）
pub fn scan_markdown(root: &Path) -> Result<BTreeSet<String>, String> {
    scan_files(root, "md")
}

/// 校验一个目录是否可以绑定（不修改任何状态）；`kind` 决定统计哪类文件
pub fn check_dir_kind(dir: &str, kind: &str) -> Value {
    if dir.trim().is_empty() {
        return json!({ "ok": false, "error": "目录路径为空" });
    }
    let p = Path::new(dir);
    if !p.exists() {
        return json!({ "ok": false, "error": "目录不存在" });
    }
    if !p.is_dir() {
        return json!({ "ok": false, "error": "该路径不是目录" });
    }
    match scan_files(p, kind) {
        Ok(set) => json!({
            "ok": true,
            "exists": true,
            "isDir": true,
            "kind": kind,
            "count": set.len(),
            "mdCount": set.len(),
            "truncated": set.len() >= MAX_FILES,
            "files": set.into_iter().collect::<Vec<_>>(),
        }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// 用系统「选择文件夹」对话框挑目录（零依赖：借 Windows PowerShell 的 FolderBrowserDialog）。
/// 结果经临时文件以 UTF-8 回传，避免中文路径在管道里走 OEM 代码页而乱码。
/// 只统计 Markdown 的包装（Markdown 笔记目录的「检查」按钮）
pub fn check_dir(dir: &str) -> Value {
    check_dir_kind(dir, "md")
}

/// 用系统「选择文件夹」对话框挑目录（零依赖：借 Windows PowerShell 的 FolderBrowserDialog）。
/// 结果经临时文件以 UTF-8 回传，避免中文路径在管道里走 OEM 代码页而乱码。
pub fn browse_dir() -> Result<String, String> {
    #[cfg(windows)]
    {
        let tmp = std::env::temp_dir().join(format!("ln-watch-dir-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms | Out-Null; \
$d = New-Object System.Windows.Forms.FolderBrowserDialog; \
$d.Description = '选择要监听的 Markdown 目录'; \
$d.ShowNewFolderButton = $true; \
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
  [System.IO.File]::WriteAllText('{}', $d.SelectedPath, (New-Object System.Text.UTF8Encoding($false))) }}",
            tmp.display()
        );
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-STA", "-NonInteractive", "-Command", &script]);
        crate::hide_console(&mut cmd);   // 否则选目录时会多出一个控制台窗口
        let out = cmd
            .output()
            .map_err(|e| format!("无法调用系统对话框: {e}"))?;
        let picked = std::fs::read_to_string(&tmp).unwrap_or_default().trim().to_string();
        let _ = std::fs::remove_file(&tmp);
        if picked.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                "未选择目录（可直接手动输入路径）".to_string()
            } else {
                format!("系统对话框失败：{err}（可直接手动输入路径）")
            });
        }
        Ok(picked)
    }
    #[cfg(not(windows))]
    {
        Err("当前平台不支持系统目录选择（请手动输入路径）".to_string())
    }
}

// ---------- Tauri 命令 ----------
//
// 全部是 `async fn`：Tauri 的同步命令会**内联跑在 IPC 回调线程（UI 主线程）**上
// （见 tauri-macros 的 `body_blocking`），而这些命令要做文件读取、目录遍历、
// 起线程 / join 线程、甚至拉起系统对话框——放在主线程上会直接表现为界面卡顿。
// 详见 CLAUDE.md 开发注意事项 16。

#[tauri::command]
pub async fn watch_start(
    state: tauri::State<'_, Watcher>,
    payload: Value,
) -> Result<Value, String> {
    let bindings: Vec<Binding> = serde_json::from_value(
        payload.get("bindings").cloned().unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| format!("bindings 解析失败: {e}"))?;
    let known: HashMap<String, HashSet<String>> = serde_json::from_value(
        payload.get("known").cloned().unwrap_or(Value::Object(serde_json::Map::new())),
    )
    .map_err(|e| format!("known 解析失败: {e}"))?;
    let interval = payload.get("intervalMs").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_INTERVAL_MS);
    start(&state, bindings, known, interval)
}

#[tauri::command]
pub async fn watch_stop(state: tauri::State<'_, Watcher>) -> Result<Value, String> {
    stop(&state)?;
    Ok(json!({ "ok": true, "running": false }))
}

#[tauri::command]
pub async fn watch_poll(state: tauri::State<'_, Watcher>) -> Result<Value, String> {
    poll(&state)
}

#[tauri::command]
pub async fn watch_set_known(
    state: tauri::State<'_, Watcher>,
    payload: Value,
) -> Result<Value, String> {
    let known: HashMap<String, HashSet<String>> = serde_json::from_value(
        payload.get("known").cloned().unwrap_or(Value::Object(serde_json::Map::new())),
    )
    .map_err(|e| format!("known 解析失败: {e}"))?;
    set_known(&state, known)
}

#[tauri::command]
pub async fn watch_read(state: tauri::State<'_, Watcher>, payload: Value) -> Result<Value, String> {
    let binding_id = payload.get("bindingId").and_then(|v| v.as_str()).unwrap_or("");
    let rel_path = payload.get("relPath").and_then(|v| v.as_str()).unwrap_or("");
    if binding_id.is_empty() || rel_path.is_empty() {
        return Err("缺少 bindingId 或 relPath".to_string());
    }
    read_file(&state, binding_id, rel_path)
}

/// 校验目录：会遍历整棵子目录树（上限 5000 个文件），因此必须离开 UI 主线程。
/// `kind`（可选，默认 `md`）决定统计 Markdown 还是 SQL 文件。
#[tauri::command]
pub async fn watch_check_dir(payload: Value) -> Result<Value, String> {
    let dir = payload.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("md").to_string();
    Ok(check_dir_kind(&dir, &kind))
}

/// 系统「选择文件夹」对话框：内部会起 PowerShell 并**同步等待用户操作**（可能数十秒），
/// 必须 async，否则主线程会被整个对话框期间堵死。
#[tauri::command]
pub async fn watch_browse_dir() -> Result<String, String> {
    browse_dir()
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ln-watch-{}-{}-{}", tag, std::process::id(), now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn present(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn kinds(events: &[Event]) -> Vec<String> {
        events.iter().map(|e| format!("{}:{}", e.kind, e.rel_path)).collect()
    }

    #[test]
    fn markdown_extension_matching() {
        for ok in ["a.md", "A.MD", "b.markdown", "c.mdown", "d.mkd", "e.Mkd"] {
            assert!(is_markdown(ok), "{ok} 应识别为 Markdown");
        }
        for bad in ["a.txt", "a.md.bak", "md", "a.markdownx", ""] {
            assert!(!is_markdown(bad), "{bad} 不应识别为 Markdown");
        }
    }

    #[test]
    fn scan_files_filters_by_kind() {
        assert!(is_sql("a.sql"));
        assert!(is_sql("A.SQL"));
        assert!(!is_sql("a.md"));
        assert!(!is_sql("sql"));
        assert!(!is_sql("a.sqlx"));

        let root = tmp_root("kind");
        std::fs::write(root.join("a.sql"), "select 1;").unwrap();
        std::fs::write(root.join("b.md"), "# x").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/c.SQL"), "select 2;").unwrap();

        let sql: Vec<String> = scan_files(&root, "sql").unwrap().into_iter().collect();
        assert_eq!(sql, vec!["a.sql", "sub/c.SQL"]);
        let md: Vec<String> = scan_files(&root, "md").unwrap().into_iter().collect();
        assert_eq!(md, vec!["b.md"]);

        let info = check_dir_kind(&root.to_string_lossy(), "sql");
        assert_eq!(info["kind"], "sql");
        assert_eq!(info["count"], 2);
        assert_eq!(check_dir_kind(&root.to_string_lossy(), "md")["count"], 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn binding_kind_defaults_to_md() {
        let b: Binding = serde_json::from_value(json!({ "id": "w1", "dir": "D:/x" })).unwrap();
        assert_eq!(b.kind, "md", "旧前端不带 kind 时必须按 Markdown 处理");
        let s: Binding =
            serde_json::from_value(json!({ "id": "w2", "dir": "D:/x", "kind": "sql" })).unwrap();
        assert_eq!(s.kind, "sql");
    }

    #[test]
    fn scan_finds_nested_markdown_and_skips_noise() {
        let root = tmp_root("scan");
        std::fs::write(root.join("a.md"), "A").unwrap();
        std::fs::write(root.join("notes.txt"), "T").unwrap();
        std::fs::create_dir_all(root.join("sub/deep")).unwrap();
        std::fs::write(root.join("sub/b.markdown"), "B").unwrap();
        std::fs::write(root.join("sub/deep/c.MD"), "C").unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join(".hidden/d.md"), "D").unwrap();
        std::fs::write(root.join(".dot.md"), "E").unwrap();

        let found = scan_markdown(&root).unwrap();
        let list: Vec<String> = found.into_iter().collect();
        assert_eq!(list, vec!["a.md", "sub/b.markdown", "sub/deep/c.MD"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_reports_missing_dir() {
        let missing = std::env::temp_dir().join("ln-watch-definitely-missing-xyz");
        assert!(scan_markdown(&missing).is_err());
    }

    #[test]
    fn diff_reports_added_and_removed_once() {
        let mut pending: HashSet<(String, String)> = HashSet::new();
        let mut out: Vec<Event> = Vec::new();

        // 首次：known 为空、目录里有 a.md → added
        diff_events("w1", &present(&["a.md"]), &HashSet::new(), &mut pending, &mut out);
        assert_eq!(kinds(&out), vec!["added:a.md"]);

        // 同一批再算一次：pending 拦住，不重复发
        out.clear();
        diff_events("w1", &present(&["a.md"]), &HashSet::new(), &mut pending, &mut out);
        assert!(out.is_empty(), "pending 应阻止重复事件");

        // 前端确认落库后 pending 清掉，此时它转为 known → 无事件
        pending.clear();
        out.clear();
        diff_events("w1", &present(&["a.md"]), &set(&["a.md"]), &mut pending, &mut out);
        assert!(out.is_empty());

        // a.md 消失 → removed
        out.clear();
        diff_events("w1", &present(&[]), &set(&["a.md"]), &mut pending, &mut out);
        assert_eq!(kinds(&out), vec!["removed:a.md"]);

        // 再次计算同样不重复
        out.clear();
        diff_events("w1", &present(&[]), &set(&["a.md"]), &mut pending, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn diff_ignores_content_changes() {
        // 内容修改不改变路径集合 → 不产生任何事件（「只监听新增、删除」）
        let mut pending: HashSet<(String, String)> = HashSet::new();
        let mut out: Vec<Event> = Vec::new();
        diff_events("w1", &present(&["a.md"]), &set(&["a.md"]), &mut pending, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn diff_sorts_added_and_removed_deterministically() {
        let mut pending = HashSet::new();
        let mut out = Vec::new();
        diff_events("w1", &present(&["b.md", "a.md"]), &HashSet::new(), &mut pending, &mut out);
        assert_eq!(kinds(&out), vec!["added:a.md", "added:b.md"]);

        pending.clear();
        out.clear();
        diff_events("w1", &present(&[]), &set(&["b.md", "a.md"]), &mut pending, &mut out);
        assert_eq!(kinds(&out), vec!["removed:a.md", "removed:b.md"]);
    }

    #[test]
    fn resolve_inside_rejects_escapes_and_accepts_nested() {
        let root = tmp_root("resolve");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/ok.md"), "ok").unwrap();
        std::fs::write(root.join("top.md"), "top").unwrap();

        let dir = root.to_string_lossy().to_string();
        assert!(resolve_inside(&dir, "top.md").is_ok());
        assert!(resolve_inside(&dir, "sub/ok.md").is_ok());
        assert!(resolve_inside(&dir, "sub\\ok.md").is_ok());          // 反斜杠归一化
        assert!(resolve_inside(&dir, "../escape.md").is_err());
        assert!(resolve_inside(&dir, "sub/../../escape.md").is_err());
        assert!(resolve_inside(&dir, "").is_err());
        assert!(resolve_inside(&dir, &root.join("top.md").to_string_lossy()).is_err()); // 绝对路径
        assert!(resolve_inside(&dir, "sub/missing.md").is_err());      // 不存在
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn base64_matches_reference_vectors() {
        assert_eq!(b64_encode(b""), "");
        assert_eq!(b64_encode(b"f"), "Zg==");
        assert_eq!(b64_encode(b"fo"), "Zm8=");
        assert_eq!(b64_encode(b"foo"), "Zm9v");
        assert_eq!(b64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(b64_encode("轻记".as_bytes()), "6L276K6w");
    }

    #[test]
    fn check_dir_reports_counts_and_errors() {
        let root = tmp_root("check");
        std::fs::write(root.join("a.md"), "A").unwrap();
        std::fs::write(root.join("b.txt"), "B").unwrap();

        let ok = check_dir(&root.to_string_lossy());
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["mdCount"], 1);
        assert_eq!(ok["isDir"], true);

        assert_eq!(check_dir("").get("ok").unwrap(), &json!(false));
        assert_eq!(check_dir(&root.join("a.md").to_string_lossy()).get("ok").unwrap(), &json!(false));
        assert_eq!(check_dir("Z:\\definitely\\missing\\dir").get("ok").unwrap(), &json!(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_file_returns_base64_and_enforces_limits() {
        let root = tmp_root("read");
        std::fs::write(root.join("a.md"), "# 标题\n正文").unwrap();
        let w = Watcher::default();
        start(
            &w,
            vec![Binding { id: "w1".into(), dir: root.to_string_lossy().to_string(), kind: "md".into() }],
            HashMap::new(),
            MIN_INTERVAL_MS,
        )
        .unwrap();

        let got = read_file(&w, "w1", "a.md").unwrap();
        assert_eq!(got["ok"], true);
        assert_eq!(b64_decode(got["base64"].as_str().unwrap()), "# 标题\n正文".as_bytes());

        // 未知绑定 / 越界路径 / 不存在文件
        assert!(read_file(&w, "nope", "a.md").is_err());
        assert!(read_file(&w, "w1", "../outside.md").is_err());
        assert!(read_file(&w, "w1", "missing.md").is_err());

        // 超过 2MB 的文件被拒绝
        let big = root.join("big.md");
        std::fs::write(&big, vec![b'x'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        let err = read_file(&w, "w1", "big.md").unwrap_err();
        assert!(err.contains("文件过大"), "实际错误：{err}");

        stop(&w).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 端到端：真起线程轮询 —— 新增 / 内容修改 / 删除 / 停止
    #[test]
    fn watcher_thread_reports_add_change_and_delete() {
        let root = tmp_root("e2e");
        std::fs::write(root.join("keep.md"), "keep").unwrap();
        let w = Watcher::default();
        let mut known: HashMap<String, HashSet<String>> = HashMap::new();
        known.insert("w1".to_string(), set(&["keep.md"]));
        start(
            &w,
            vec![Binding { id: "w1".into(), dir: root.to_string_lossy().to_string(), kind: "md".into() }],
            known,
            MIN_INTERVAL_MS,
        )
        .unwrap();
        assert_eq!(poll(&w).unwrap()["running"], true);

        // 基线：无事件
        thread::sleep(Duration::from_millis(500));
        assert_eq!(poll(&w).unwrap()["events"].as_array().unwrap().len(), 0);

        // 新增 new.md → added
        std::fs::write(root.join("new.md"), "new").unwrap();
        let mut ev = wait_events(&w, 1);
        assert_eq!(kinds(&ev), vec!["added:new.md"]);

        // 前端落库：登记 new.md（pending 释放）
        let mut known2 = HashMap::new();
        known2.insert("w1".to_string(), set(&["keep.md", "new.md"]));
        set_known(&w, known2).unwrap();

        // 修改内容 → 不产生事件（只监听新增/删除）
        std::fs::write(root.join("keep.md"), "keep-changed-much-longer").unwrap();
        thread::sleep(Duration::from_millis(500));
        ev = poll_events(&w);
        assert!(ev.is_empty(), "内容修改不应产生事件，实际 {ev:?}");

        // 删除 keep.md → removed
        std::fs::remove_file(root.join("keep.md")).unwrap();
        ev = wait_events(&w, 1);
        assert_eq!(kinds(&ev), vec!["removed:keep.md"]);

        // 停止后不再扫描、队列清空
        stop(&w).unwrap();
        let after = poll(&w).unwrap();
        assert_eq!(after["running"], false);
        assert_eq!(after["events"].as_array().unwrap().len(), 0);
        assert_eq!(after["bindings"], 0);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 应用重启补跑语义：known 里登记了但文件已不在 → 启动后立即报删除
    #[test]
    fn restart_replays_changes_made_while_app_was_closed() {
        let root = tmp_root("replay");
        std::fs::write(root.join("kept.md"), "kept").unwrap();
        std::fs::write(root.join("appeared-while-closed.md"), "new").unwrap();

        let w = Watcher::default();
        let mut known = HashMap::new();
        // 上次运行登记了 kept.md 与 gone.md（后者在关闭期间被删掉）
        known.insert("w1".to_string(), set(&["kept.md", "gone.md"]));
        start(
            &w,
            vec![Binding { id: "w1".into(), dir: root.to_string_lossy().to_string(), kind: "md".into() }],
            known,
            MIN_INTERVAL_MS,
        )
        .unwrap();

        let ev = wait_events(&w, 2);
        assert_eq!(kinds(&ev), vec!["added:appeared-while-closed.md", "removed:gone.md"]);
        stop(&w).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 取走当前队列里的事件（测试辅助，把 JSON 还原成 Event）
    fn poll_events(w: &Watcher) -> Vec<Event> {
        let v = poll(w).unwrap();
        let arr = v["events"].as_array().unwrap().clone();
        arr.into_iter()
            .map(|ev| serde_json::from_value(ev).unwrap())
            .collect()
    }

    fn wait_events(w: &Watcher, expect: usize) -> Vec<Event> {
        let mut acc: Vec<Event> = Vec::new();
        for _ in 0..60 {
            thread::sleep(Duration::from_millis(100));
            acc.extend(poll_events(w));
            if acc.len() >= expect {
                break;
            }
        }
        acc
    }

    fn b64_decode(s: &str) -> Vec<u8> {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out: Vec<u8> = Vec::new();
        let mut buf: u32 = 0;
        let mut bits = 0usize;
        for c in s.bytes() {
            if c == b'=' {
                break;
            }
            let idx = match T.iter().position(|&t| t == c) {
                Some(i) => i as u32,
                None => continue,
            };
            buf = (buf << 6) | idx;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push(((buf >> bits) & 0xff) as u8);
            }
        }
        out
    }
}
