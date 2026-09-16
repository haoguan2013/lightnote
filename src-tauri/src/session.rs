//! 系统会话锁屏联动（Windows）
//!
//! 目标：**Win+L（以及屏保锁定、远程会话断开等）锁屏时，自动锁定笔记**——锁屏后不把已解锁的
//! 明文留在内存里。密钥（`vaultKey`）与明文只存在于前端，所以这里只负责「发现锁屏」，
//! 真正的 `lockApp()`（清空密钥与内存笔记、回到 PIN 锁屏）由前端调用。
//!
//! 实现（**零新依赖**，只声明系统 DLL 的导入项）：
//! - `WTSRegisterSessionNotification`（wtsapi32）把主窗口登记为会话通知接收者；
//! - 子类化主窗口过程（`SetWindowLongPtrW` / `CallWindowProcW`）截获 `WM_WTSSESSION_CHANGE`，
//!   只关心 `WTS_SESSION_LOCK`(0x7) / `WTS_SESSION_UNLOCK`(0x8)，其余消息原样转发；
//! - 窗口过程里**只做原子计数**（不加锁、不碰 UI、不做 I/O），前端定时轮询 `session_poll`
//!   取「累计锁屏次数」，一旦发现新事件立即 `lockApp()`。
//!
//! 为什么用会话通知而不是「轮询输入桌面」：`OpenInputDesktop` 那一类探测在 **UAC 安全桌面**
//! 上同样会判定为「已锁定」，会把正常弹 UAC 的动作误当成锁屏；而会话通知只在真正锁屏/解锁时到达。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

// ---------- 事件常量（WTS 的 wParam） ----------

/// `WM_WTSSESSION_CHANGE` 的 wParam：工作站已锁定
pub const WTS_SESSION_LOCK: usize = 0x7;
/// `WM_WTSSESSION_CHANGE` 的 wParam：工作站已解锁
pub const WTS_SESSION_UNLOCK: usize = 0x8;

// ---------- 状态（进程级，前端通过 session_poll 读取） ----------

/// 当前是否处于「已锁屏」状态（仅作状态展示，前端以计数为准）
static LOCKED: AtomicBool = AtomicBool::new(false);
/// 累计收到的锁屏次数——前端只比较「有没有比上次多」，因此即使锁屏期间前端没来得及轮询、
/// 或锁屏后很快又解锁，这个事件也不会丢。
static LOCK_COUNT: AtomicU64 = AtomicU64::new(0);
/// 会话通知是否登记成功（false 时前端不会收到任何锁屏事件；非 Windows 平台恒为 false）
static REGISTERED: AtomicBool = AtomicBool::new(false);

/// 读取当前状态：`(是否已锁屏, 累计锁屏次数)`
pub fn state() -> (bool, u64) {
    (LOCKED.load(Ordering::SeqCst), LOCK_COUNT.load(Ordering::SeqCst))
}

/// 会话通知是否已登记（主窗口子类化 + WTS 注册都成功）
pub fn registered() -> bool {
    REGISTERED.load(Ordering::SeqCst)
}

/// 处理一条会话状态变化（`WM_WTSSESSION_CHANGE` 的 wParam），返回它是否是一次「锁屏」。
///
/// 抽成这个纯状态函数是为了能直接单测：窗口过程本身依赖真实 Win32 消息，无法在测试里构造。
pub fn handle_session_change(wparam: usize) -> bool {
    if wparam == WTS_SESSION_LOCK {
        LOCKED.store(true, Ordering::SeqCst);
        LOCK_COUNT.fetch_add(1, Ordering::SeqCst);
        true
    } else if wparam == WTS_SESSION_UNLOCK {
        LOCKED.store(false, Ordering::SeqCst);
        false
    } else {
        false
    }
}

// ---------- Tauri 命令 ----------

/// 读取会话状态：`{ locked, lockCount, registered }`。
///
/// 前端在解锁期间每 `SESSION_POLL_MS` 调一次，`lockCount` 变大即表示期间发生过系统锁屏。
/// async：与其它命令保持一致（见 CLAUDE.md 开发注意事项 16），命令体只读原子变量。
#[tauri::command]
pub async fn session_poll() -> Result<serde_json::Value, String> {
    let (locked, count) = state();
    Ok(serde_json::json!({
        "locked": locked,
        "lockCount": count,
        "registered": registered()
    }))
}

// ---------- Windows 实现：登记会话通知 + 子类化窗口过程 ----------

#[cfg(windows)]
mod imp {
    use super::{handle_session_change, REGISTERED};
    use std::sync::atomic::{AtomicIsize, Ordering};

    /// 会话状态变化消息（wParam = WTS_SESSION_LOCK / WTS_SESSION_UNLOCK …）
    const WM_WTSSESSION_CHANGE: u32 = 0x02b1;
    /// 只接收本会话的通知
    const NOTIFY_FOR_THIS_SESSION: u32 = 0;
    /// `SetWindowLongPtrW` 的索引：替换窗口过程
    const GWLP_WNDPROC: i32 = -4;

    /// 窗口过程签名（`extern "system"` = WINAPI/stdcall）
    type WndProc = extern "system" fn(isize, u32, usize, isize) -> isize;

