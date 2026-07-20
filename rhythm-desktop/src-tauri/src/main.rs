#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

/// 喂给前端引擎的系统信号 DTO（与 src/lib/platform/context.ts 的 RustContextDto 对齐，snake_case）。
#[derive(Serialize, Default)]
struct ContextDto {
    /// 系统空闲秒数（键鼠无操作）
    idle_seconds: u64,
    /// 当前前台应用标识（进程名 / bundle 名），拿不到则为 None
    active_app: Option<String>,
    /// 是否检测到会议/投屏（M1 启发式：前台应用命中已知会议应用集）
    in_meeting: bool,
}

/// 已知会议 / 投屏应用关键字（小写匹配）。M1 用启发式，投屏 API 检测后续增强。
const MEETING_APPS: &[&str] = &[
    "zoom", "tmeet", "wemeet", "teams", "webex", "feishu", "lark", "dingtalk",
    "voovmeeting", "meeting", "classin", "slack", "discord",
];

/// 采集一次真实系统信号。任何子项失败都降级为默认值，保证命令不 panic。
#[tauri::command]
fn collect_context() -> ContextDto {
    let idle_seconds = system_idle_seconds();
    let active_app = foreground_app();
    let in_meeting = active_app
        .as_deref()
        .map(|a| {
            let lower = a.to_lowercase();
            MEETING_APPS.iter().any(|m| lower.contains(m))
        })
        .unwrap_or(false);

    ContextDto {
        idle_seconds,
        active_app,
        in_meeting,
    }
}

/// 跨平台系统空闲秒数。
fn system_idle_seconds() -> u64 {
    match user_idle::UserIdle::get_time() {
        Ok(t) => t.as_seconds(),
        Err(_) => 0,
    }
}

// ---------- 前台应用采集（分平台）----------

#[cfg(target_os = "windows")]
fn foreground_app() -> Option<String> {
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == std::ptr::null_mut() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid).ok()?;
        let mut buf = [0u16; MAX_PATH as usize];
        let len = GetModuleBaseNameW(handle, None, &mut buf);
        let _ = CloseHandle(handle);
        if len == 0 {
            return None;
        }
        let name = String::from_utf16_lossy(&buf[..len as usize]);
        Some(name)
    }
}

#[cfg(target_os = "macos")]
fn foreground_app() -> Option<String> {
    use objc2_app_kit::NSWorkspace;

    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let app = ws.frontmostApplication()?;
        let name = app.localizedName()?;
        Some(name.to_string())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn foreground_app() -> Option<String> {
    // Linux 等平台：M1 暂不采集前台应用（不影响空闲检测与提醒主流程）
    None
}

fn main() {
    tauri::Builder::default()
        // 系统能力适配层：托盘/菜单栏、通知、自启动、全局快捷键、SQLite
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // 间隔引擎核心（rhythm-core）是纯 TS，运行在前端；
        // 系统信号通过 collect_context 命令喂给前端，前端合并成 RuntimeContext 后交给引擎。
        .invoke_handler(tauri::generate_handler![collect_context])
        .run(tauri::generate_context!())
        .expect("error while running 节奏 Rhythm");
}
