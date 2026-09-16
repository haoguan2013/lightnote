//! 笔记导出（Export）
//!
//! 前端把要导出的笔记**渲染成 Markdown 文本**后交给本模块落盘：
//! - 单篇导出：系统「保存文件」对话框选路径（`export_pick_save` → `export_save_file`）
//! - 批量导出：系统「选择文件夹」对话框选目录，每篇笔记写一个 `.md`（`export_write_files`）
//!
//! 这是继只读桥之后**第二个会碰用户磁盘的能力**（只读桥只读、目录监听只读，本模块是唯一写盘的地方），
//! 因此安全设计必须守住：
//! ① **只写、只创建**——不删除、不移动、不改名任何已有文件；同名默认**不覆盖**（自动改叫「名字 (2).md」）；
//! ② 文件名必须**净化**：去掉路径分隔符与 Windows 非法字符（`< > : " / \ | ? *`）、控制字符、结尾的 `.` 与空格，
//!    避开设备保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9），限长 120 字符，强制 `.md` 扩展名；
//! ③ 目标必须是**已存在的目录**（不替用户建目录树），且拼出的路径必须仍落在该目录内；
//! ④ 有单篇与单批上限，防止误传超大 payload；
//! ⑤ **不接触 PIN / 密钥 / 密文**——前端只传纯文本，导出的是用户自己看得见的笔记内容。
//!
//! 与目录监听的关系：本模块刻意独立于 `watch.rs`（那个模块必须保持"纯读取"），
//! 两边各自持有自己的系统对话框，互不影响。

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 文件名（不含扩展名）最大字符数
const MAX_STEM_CHARS: usize = 120;
/// 一次批量导出的文件数上限
const MAX_FILES: usize = 2000;
/// 单篇正文上限（UTF-8 字节）
const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;
/// 一次批量导出的正文总字节上限
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;
/// 认得的 Markdown 扩展名（与导入 / 目录监听一致）
const MD_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd"];
/// 标题净化后为空时用的兜底名
const FALLBACK_STEM: &str = "未命名";
/// Windows 设备保留名（这些名字带扩展名也同样不可用）
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

// ---------- 数据结构 ----------

/// 一条待写出的文件（name = 笔记标题，扩展名由本模块补）
#[derive(Clone, Debug, Deserialize)]
pub struct ExportFile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub content: String,
}

/// 落盘计划（纯计算结果，便于单测）
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    /// 最终文件名（含 `.md`）
    pub name: String,
    /// 名字与「标题原文」不同（因净化或重名避让）
    pub renamed: bool,
    /// 会覆盖目录里已存在的同名文件
    pub overwrites: bool,
}

// ---------- 纯逻辑 ----------

/// PowerShell 单引号字符串转义（`'` → `''`）。
/// 系统对话框的路径 / 标题要拼进 `-Command` 脚本里，必须经过它，否则标题里的引号能改写脚本。
pub fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// 去掉已知的 Markdown 扩展名（标题本身叫 `笔记.md` 时不至于导出成 `笔记.md.md`）
fn strip_md_ext(s: &str) -> &str {
    match s.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && MD_EXTS.contains(&ext.to_ascii_lowercase().as_str()) => stem,
        _ => s,
    }
}

/// 是否命中 Windows 设备保留名（只看第一个 `.` 之前的部分）
fn is_reserved_name(s: &str) -> bool {
    let head = s.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    RESERVED_NAMES.contains(&head.as_str())
}

/// 把笔记标题净化为安全的文件名（不含扩展名）。
///
/// - 只取最后一段路径分量（标题里带 `/` 或 `\` 时不会被当成目录）
/// - 非法字符与控制字符替换为 `_`，空白折叠为单个空格
/// - 去掉首尾空白与结尾的 `.`（Windows 不允许文件名以点结尾）
/// - 空 → 「未命名」；命中设备保留名 → 前面加 `_`；超长 → 截断到 120 字符
pub fn sanitize_file_stem(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let no_ext = strip_md_ext(last);
    let mut mapped = String::with_capacity(no_ext.len());
    for ch in no_ext.chars() {
        // 换行 / 制表这类空白控制字符留给后面的「空白折叠」处理（换成 `_` 会得到很怪的文件名）
        let bad = (ch.is_control() && !ch.is_whitespace())
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        mapped.push(if bad { '_' } else { ch });
    }
    let collapsed = mapped.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim().trim_end_matches('.').trim();
    let mut out: String = trimmed.chars().take(MAX_STEM_CHARS).collect();
    out = out.trim().to_string();
    if out.is_empty() {
        return FALLBACK_STEM.to_string();
    }
    if is_reserved_name(&out) {
        out.insert(0, '_');
    }
    out
}

