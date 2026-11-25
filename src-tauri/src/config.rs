//! Window and config (SPEC.md Rust core module 1): Tinkr's settings file and
//! opening a project folder.
//!
//! The webview reads and writes files through Tauri's fs plugin, which only allows
//! paths inside its *scope*. Opening a project adds that folder to the scope, so the
//! UI can reach the folder the user chose and nothing else.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const MAX_RECENT: usize = 10;

/// Saved to `<app config dir>/config.json`.
///
/// `#[derive(...)]` asks the compiler to generate code: `Serialize`/`Deserialize`
/// (from serde) convert to and from JSON; `Default` gives an empty config.
/// `rename_all = "camelCase"` makes `last_project` appear as `lastProject` in JSON/JS.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub last_project: Option<String>,
    pub recent_projects: Vec<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

/// Read the config, falling back to defaults if the file is missing or unreadable.
pub fn load(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok()) // Option chain: any None -> default below
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// JS: `invoke('get_config')`. Folders that no longer exist are left out.
#[tauri::command]
pub fn get_config(app: AppHandle) -> Config {
    let mut config = load(&app);
    // `retain` keeps only the items for which the closure returns true.
    config.recent_projects.retain(|p| Path::new(p).is_dir());
    // `take_if` empties the Option when the closure returns true (here: folder is gone).
    config.last_project.take_if(|p| !Path::new(p).is_dir());
    config
}

/// JS: `invoke('open_project', { path })`. Lets the webview access `path` (recursively)
/// and remembers it as the last and most recent project. Returns the path.
#[tauri::command]
pub fn open_project(app: AppHandle, path: String) -> Result<String, String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    // `true` = recursive: every file and subfolder becomes accessible.
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| format!("couldn't allow access to {path}: {e}"))?;

    let mut config = load(&app);
    config.last_project = Some(path.clone());
    // Move this project to the front of the recent list, without duplicates.
    config.recent_projects.retain(|p| p != &path);
    config.recent_projects.insert(0, path.clone());
    config.recent_projects.truncate(MAX_RECENT);
    save(&app, &config)?;
    Ok(path)
}

/// JS: `invoke('close_project')`. Forgets the last project (it stays in the recent list).
#[tauri::command]
pub fn close_project(app: AppHandle) -> Result<(), String> {
    let mut config = load(&app);
    config.last_project = None;
    save(&app, &config)
}
