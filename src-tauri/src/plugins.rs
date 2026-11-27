//! Plugin files (SPEC.md Rust core module 3, with the file watcher): the plugins
//! folder, and serving plugin modules to the webview.
//!
//! Plugins live in `~/.config/tinkr/plugins/<name>/`. The webview reads their
//! `plugin.json` and watches the folder through the fs plugin, so `setup` adds
//! `~/.config/tinkr` (plugins plus Tinkr's `settings.json`) to the fs scope.
//!
//! A plugin's code is an ES module, which the webview loads with `import(url)`. It
//! can't import from disk directly, so this module serves the files over a custom URI
//! scheme:
//!
//!   tinkr-plugin://localhost/<plugin>/<version>/<path inside the plugin>
//!   (on Windows: http://tinkr-plugin.localhost/<plugin>/<version>/<path>)
//!
//! `<version>` is ignored when reading the file. The webview bumps it on every hot
//! reload, so the browser treats every file of the plugin as new; that also covers
//! files the entry imports with relative paths, which a query string on the entry
//! alone wouldn't.

use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};
use tauri_plugin_fs::FsExt;

/// `~/.config/tinkr`: plugins and settings. The same path on every OS (SPEC.md).
fn tinkr_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".config").join("tinkr"))
}

fn plugins_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(tinkr_dir(app)?.join("plugins"))
}

/// Called once at startup: make sure the plugins folder exists and let the webview
/// read and watch it (and write Tinkr's settings file next to it).
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let plugins = plugins_dir(app)?;
    fs::create_dir_all(&plugins).map_err(|e| format!("couldn't create {}: {e}", plugins.display()))?;
    let dir = tinkr_dir(app)?;
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| format!("couldn't allow access to {}: {e}", dir.display()))
}

/// JS: `invoke('plugins_dir')`. Where plugins are installed.
#[tauri::command]
pub fn plugins_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(plugins_dir(&app)?.to_string_lossy().into_owned())
}

/// Undo URL escaping (`%20` -> space) in one path segment. Returns None for invalid
/// escapes or text that isn't UTF-8. Written out by hand to avoid a dependency.
fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            // `get` returns None instead of panicking if the escape is cut short.
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The file a request asks for, or None if the path is malformed or would leave the
/// plugins folder. Only plain names are accepted as segments: no `..`, no `.`, no
/// drive letters or roots, so the result is always under `root`.
fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    // "/<plugin>/<version>/<rest...>": skip the empty piece before the first slash.
    let mut segments = url_path.split('/').skip(1);
    let plugin = percent_decode(segments.next()?)?;
    let _version = segments.next()?; // only there to make the URL new on each reload
    let mut path = root.join(plugin_name(&plugin)?);
    let mut any = false;
    for raw in segments {
        let segment = percent_decode(raw)?;
        // `Path::components` classifies a segment; only `Normal` (a plain name) is safe.
        let mut parts = Path::new(&segment).components();
        match (parts.next(), parts.next()) {
            (Some(Component::Normal(name)), None) => path.push(name),
            _ => return None,
        }
        any = true;
    }
    if any { Some(path) } else { None }
}

/// Plugin folder names: letters, digits, `-`, `_`, `.` (not starting with a dot).
fn plugin_name(name: &str) -> Option<&str> {
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok { Some(name) } else { None }
}

fn content_type(path: &Path) -> &'static str {
    // `and_then` + `to_str` turn the OsStr extension into a &str (None if not UTF-8).
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("html") => "text/html; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The handler Tauri calls for each `tinkr-plugin` request. It returns the file's
/// bytes, or a 404/400. Never a panic: a bad request must not crash the app.
pub fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let respond = |status: StatusCode, mime: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header("Content-Type", mime)
            // The app page and this scheme are different origins; module imports need CORS.
            .header("Access-Control-Allow-Origin", "*")
            // Hot reload relies on fresh files: never cache.
            .header("Cache-Control", "no-store")
            .body(body)
            // `builder().body()` only fails on invalid header values, which these aren't.
            .unwrap_or_default()
    };
    let not_found = || respond(StatusCode::NOT_FOUND, "text/plain", b"not found".to_vec());

    let Ok(root) = plugins_dir(ctx.app_handle()) else { return not_found() };
    let Some(path) = resolve(&root, request.uri().path()) else {
        return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad plugin path".to_vec());
    };
    match fs::read(&path) {
        Ok(bytes) => respond(StatusCode::OK, content_type(&path), bytes),
        Err(_) => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_plain_paths_and_skips_the_version() {
        let root = Path::new("/plugins");
        assert_eq!(resolve(root, "/notes/3/index.js"), Some(root.join("notes").join("index.js")));
        assert_eq!(resolve(root, "/notes/3/lib/a%20b.js"), Some(root.join("notes").join("lib").join("a b.js")));
    }

    #[test]
    fn refuses_anything_that_could_leave_the_folder() {
        let root = Path::new("/plugins");
        assert_eq!(resolve(root, "/notes/1/../secret.txt"), None);
        assert_eq!(resolve(root, "/notes/1/%2e%2e/secret.txt"), None);
        assert_eq!(resolve(root, "/../1/x.js"), None);
        assert_eq!(resolve(root, "/.hidden/1/x.js"), None);
        assert_eq!(resolve(root, "/notes/1/a%2F..%2F..%2Fx"), None); // an escaped slash is one bad segment
        // On Windows `C:\` is a drive (elsewhere it's an odd but harmless file name).
        #[cfg(windows)]
        assert_eq!(resolve(root, "/notes/1/C:%5Cwin.ini"), None);
        assert_eq!(resolve(root, "/notes/1/"), None);
        assert_eq!(resolve(root, "/notes"), None);
    }
}
