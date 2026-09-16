//! SQL 文件批量导入（只读）
//!
//! 用途：用户在「🗄️ SQL」TAB 里指定一个本地目录，把其中（含子目录）所有 `.sql` 文件
//! 批量导入到应用内查看。与本仓库其它模块一样的分工——**Rust 只读盘、不碰密钥、不解密**：
//! 文件内容以 base64 回给前端（前端用既有的 `decodeMdBytes()` 解码 UTF-8 / UTF-16 / GBK），
//! 去重、上限判定、落库（写进前端加密的本地存储）全部由前端负责。
//!
//! 安全约束（与 `watch.rs` 同口径，改动时必须守住）：
//! - **只读**：只用 `read_dir` / `metadata` / `read` / `canonicalize`，**没有任何写操作**
//!   （既不写也不删用户的文件，唯一会起外部进程的 `sql_browse_dir` 复用 `export::pick_folder`）；
//! - 单文件路径一律经 `watch::resolve_inside()` 校验：拒绝绝对路径、`..`、以及符号链接跳出目录；
//! - 有递归深度（`MAX_DEPTH`）、扫描数量（`MAX_SCAN_ENTRIES` / `MAX_FILES`）、单文件大小
//!   （`MAX_FILE_BYTES`）上限，超限只跳过并在结果里报告，不报错中断；
//! - 命令全部 `async fn`：要遍历目录树 / 读文件 / 等系统对话框（见 CLAUDE.md 开发注意事项 16）。

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

/// 递归深度上限（与目录监听同口径，防深层目录树拖慢扫描）
pub const MAX_DEPTH: usize = 8;
/// 一次扫描最多返回的 .sql 文件数（超出即截断，结果里 truncated=true）
pub const MAX_FILES: usize = 1000;
/// 一次扫描最多访问的目录项（防超大目录树卡住）
pub const MAX_SCAN_ENTRIES: usize = 20_000;
/// 单个文件读取上限（超过只跳过并在前端提示）
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// 扫描到的一个 SQL 文件（相对路径用 `/` 分隔）
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlFile {
    pub rel_path: String,
    pub size: u64,
}

/// 扫描结果
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scan {
    pub files: Vec<SqlFile>,
    /// 因超过单文件上限被跳过的相对路径
    pub too_big: Vec<String>,
    /// 是否因文件数 / 目录项上限被截断
    pub truncated: bool,
}

fn is_sql(name: &str) -> bool {
    match name.rsplit_once('.') {
        None => false,
        Some((_, ext)) => ext.eq_ignore_ascii_case("sql"),
    }
}

/// 相对路径统一用 `/` 分隔，作为稳定的键（Windows 上也不受 `\` 影响）
fn rel_key(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 递归收集目录下的 `.sql` 相对路径 + 大小（跳过点目录 / 点文件），按路径排序保证结果稳定。
/// 超过单文件上限的文件不返回，但在 `too_big` 里列出，供前端提示。
pub fn scan_sql(root: &Path) -> Result<Scan, String> {
    if !root.exists() {
        return Err("目录不存在".to_string());
    }
    if !root.is_dir() {
        return Err("不是目录".to_string());
    }
    let mut out = Scan::default();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut visited = 0usize;
    'walk: while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // 无权限等：跳过该子树，不影响其它目录
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_SCAN_ENTRIES {
                out.truncated = true;
                break 'walk;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;   // 隐藏文件 / 版本控制目录一律跳过
            }
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_dir() {
                stack.push((entry.path(), depth + 1));
                continue;
            }
            if !ft.is_file() || !is_sql(&name) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let Some(rel) = entry.path().strip_prefix(root).ok().map(rel_key) else {
                continue;
            };
            if size > MAX_FILE_BYTES {
                out.too_big.push(rel);
                continue;
            }
            out.files.push(SqlFile { rel_path: rel, size });
            if out.files.len() >= MAX_FILES {
                out.truncated = true;
                break 'walk;
            }
        }
    }
    out.files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out.too_big.sort();
    Ok(out)
}

