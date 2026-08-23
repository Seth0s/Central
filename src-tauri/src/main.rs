// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apply_linux_webview_workarounds();
    centralbyte_lib::run()
}

/// WebKitGTK + NVIDIA + Wayland otherwise dies with:
/// `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.`
/// `__NV_DISABLE_EXPLICIT_SYNC` keeps GPU compositing; set it first.
/// `WEBKIT_DISABLE_DMABUF_RENDERER` is the fallback WebKit honors after `main`.
/// See https://v2.tauri.app/develop/debug/linux-graphics/ and tauri-apps/tauri#9394.
fn apply_linux_webview_workarounds() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}