/// 加「 (n)」后缀（同时保证总长不超上限）
fn with_suffix(stem: &str, n: usize) -> String {
    let suffix = format!(" ({n})");
    let keep = MAX_STEM_CHARS.saturating_sub(suffix.chars().count());
    let head: String = stem.chars().take(keep).collect();
    format!("{}{suffix}.md", head.trim_end())
}

/// 为一组标题算出实际要写出的文件名：净化 → 批内去重 → （未开覆盖时）避开目录里已有的同名文件。
///
/// 纯逻辑 + 一次目录存在性查询；`overwrite = true` 时不再避让磁盘上的同名文件（由用户显式确认覆盖）。
pub fn plan_names(stems: &[String], dir: &Path, overwrite: bool) -> Vec<Plan> {
    let mut used: HashSet<String> = HashSet::new();
    let mut plans = Vec::with_capacity(stems.len());
    for raw in stems {
        let stem = sanitize_file_stem(raw);
        let mut renamed = stem != raw.trim();
        let mut candidate = format!("{stem}.md");
        let mut overwrites = overwrite && dir.join(&candidate).exists();
        let mut n = 2usize;
        loop {
            let clash_in_batch = used.contains(&candidate.to_lowercase());
            let clash_on_disk = !overwrite && dir.join(&candidate).exists();
            if !clash_in_batch && !clash_on_disk {
                break;
            }
            candidate = with_suffix(&stem, n);
            renamed = true;
            n += 1;
            overwrites = overwrite && dir.join(&candidate).exists();
        }
        used.insert(candidate.to_lowercase());
        plans.push(Plan { name: candidate, renamed, overwrites });
    }
    plans
}

// ---------- 落盘 ----------

/// 批量写出：`dir` 必须是已存在的目录，每个笔记一个 `.md`。
pub fn write_files(dir: &str, files: Vec<ExportFile>, overwrite: bool) -> Result<Value, String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return Err("请先选择导出到的目录".to_string());
    }
    if files.is_empty() {
        return Err("没有要导出的笔记".to_string());
    }
    if files.len() > MAX_FILES {
        return Err(format!("一次最多导出 {MAX_FILES} 个文件（当前 {}）", files.len()));
    }
    for f in &files {
        if f.content.len() > MAX_CONTENT_BYTES {
            return Err(format!("「{}」正文超过单篇上限（{} MB）", sanitize_file_stem(&f.name), MAX_CONTENT_BYTES / 1024 / 1024));
        }
    }
    let total: usize = files.iter().map(|f| f.content.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err(format!("本次导出总量超过上限（{} MB）", MAX_TOTAL_BYTES / 1024 / 1024));
    }

    let raw_dir = PathBuf::from(dir);
    if !raw_dir.exists() {
        return Err(format!("目录不存在：{dir}"));
    }
    if !raw_dir.is_dir() {
        return Err("目标不是目录".to_string());
    }
    // 规范化后再拼文件名：既拿到绝对路径，也让「路径必须落在目标目录内」的检查有意义
    let root = std::fs::canonicalize(&raw_dir).map_err(|e| format!("无法解析目录：{e}"))?;

    let stems: Vec<String> = files.iter().map(|f| f.name.clone()).collect();
    let plans = plan_names(&stems, &root, overwrite);

    let mut written: Vec<Value> = Vec::new();
    let mut failed: Vec<Value> = Vec::new();
    let mut bytes = 0usize;
    for (f, p) in files.iter().zip(plans.iter()) {
        let full = root.join(&p.name);
        // 双保险：拼出来的路径必须仍在目标目录内（净化已去掉分隔符，这里是最后一道闸）
        if full.parent() != Some(root.as_path()) {
            failed.push(json!({ "name": p.name, "error": "路径越界" }));
            continue;
        }
        match std::fs::write(&full, f.content.as_bytes()) {
            Ok(_) => {
                bytes += f.content.len();
                written.push(json!({ "name": p.name, "renamed": p.renamed, "overwritten": p.overwrites }));
            }
            Err(e) => failed.push(json!({ "name": p.name, "error": e.to_string() })),
        }
    }
    if written.is_empty() && !failed.is_empty() {
        let first = failed[0].get("error").and_then(|v| v.as_str()).unwrap_or("写入失败");
        return Err(format!("写入失败：{first}"));
    }
    Ok(json!({
        "ok": true,
        "dir": dir,
        "count": written.len(),
        "bytes": bytes,
        "renamedCount": written.iter().filter(|w| w["renamed"] == json!(true)).count(),
        "written": written,
        "failed": failed,
    }))
}