/// 校验目录并扫描（不修改任何状态），返回给前端的 JSON
pub fn scan_dir(dir: &str) -> Value {
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
    match scan_sql(p) {
        Ok(s) => {
            let total: u64 = s.files.iter().map(|f| f.size).sum();
            json!({
                "ok": true,
                "dir": dir,
                "count": s.files.len(),
                "totalBytes": total,
                "files": s.files,
                "tooBig": s.too_big,
                "truncated": s.truncated,
                "maxFiles": MAX_FILES,
                "maxFileBytes": MAX_FILE_BYTES,
            })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// 读取目录内一个文件（base64 回传）。路径必须落在 `dir` 之内，且有单文件大小上限。
pub fn read_file(dir: &str, rel: &str) -> Result<Value, String> {
    let full = crate::watch::resolve_inside(dir, rel)?;
    let meta = std::fs::metadata(&full).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if !meta.is_file() {
        return Err("不是文件".to_string());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大（超过 {} KB）",
            MAX_FILE_BYTES / 1024
        ));
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("无法读取文件: {e}"))?;
    Ok(json!({ "ok": true, "size": bytes.len(), "base64": crate::watch::b64_encode(&bytes) }))
}

// ---------- Tauri 命令 ----------
//
// 全部 `async fn`：同步命令会被 tauri-macros 的 body_blocking 内联执行在 IPC 回调线程
// （Windows 上就是 UI 主线程）上，而这里要遍历目录、读文件、等系统对话框，
// 放在主线程上就是「点一下卡一下」（见 CLAUDE.md 开发注意事项 16）。

/// 扫描指定目录里的 .sql（只读）
#[tauri::command]
pub async fn sql_scan_dir(payload: Value) -> Result<Value, String> {
    let dir = payload.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(scan_dir(&dir))
}

/// 读取目录内的一个 .sql（只读，路径必须落在该目录内）
#[tauri::command]
pub async fn sql_read_file(payload: Value) -> Result<Value, String> {
    let dir = payload.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let rel = payload.get("relPath").and_then(|v| v.as_str()).unwrap_or("");
    if dir.trim().is_empty() || rel.trim().is_empty() {
        return Err("缺少 dir 或 relPath".to_string());
    }
    read_file(&dir, rel)
}

/// 系统「选择文件夹」对话框（挑要导入的 SQL 目录）。
/// 复用导出模块的对话框实现：内部会起 PowerShell 并**同步等待用户操作**，必须 async。
#[tauri::command]
pub async fn sql_browse_dir(payload: Value) -> Result<Value, String> {
    let initial = payload.get("initialDir").and_then(|v| v.as_str()).unwrap_or("");
    crate::export::pick_folder("选择要导入 SQL 文件的目录", initial)
        .map(|p| json!({ "ok": true, "dir": p }))
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ln-sql-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn paths(s: &Scan) -> Vec<String> {
        s.files.iter().map(|f| f.rel_path.clone()).collect()
    }

    #[test]
    fn sql_extension_matching() {
        for ok in ["a.sql", "A.SQL", "schema.Sql", "db.dump.sql"] {
            assert!(is_sql(ok), "{ok} 应识别为 SQL");
        }
        for bad in ["a.txt", "a.sql.bak", "sql", "a.sqlx", ""] {
            assert!(!is_sql(bad), "{bad} 不应识别为 SQL");
        }
    }

    #[test]
    fn scan_finds_nested_sql_and_skips_noise() {
        let root = tmp_root("scan");
        std::fs::write(root.join("a.sql"), "select 1;").unwrap();
        std::fs::write(root.join("notes.md"), "# 不是 sql").unwrap();
        std::fs::write(root.join("draft.SQL"), "select 2;").unwrap();
        std::fs::create_dir_all(root.join("sub/deep")).unwrap();
        std::fs::write(root.join("sub/b.sql"), "select 3;").unwrap();
        std::fs::write(root.join("sub/deep/c.sql"), "select 4;").unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join(".hidden/d.sql"), "select 5;").unwrap();
        std::fs::write(root.join(".dot.sql"), "select 6;").unwrap();

        let s = scan_sql(&root).unwrap();
        assert_eq!(paths(&s), vec!["a.sql", "draft.SQL", "sub/b.sql", "sub/deep/c.sql"]);
        assert_eq!(s.files[0].size, 9); // "select 1;" —— 前端据 size 显示体积
        assert!(s.too_big.is_empty());
        assert!(!s.truncated);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_reports_missing_dir_and_files() {
        let missing = std::env::temp_dir().join("ln-sql-definitely-missing-xyz");
        assert!(scan_sql(&missing).is_err());

        let root = tmp_root("notdir");
        std::fs::write(root.join("a.sql"), "select 1;").unwrap();
        assert!(scan_sql(&root.join("a.sql")).is_err(), "文件路径应报「不是目录」");

        let json = scan_dir(&missing.to_string_lossy());
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "目录不存在");
        assert_eq!(scan_dir("")["ok"], false);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_skips_oversize_files_and_reports_them() {
        let root = tmp_root("oversize");
        std::fs::write(root.join("small.sql"), "select 1;").unwrap();
        std::fs::write(root.join("big.sql"), vec![b'x'; (MAX_FILE_BYTES + 1) as usize]).unwrap();

        let s = scan_sql(&root).unwrap();
        assert_eq!(paths(&s), vec!["small.sql"]);
        assert_eq!(s.too_big, vec!["big.sql".to_string()]);

        let json = scan_dir(&root.to_string_lossy());
        assert_eq!(json["ok"], true);
        assert_eq!(json["count"], 1);
        assert_eq!(json["totalBytes"], 9);
        assert_eq!(json["tooBig"][0], "big.sql");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_file_returns_base64_and_enforces_limits() {
        let root = tmp_root("read");
        std::fs::write(root.join("a.sql"), "select 1;").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.sql"), "select 2;").unwrap();

        let got = read_file(&root.to_string_lossy(), "sub/b.sql").unwrap();
        assert_eq!(got["ok"], true);
        assert_eq!(got["size"], 9);
        // 与 watch.rs 的 base64 参考向量同口径：只做长度与字符集检查，实际解码由前端测试覆盖
        assert_eq!(got["base64"].as_str().unwrap(), "c2VsZWN0IDI7");

        // 越界 / 绝对路径 / 不存在 / 目录
        assert!(read_file(&root.to_string_lossy(), "../outside.sql").is_err());
        assert!(read_file(&root.to_string_lossy(), "C:\\Windows\\win.ini").is_err());
        assert!(read_file(&root.to_string_lossy(), "missing.sql").is_err());
        assert!(read_file(&root.to_string_lossy(), "sub").is_err());

        // 超过单文件上限的文件被拒绝
        std::fs::write(root.join("big.sql"), vec![b'x'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        // 扫描阶段就跳过它，因此这里直接确认读取也会被拦住
        let err = read_file(&root.to_string_lossy(), "big.sql").unwrap_err();
        assert!(err.contains("文件过大"), "实际错误：{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_is_deterministic_and_caps_depth() {
        let root = tmp_root("depth");
        // 深度 1~MAX_DEPTH 都能扫到，超过 MAX_DEPTH 的子树被忽略
        let mut deep = root.clone();
        for i in 0..(MAX_DEPTH + 2) {
            deep = deep.join(format!("d{i}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("too-deep.sql"), "select 1;").unwrap();
        assert!(scan_sql(&root).unwrap().files.is_empty());

        // 同一次扫描的结果顺序稳定（前端按此顺序入库）
        std::fs::write(root.join("b.sql"), "b").unwrap();
        std::fs::write(root.join("a.sql"), "a").unwrap();
        let s = scan_sql(&root).unwrap();
        assert_eq!(paths(&s), vec!["a.sql", "b.sql"]);
        assert_eq!(paths(&scan_sql(&root).unwrap()), paths(&s));
        let _ = std::fs::remove_dir_all(&root);
    }
}
