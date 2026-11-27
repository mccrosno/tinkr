mod config;
mod plugins;
mod pty;
mod sidecar;

use tauri::RunEvent;

/// Linux only: avoid WebKitGTK's slow path for themes with blur (SPEC.md "Spike findings",
/// spike 4). Where WebKitGTK can't use DMA-BUF for drawing (no GPU render device, or
/// WSL), blur fell to ~25 fps; `WEBKIT_DISABLE_DMABUF_RENDERER=1` brought it back to 60.
/// It must be set before the webview starts. A value the user set is left alone.
#[cfg(target_os = "linux")]
fn prefer_working_webkit_renderer() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VAR).is_some() {
        return;
    }
    // A render node is how a GPU is offered to programs; none means software drawing.
    let has_render_node = std::fs::read_dir("/dev/dri")
        .map(|entries| {
            // `flatten` skips entries that couldn't be read; `any` stops at the first match.
            entries.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD"))
        })
        .unwrap_or(false);
    // WSL's kernel says "microsoft" in its version string.
    let wsl = std::fs::read_to_string("/proc/version")
        .map(|v| v.to_lowercase().contains("microsoft"))
        .unwrap_or(false);
    if !has_render_node || wsl {
        // SAFETY: called first thing in `run`, before any other thread exists, so nothing
        // can be reading the environment at the same time (Rust 2024 marks this unsafe).
        unsafe { std::env::set_var(VAR, "1") };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    prefer_working_webkit_renderer();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // File access for the webview, limited to folders opened with `open_project`
        // (see capabilities/default.json for which fs commands are allowed). The
        // "watch" feature lets the UI notice changes on disk.
        .plugin(tauri_plugin_fs::init())
        // Native "Open folder" dialog.
        .plugin(tauri_plugin_dialog::init())
        // Plugin code, served to the webview from ~/.config/tinkr/plugins (see plugins.rs).
        .register_uri_scheme_protocol("tinkr-plugin", plugins::serve)
        // Register the shared state before anything can use it.
        .manage(sidecar::SidecarState::default())
        .manage(pty::PtyState::default())
        .setup(|app| {
            // Start the sidecar when the app launches. A failure is logged rather than
            // fatal, so the UI can still open and offer a restart.
            if let Err(e) = sidecar::start(app.handle()) {
                eprintln!("[tinkr] {e}");
            }
            // The plugins folder, and access to it for the webview. Without it Tinkr
            // still runs, with only its built-in panels.
            if let Err(e) = plugins::setup(app.handle()) {
                eprintln!("[tinkr] {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_send,
            sidecar::sidecar_pid,
            sidecar::sidecar_restart,
            config::get_config,
            config::open_project,
            config::close_project,
            plugins::plugins_dir_path,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // `run` takes a callback for app lifecycle events. On exit, kill the sidecar
        // and any terminal shells so they don't outlive the window.
        .run(|app, event| {
            if let RunEvent::Exit = event {
                sidecar::stop(app);
                pty::stop_all(app);
            }
        });
}