/// 单篇写出到「保存文件」对话框选定的完整路径（扩展名必须是 Markdown）。
pub fn save_file(path: &str, content: &str) -> Result<Value, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("导出路径为空".to_string());
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(format!("正文超过单篇上限（{} MB）", MAX_CONTENT_BYTES / 1024 / 1024));
    }
    let full = PathBuf::from(path);
    if !full.is_absolute() {
        return Err("导出路径必须是绝对路径".to_string());
    }
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !MD_EXTS.contains(&ext.as_str()) {
        return Err(format!("只支持导出为 Markdown（.md）：{path}"));
    }
    let parent = full.parent().ok_or_else(|| "导出路径缺少所在目录".to_string())?;
    if !parent.is_dir() {
        return Err(format!("所在目录不存在：{}", parent.display()));
    }
    std::fs::write(&full, content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
    Ok(json!({ "ok": true, "path": full.display().to_string(), "bytes": content.len() }))
}

// ---------- 系统对话框（零依赖：借 Windows PowerShell 的 WinForms 对话框） ----------

/// 跑一段 PowerShell 对话框脚本：选中的路径经 UTF-8 临时文件回传（避开管道里的 OEM 代码页乱码）。
/// 返回 `Ok(None)` = 用户取消；`Ok(Some(path))` = 选中；`Err` = 对话框本身失败。
fn run_dialog(script: &str) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let tmp = std::env::temp_dir().join(format!("ln-export-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        let full = replace_out(script, &tmp.display().to_string());
        // 两步式写法：链式没有插入点，会漏掉 hide_console（见 CLAUDE.md 开发注意事项 17）
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-STA", "-NonInteractive", "-Command", &full]);
        crate::hide_console(&mut cmd);   // 否则每点一次导出都会闪一个控制台窗口
        let out = cmd.output().map_err(|e| format!("无法调用系统对话框：{e}"))?;
        let picked = std::fs::read_to_string(&tmp).unwrap_or_default().trim().to_string();
        let _ = std::fs::remove_file(&tmp);
        if !picked.is_empty() {
            return Ok(Some(picked));
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            Ok(None)   // 取消选择
        } else {
            Err(format!("系统对话框失败：{err}"))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        Err("当前平台不支持系统对话框（请手动输入路径）".to_string())
    }
}

/// 输出路径占位符（脚本里的 `__OUT__` 由 `replace_out` 换成实际临时文件路径）
const OUT_PLACEHOLDER: &str = "__OUT__";

/// 把脚本里的 `__OUT__` 换成转义后的临时文件路径
pub fn replace_out(script: &str, out_path: &str) -> String {
    script.replace(OUT_PLACEHOLDER, &ps_quote(out_path))
}

/// 「选择文件夹」对话框脚本（纯函数，便于单测与语法自检）
pub fn folder_dialog_script(desc: &str, initial_dir: &str) -> String {
    format!(
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null; \
$d = New-Object System.Windows.Forms.FolderBrowserDialog; \
$d.Description = {desc}; \
$d.ShowNewFolderButton = $true; \
if ({init} -ne '' -and (Test-Path -LiteralPath {init})) {{ $d.SelectedPath = {init} }}; \
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
  [System.IO.File]::WriteAllText({out}, $d.SelectedPath, (New-Object System.Text.UTF8Encoding($false))) }}",
        desc = ps_quote(desc),
        init = ps_quote(initial_dir.trim()),
        out = OUT_PLACEHOLDER,
    )
}

