mod sidecar;

use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Register the shared state before anything can use it.
        .manage(sidecar::SidecarState::default())
        .setup(|app| {
            // Start the sidecar when the app launches. A failure is logged rather than
            // fatal, so the UI can still open and offer a restart.
            if let Err(e) = sidecar::start(app.handle()) {
                eprintln!("[tinkr] {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_send,
            sidecar::sidecar_restart
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // `run` takes a callback for app lifecycle events. On exit, kill the sidecar
        // so it doesn't outlive the window.
        .run(|app, event| {
            if let RunEvent::Exit = event {
                sidecar::stop(app);
            }
        });
}