    #[link(name = "wtsapi32")]
    extern "system" {
        fn WTSRegisterSessionNotification(hwnd: isize, flags: u32) -> i32;
        fn WTSUnRegisterSessionNotification(hwnd: isize) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn CallWindowProcW(prev: isize, hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    // `SetWindowLongPtrW` 失败时要靠 GetLastError 区分（旧过程指针本身可能是 0）
    #[link(name = "kernel32")]
    extern "system" {
        fn SetLastError(code: u32);
        fn GetLastError() -> u32;
    }

    /// 子类化前的窗口过程（0 = 尚未子类化）
    static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);
    /// 已登记会话通知的窗口句柄（0 = 未登记）
    static HWND: AtomicIsize = AtomicIsize::new(0);

    /// 替换后的窗口过程：只截获会话状态变化并计数，其余消息一律转发给原窗口过程。
    ///
    /// 注意：这里跑在 **UI 线程**的消息派发路径上，因此只允许做极轻的原子操作。
    extern "system" fn session_wndproc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize {
        if msg == WM_WTSSESSION_CHANGE {
            handle_session_change(wparam);
        }
        let prev = PREV_WNDPROC.load(Ordering::SeqCst);
        if prev != 0 {
            unsafe { CallWindowProcW(prev, hwnd, msg, wparam, lparam) }
        } else {
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
    }

    pub fn start(hwnd: isize) -> Result<(), String> {
        if hwnd == 0 {
            return Err("窗口句柄无效".to_string());
        }
        // 已登记过（同一窗口）就直接返回；换了窗口则先解绑再登记
        if HWND.load(Ordering::SeqCst) == hwnd && REGISTERED.load(Ordering::SeqCst) {
            return Ok(());
        }
        let _ = stop();

        let new_proc = session_wndproc as WndProc;
        unsafe { SetLastError(0) };
        let prev = unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, new_proc as isize) };
        if prev == 0 {
            let err = unsafe { GetLastError() };
            if err != 0 {
                return Err(format!("子类化主窗口失败（错误码 {err}）"));
            }
            // 旧过程本来就是 0（理论上不会发生）——仍然继续，转发时会走 DefWindowProcW
        }
        PREV_WNDPROC.store(prev, Ordering::SeqCst);

        let ok = unsafe { WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) };
        if ok == 0 {
            // 登记失败就把窗口过程换回去，保持窗口行为与原来完全一致
            unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, prev) };
            PREV_WNDPROC.store(0, Ordering::SeqCst);
            return Err("登记会话通知失败（WTSRegisterSessionNotification）".to_string());
        }
        HWND.store(hwnd, Ordering::SeqCst);
        REGISTERED.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        let hwnd = HWND.swap(0, Ordering::SeqCst);
        let prev = PREV_WNDPROC.swap(0, Ordering::SeqCst);
        REGISTERED.store(false, Ordering::SeqCst);
        if hwnd == 0 {
            return Ok(());
        }
        unsafe { WTSUnRegisterSessionNotification(hwnd) };
        if prev != 0 {
            unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, prev) };
        }
        Ok(())
    }
}

/// 登记会话锁屏通知（`hwnd` 为主窗口句柄，由 lib.rs 从 `WebviewWindow::hwnd()` 取得）。
///
/// 幂等：重复调用只会更新一次；换窗口会先解绑旧的。
pub fn start(hwnd: isize) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::start(hwnd)
    }
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        Err("当前平台不支持系统锁屏事件".to_string())
    }
}

/// 解绑会话锁屏通知并还原窗口过程（应用退出时调用）。
pub fn stop() -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::stop()
    }
    #[cfg(not(windows))]
    {
        REGISTERED.store(false, Ordering::SeqCst);
        Ok(())
    }
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 这些用例都会改动进程级静态状态，必须串行执行（`cargo test` 默认多线程）
    static GUARD: Mutex<()> = Mutex::new(());

    #[test]
    fn lock_event_increases_count_and_marks_locked() {
        let _g = GUARD.lock().unwrap();
        let before = state().1;
        assert!(handle_session_change(WTS_SESSION_LOCK), "锁屏事件应返回 true");
        let (locked, count) = state();
        assert!(locked, "锁屏后状态应为已锁定");
        assert_eq!(count, before + 1);

        // 连续两次锁屏（例如解锁后又锁一次）必须累计两次，前端才不会漏事件
        assert!(handle_session_change(WTS_SESSION_LOCK));
        assert_eq!(state().1, before + 2);
    }

    #[test]
    fn unlock_clears_flag_without_touching_count() {
        let _g = GUARD.lock().unwrap();
        handle_session_change(WTS_SESSION_LOCK);
        let count_after_lock = state().1;

        assert!(!handle_session_change(WTS_SESSION_UNLOCK), "解锁事件不应算作锁屏");
        let (locked, count) = state();
        assert!(!locked, "解锁后状态应为未锁定");
        assert_eq!(count, count_after_lock, "解锁不得改动锁屏计数");
    }

    #[test]
    fn unrelated_session_events_are_ignored() {
        let _g = GUARD.lock().unwrap();
        handle_session_change(WTS_SESSION_LOCK);
        let (_, count_after_lock) = state();

        // 0x1 = WTS_CONSOLE_CONNECT，0x5 = WTS_REMOTE_CONNECT：都不是锁屏
        for other in [0x1usize, 0x2, 0x5, 0x6] {
            assert!(!handle_session_change(other), "非锁屏事件不得返回 true");
        }
        let (locked_after, count_after) = state();
        assert!(locked_after, "已锁屏状态不应被无关事件清除");
        assert_eq!(count_after, count_after_lock, "无关事件不得改动锁屏计数");
    }

    #[test]
    fn not_registered_before_start() {
        let _g = GUARD.lock().unwrap();
        // 测试进程从未调用 start()，因此登记状态必须是 false（前端据此判断事件是否可用）
        assert!(!registered());
    }
}