/// 「保存文件」对话框脚本（纯函数，便于单测与语法自检）
pub fn save_dialog_script(default_stem: &str, initial_dir: &str) -> String {
    format!(
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null; \
$d = New-Object System.Windows.Forms.SaveFileDialog; \
$d.Title = {title}; \
$d.Filter = 'Markdown 文件 (*.md)|*.md|所有文件 (*.*)|*.*'; \
$d.DefaultExt = 'md'; \
$d.AddExtension = $true; \
$d.OverwritePrompt = $true; \
$d.FileName = {name}; \
if ({init} -ne '' -and (Test-Path -LiteralPath {init})) {{ $d.InitialDirectory = {init} }}; \
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
  [System.IO.File]::WriteAllText({out}, $d.FileName, (New-Object System.Text.UTF8Encoding($false))) }}",
        title = ps_quote("导出笔记为 Markdown"),
        name = ps_quote(&format!("{}.md", sanitize_file_stem(default_stem))),
        init = ps_quote(initial_dir.trim()),
        out = OUT_PLACEHOLDER,
    )
}

/// 系统「选择文件夹」对话框（导出目标目录）
pub fn pick_folder(desc: &str, initial_dir: &str) -> Result<Option<String>, String> {
    run_dialog(&folder_dialog_script(desc, initial_dir))
}

/// 系统「保存文件」对话框（单篇导出）；返回 None 表示用户取消。
/// `default_stem` 会被净化，扩展名固定为 `.md`。
pub fn pick_save_file(default_stem: &str, initial_dir: &str) -> Result<Option<String>, String> {
    run_dialog(&save_dialog_script(default_stem, initial_dir))
}

// ---------- Tauri 命令 ----------
//
// 全部 `async fn`：同步命令会被 tauri-macros 的 body_blocking 内联执行在 IPC 回调线程
// （Windows 上就是 UI 主线程）上，而这里要写文件、要等系统对话框（见 CLAUDE.md 开发注意事项 16）。

/// 批量导出：把若干篇笔记写成 `.md` 到指定目录
#[tauri::command]
pub async fn export_write_files(payload: Value) -> Result<Value, String> {
    let files: Vec<ExportFile> = serde_json::from_value(
        payload.get("files").cloned().unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| format!("files 解析失败：{e}"))?;
    let dir = payload.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let overwrite = payload.get("overwrite").and_then(|v| v.as_bool()).unwrap_or(false);
    write_files(&dir, files, overwrite)
}

/// 单篇导出：写到「保存文件」对话框给出的完整路径
#[tauri::command]
pub async fn export_save_file(payload: Value) -> Result<Value, String> {
    let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let content = payload.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    save_file(&path, &content)
}

/// 打开「选择文件夹」对话框挑导出目录（返回 `{ ok, dir }`，`dir` 为 null 表示取消）
#[tauri::command]
pub async fn export_pick_dir(payload: Value) -> Result<Value, String> {
    let initial = payload.get("initialDir").and_then(|v| v.as_str()).unwrap_or("");
    pick_folder("选择导出笔记到的目录", initial).map(|p| json!({ "ok": true, "dir": p }))
}

