use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod bridge;
mod export;
mod session;
mod sql_import;
mod watch;

// 开机启动注册表项。值名必须与 tauri.conf.json 的 productName（"轻记"）一致：
// NSIS 卸载器（非更新模式）会删除 HKCU Run 下同名值，避免卸载后残留启动项。
#[cfg(windows)]
const AUTOSTART_RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const AUTOSTART_VALUE_NAME: &str = "轻记";

/// `CREATE_NO_WINDOW`：让子进程不创建控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 隐藏控制台程序的窗口。
///
/// 从 GUI 进程（本应用没有控制台）启动 `reg.exe` / `powershell.exe` 这类控制台程序时，
/// Windows 默认会给子进程**新建一个控制台窗口**——表现为「切到设置页时一闪而过的命令行弹窗」。
/// 设置 `CREATE_NO_WINDOW` 后子进程完全不显示窗口，stdout/stderr 仍可正常重定向读取。
#[cfg(windows)]
pub(crate) fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// 当前是否已启用开机自动启动（查询 HKCU Run 键是否存在）
///
/// async：内部要起 `reg.exe` 子进程，同步命令会内联跑在 UI 主线程上（见 CLAUDE.md 开发注意事项 16），
/// 正好是「点进设置页时卡一下」的来源。
#[tauri::command]
async fn autostart_status() -> bool {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("reg");
        cmd.args(["query", AUTOSTART_RUN_KEY, "/v", AUTOSTART_VALUE_NAME]);
        hide_console(&mut cmd);   // 否则每次切到设置页都会闪一个命令行窗口
        match cmd.output() {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 设置开机自动启动：写 / 删 HKCU Run 键。
/// 启用时写入的启动参数为 `--autostart`（应用启动后隐藏主窗口、驻留托盘）。
/// async：同样要起 `reg.exe`（见开发注意事项 16）。
#[tauri::command]
async fn autostart_set(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let res = if enabled {
            let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径: {e}"))?;
            let arg = format!("\"{}\" --autostart", exe.display());
            let mut cmd = Command::new("reg");
            cmd.args([
                "add",
                AUTOSTART_RUN_KEY,
                "/v",
                AUTOSTART_VALUE_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &arg,
                "/f",
            ]);
            hide_console(&mut cmd);
            cmd.output()
        } else {
            let mut cmd = Command::new("reg");
            cmd.args(["delete", AUTOSTART_RUN_KEY, "/v", AUTOSTART_VALUE_NAME, "/f"]);
            hide_console(&mut cmd);
            cmd.output()
        };
        let out = res.map_err(|e| format!("执行注册表命令失败: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if msg.is_empty() {
                "注册表操作未成功".to_string()
            } else {
                msg
            })
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("当前平台暂不支持开机自动启动".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(bridge::Bridge::default())
        .manage(watch::Watcher::default())
        .invoke_handler(tauri::generate_handler![
            autostart_status,
            autostart_set,
            bridge::bridge_start,
            bridge::bridge_sync,
            bridge::bridge_stop,
            bridge::bridge_status,
            watch::watch_start,
            watch::watch_stop,
            watch::watch_poll,
            watch::watch_set_known,
            watch::watch_read,
            watch::watch_check_dir,
            watch::watch_browse_dir,
            export::export_write_files,
            export::export_save_file,
            export::export_pick_dir,
            export::export_pick_save,
            sql_import::sql_scan_dir,
            sql_import::sql_read_file,
            sql_import::sql_browse_dir,
            session::session_poll
        ])
        .setup(|app| {
            // 托盘菜单：显示主窗口 / 退出
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出轻记", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true);

            // 托盘图标：优先取应用窗口图标
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.on_tray_icon_event(|tray, event| {
                // 左键单击托盘图标 → 显示并聚焦主窗口
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .build(app)?;

            // 开机自启动（--autostart 参数）：启动后隐藏主窗口，仅驻留托盘
            // 用户点击托盘图标或菜单「显示主窗口」后再输入 PIN 解锁
            let autostart = std::env::args().any(|a| a == "--autostart");
            if autostart {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // 系统锁屏联动（Win+L / 屏保锁定 / 远程断开会话）：把主窗口登记为会话通知接收者，
            // 锁屏事件只累加计数，由前端轮询 session_poll 发现新事件后调用 lockApp() 锁定笔记。
            // 登记失败不影响其它功能，只是拿不到锁屏事件（session_poll 会回 registered=false）。
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    let _ = session::start(hwnd.0 as isize);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 → 隐藏到托盘而非退出
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("启动应用失败");

    app.run(|app_handle, event| {
        // 退出时停止本地只读桥、目录监听（删发现文件、回收扫描线程）与会话锁屏通知（还原窗口过程）
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<bridge::Bridge>() {
                let _ = bridge::stop(state.inner());
            }
            if let Some(state) = app_handle.try_state::<watch::Watcher>() {
                let _ = watch::stop(state.inner());
            }
            let _ = session::stop();
        }
    });
}
