mod config;
mod plugins;
mod pty;
mod sidecar;

use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