/// 打开「保存文件」对话框（返回 `{ ok, path }`，`path` 为 null 表示取消）
#[tauri::command]
pub async fn export_pick_save(payload: Value) -> Result<Value, String> {
    let name = payload.get("defaultName").and_then(|v| v.as_str()).unwrap_or("");
    let initial = payload.get("initialDir").and_then(|v| v.as_str()).unwrap_or("");
    pick_save_file(name, initial).map(|p| json!({ "ok": true, "path": p }))
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ln-export-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn stems(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn file(name: &str, content: &str) -> ExportFile {
        ExportFile { name: name.to_string(), content: content.to_string() }
    }

    fn names(plans: &[Plan]) -> Vec<String> {
        plans.iter().map(|p| p.name.clone()).collect()
    }

    #[test]
    fn sanitize_replaces_illegal_chars_and_paths() {
        assert_eq!(sanitize_file_stem("a<b>c:d\"e|f?g*h"), "a_b_c_d_e_f_g_h");
        assert_eq!(sanitize_file_stem("dir/sub/标题"), "标题");
        assert_eq!(sanitize_file_stem(r"D:\notes\深层\笔记"), "笔记");
        assert_eq!(sanitize_file_stem("换\n行\t制表"), "换 行 制表");
        assert_eq!(sanitize_file_stem("结尾有点..."), "结尾有点");
        assert_eq!(sanitize_file_stem("  前后空白  "), "前后空白");
    }

    #[test]
    fn sanitize_handles_empty_and_reserved_names() {
        assert_eq!(sanitize_file_stem(""), FALLBACK_STEM);
        assert_eq!(sanitize_file_stem("   "), FALLBACK_STEM);
        assert_eq!(sanitize_file_stem("..."), FALLBACK_STEM);
        assert_eq!(sanitize_file_stem("/"), FALLBACK_STEM);
        assert_eq!(sanitize_file_stem("CON"), "_CON");
        assert_eq!(sanitize_file_stem("com1"), "_com1");
        assert_eq!(sanitize_file_stem("LPT9.txt"), "_LPT9.txt");
        assert_eq!(sanitize_file_stem("console"), "console");   // 只是前缀相同，不算保留名
    }

    #[test]
    fn sanitize_strips_markdown_extension_and_truncates() {
        assert_eq!(sanitize_file_stem("笔记.md"), "笔记");
        assert_eq!(sanitize_file_stem("笔记.MARKDOWN"), "笔记");
        assert_eq!(sanitize_file_stem("a.b.txt"), "a.b.txt");   // 不是 md 扩展名就保留
        let long = "长".repeat(300);
        assert_eq!(sanitize_file_stem(&long).chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn ps_quote_escapes_single_quotes() {
        assert_eq!(ps_quote("a'b"), "'a''b'");
        assert_eq!(ps_quote("路径"), "'路径'");
        assert_eq!(ps_quote(""), "''");
    }

    #[test]
    fn plan_names_dedupes_within_batch() {
        let dir = tmp_root("dedupe");
        let plans = plan_names(&stems(&["同名", "同名", "同名"]), &dir, false);
        assert_eq!(names(&plans), vec!["同名.md", "同名 (2).md", "同名 (3).md"]);
        assert_eq!(plans[0].renamed, false);
        assert!(plans[1].renamed && plans[2].renamed);
        assert!(plans.iter().all(|p| !p.overwrites));
    }

    #[test]
    fn plan_names_dedupes_case_insensitively() {
        // Windows 文件系统不区分大小写：Note.md 与 note.md 是同一个文件
        let dir = tmp_root("case");
        let plans = plan_names(&stems(&["Note", "note"]), &dir, false);
        assert_eq!(names(&plans), vec!["Note.md", "note (2).md"]);
    }

    #[test]
    fn plan_names_avoids_existing_files_unless_overwrite() {
        let dir = tmp_root("existing");
        std::fs::write(dir.join("已有.md"), "旧").unwrap();
        let p1 = plan_names(&stems(&["已有"]), &dir, false);
        assert_eq!(names(&p1), vec!["已有 (2).md"]);
        assert!(p1[0].renamed && !p1[0].overwrites);
        // 开了覆盖：名字不变，且标记会覆盖
        let p2 = plan_names(&stems(&["已有"]), &dir, true);
        assert_eq!(names(&p2), vec!["已有.md"]);
        assert!(!p2[0].renamed && p2[0].overwrites);
        // 覆盖模式下，目录里没有的文件不会被标成覆盖
        let p3 = plan_names(&stems(&["新的"]), &dir, true);
        assert!(!p3[0].overwrites);
    }

    #[test]
    fn plan_names_keeps_long_suffix_within_limit() {
        let long = "长".repeat(MAX_STEM_CHARS);
        let plans = plan_names(&stems(&[long.as_str(), long.as_str()]), &Path::new("."), false);
        assert!(plans.iter().all(|p| p.name.chars().count() <= MAX_STEM_CHARS + 3));
        assert!(plans[1].name.ends_with(" (2).md"));
    }

    #[test]
    fn write_files_writes_utf8_and_reports() {
        let dir = tmp_root("write");
        let out = write_files(
            &dir.display().to_string(),
            vec![file("甲", "# 甲\n正文"), file("乙.md", "内容 B")],
            false,
        )
        .unwrap();
        assert_eq!(out["ok"], json!(true));
        assert_eq!(out["count"], json!(2));
        assert_eq!(out["failed"].as_array().unwrap().len(), 0);
        assert_eq!(std::fs::read_to_string(dir.join("甲.md")).unwrap(), "# 甲\n正文");
        assert_eq!(std::fs::read_to_string(dir.join("乙.md")).unwrap(), "内容 B");   // 标题带的 .md 不会变成 .md.md
        assert_eq!(out["bytes"], json!("# 甲\n正文".len() + "内容 B".len()));
    }

    #[test]
    fn write_files_never_overwrites_by_default() {
        let dir = tmp_root("nooverwrite");
        std::fs::write(dir.join("甲.md"), "原内容").unwrap();
        let out = write_files(&dir.display().to_string(), vec![file("甲", "新内容")], false).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("甲.md")).unwrap(), "原内容");
        assert_eq!(std::fs::read_to_string(dir.join("甲 (2).md")).unwrap(), "新内容");
        assert_eq!(out["written"][0]["renamed"], json!(true));
    }

    #[test]
    fn write_files_rejects_bad_targets_and_oversize() {
        let dir = tmp_root("reject");
        assert!(write_files("", vec![file("a", "x")], false).is_err());
        assert!(write_files(&dir.display().to_string(), vec![], false).is_err());
        let missing = dir.join("不存在");
        assert!(write_files(&missing.display().to_string(), vec![file("a", "x")], false).is_err());
        let afile = dir.join("a.md");
        std::fs::write(&afile, "x").unwrap();
        assert!(write_files(&afile.display().to_string(), vec![file("a", "x")], false).is_err());
        let many: Vec<ExportFile> = (0..MAX_FILES + 1).map(|i| file(&format!("n{i}"), "x")).collect();
        assert!(write_files(&dir.display().to_string(), many, false).is_err());
    }

    #[test]
    fn save_file_enforces_absolute_markdown_path() {
        let dir = tmp_root("save");
        let target = dir.join("单篇.md");
        let out = save_file(&target.display().to_string(), "# 标题\n正文").unwrap();
        assert_eq!(out["ok"], json!(true));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# 标题\n正文");

        assert!(save_file("", "x").is_err());
        assert!(save_file("相对路径.md", "x").is_err());
        assert!(save_file(&dir.join("a.txt").display().to_string(), "x").is_err());
        assert!(save_file(&dir.join("子目录").join("a.md").display().to_string(), "x").is_err());
    }

    #[test]
    fn dialog_scripts_carry_escaped_arguments() {
        // 标题里带单引号 / 中文时，拼进 PowerShell 也不能改写脚本
        let save = save_dialog_script("他'的 笔记", "D:\\导出");
        assert!(save.contains("$d.FileName = '他''的 笔记.md';"));
        assert!(save.contains("$d.InitialDirectory = 'D:\\导出'"));
        assert!(save.contains("$d.Filter = 'Markdown 文件 (*.md)|*.md|所有文件 (*.*)|*.*';"));
        assert!(save.contains(OUT_PLACEHOLDER));

        let folder = folder_dialog_script("选择导出笔记到的目录", "");
        assert!(folder.contains("$d.Description = '选择导出笔记到的目录';"));
        assert!(folder.contains("if ('' -ne ''"), "初始目录为空时不该设置 SelectedPath");

        // 输出占位符会被换成转义后的真实路径
        let replaced = replace_out(&folder, "C:\\tmp\\a'b.txt");
        assert!(replaced.contains("'C:\\tmp\\a''b.txt'"));
        assert!(!replaced.contains(OUT_PLACEHOLDER));
    }

    /// 真正的语法自检：把两个对话框脚本交给 PowerShell 解析器（只解析、不执行，不会弹窗）。
    /// 这类脚本只在用户点「导出」时才跑，写错了不会在别处暴露，所以必须在这里拦住。
    #[cfg(windows)]
    #[test]
    fn dialog_scripts_parse_as_valid_powershell() {
        let dir = tmp_root("psparse");
        for (tag, script) in [
            ("folder", folder_dialog_script("选择导出笔记到的目录", "D:\\导出")),
            ("save", save_dialog_script("标题'含引号", "D:\\导出")),
        ] {
            let file = dir.join(format!("{tag}.ps1"));
            std::fs::write(&file, replace_out(&script, "C:\\tmp\\out.txt")).unwrap();
            let check = format!(
                "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile({}, [ref]$null, [ref]$e); \
if ($e -and $e.Count -gt 0) {{ $e | ForEach-Object {{ $_.Message }}; exit 1 }}",
                ps_quote(&file.display().to_string())
            );
            let mut cmd = std::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &check]);
            crate::hide_console(&mut cmd);
            let out = cmd.output().expect("无法启动 powershell 做语法自检");
            assert!(
                out.status.success(),
                "{tag} 脚本语法有误：{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
}
