//! PTY (SPEC.md Rust core module 4): run shells in pseudo-terminals for the
//! terminal panel.
//!
//! A pseudo-terminal (PTY) makes a program believe it is talking to a real terminal
//! window, so shells show prompts, colors and line editing. `portable-pty` wraps the
//! platform versions (ConPTY on Windows, openpty on Linux/macOS).
//!
//! Like the sidecar manager, Rust is a pipe here: bytes from the webview go to the
//! shell, bytes from the shell go back to the webview, and xterm.js does all the
//! terminal emulation. Each terminal gets its own `Channel` (a per-call stream from
//! Rust to JS). It carries:
//!   - output as raw bytes (an `ArrayBuffer` in JS; xterm.js decodes the UTF-8, even
//!     when a character is split across two reads), then
//!   - one final JSON message `{ "exitCode": n }` when the shell exits.
//!
//! A channel delivers its messages in order, so the exit message always comes after
//! the last output.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

/// One open terminal. These are the parts the commands need; the child process
/// itself is owned by the thread that waits for it to exit (see `pty_spawn`).
///
/// `Box<dyn Trait>` is a value of some type that implements the trait, decided at
/// runtime (portable-pty returns a different type on each platform).
struct Session {
    /// The terminal side of the PTY. Needed to resize, and dropping it closes the PTY.
    master: Box<dyn MasterPty + Send>,
    /// Writes keystrokes to the shell.
    writer: Box<dyn Write + Send>,
    /// Kills the shell. Separate from the child so we can kill it while another
    /// thread is blocked waiting on it.
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Shared state: open terminals by id. `Mutex` because commands run on several
/// threads; `HashMap` because many terminals can be open at once.
#[derive(Default)]
pub struct PtyState(Mutex<HashMap<u32, Session>>);

/// Hands out terminal ids. An atomic integer can be incremented from any thread
/// without a lock.
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// What `pty_spawn` returns to JS. `rename_all` turns `shell_name` into `shellName`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spawned {
    id: u32,
    /// The shell's process id (the e2e test uses it to check the process is gone).
    pid: Option<u32>,
    /// A short label for the tab, e.g. "pwsh" or "zsh".
    shell_name: String,
}

/// Find `exe` in one of the PATH folders. Returns the full path if it's there.
#[cfg(windows)]
fn find_on_path(exe: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?; // `?` on an Option: return None if PATH is unset
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

/// The shell to start, and its arguments.
///
/// - Windows: PowerShell 7 (`pwsh`) if it's installed, otherwise the Windows
///   PowerShell that ships with Windows. `-NoLogo` skips the banner.
/// - Linux/macOS: the user's login shell from `$SHELL`, falling back to `/bin/sh`.
///   On macOS it runs as a login shell (`-l`), like Terminal.app does, because apps
///   started from the Dock get a minimal PATH and the login profile fixes that.
fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        let program = find_on_path("pwsh.exe").map_or_else(|| "powershell.exe".into(), |p| p.into_os_string());
        let mut cmd = CommandBuilder::new(program);
        cmd.arg("-NoLogo");
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = CommandBuilder::new(shell);
        if cfg!(target_os = "macos") {
            cmd.arg("-l");
        }
        cmd
    }
}

/// JS: `invoke('pty_spawn', { cwd, cols, rows, onEvent })`. Starts a shell in `cwd`
/// sized `cols` x `rows` characters, and streams its output to `on_event`.
///
/// Tauri converts the JS `onEvent` argument (a `Channel` object) into `on_event`.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
) -> Result<Spawned, String> {
    if !Path::new(&cwd).is_dir() {
        return Err(format!("not a folder: {cwd}"));
    }

    // Open a PTY pair. `master` is our end; `slave` is the end the shell attaches to.
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("couldn't open a terminal: {e}"))?;

    let mut cmd = default_shell();
    cmd.cwd(&cwd);
    // Tell programs what kind of terminal they're in, so they use colors.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "tinkr");
    let shell_name = Path::new(cmd.get_argv()[0].as_os_str())
        .file_stem() // "C:\...\pwsh.exe" -> "pwsh"
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "shell".into());

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("couldn't start the shell: {e}"))?;
    // The shell holds its own copy of the slave end. Dropping ours means the PTY
    // closes (and our reader sees end-of-file) once the shell exits; otherwise our
    // copy would keep it open forever on Linux/macOS.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let pid = child.process_id();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    // Store the session before starting the threads, so a fast-exiting shell can't
    // try to remove it before it's there.
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    sessions.insert(id, Session { master: pair.master, writer, killer });
    drop(sessions); // unlock now rather than at the end of the function

    // Reader thread: copy output to the webview until the PTY closes.
    // `move` gives the thread ownership of `reader` and a clone of the channel.
    let output = on_event.clone();
    let reader_thread = thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                // 0 bytes = end of file: the PTY closed. An error also ends it.
                Ok(0) | Err(_) => break,
                // Send only the bytes that were read (`buf[..n]`), as a new Vec.
                Ok(n) => {
                    if output.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break; // the webview went away
                    }
                }
            }
        }
    });

    // Waiter thread: owns the child and blocks until the shell exits (by itself, or
    // because `pty_kill` killed it). Then it cleans up and tells the webview.
    thread::spawn(move || {
        // `wait()` returns an io::Result; if waiting itself fails, report code 1.
        let exit_code = child.wait().map(|status| status.exit_code()).unwrap_or(1);
        // Remove the session. Dropping it closes the PTY, which matters on Windows:
        // ConPTY keeps the output pipe open until the pseudo console is closed, so
        // without this the reader thread would never finish.
        // The lock guard is a temporary that is released at the end of this statement,
        // so the (possibly slow) close in `drop` below happens without holding the lock.
        let session = app.state::<PtyState>().0.lock().ok().and_then(|mut s| s.remove(&id));
        drop(session);
        // Wait for the reader to forward the last output, then send the exit.
        let _ = reader_thread.join();
        let _ = on_event.send(InvokeResponseBody::Json(format!(r#"{{"exitCode":{exit_code}}}"#)));
    });

    Ok(Spawned { id, pid, shell_name })
}

/// JS: `invoke('pty_write', { id, data })`. Sends keystrokes (or pasted text) to the shell.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    // `get_mut` borrows the session mutably (writing needs `&mut`).
    let session = sessions.get_mut(&id).ok_or("terminal is closed")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

/// JS: `invoke('pty_resize', { id, cols, rows })`. Called when the panel changes size,
/// so full-screen programs (vim, htop, less) redraw at the right size.
#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("terminal is closed")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// JS: `invoke('pty_kill', { id })`. Kills the shell. The waiter thread then cleans up
/// and sends the exit message, so this returns right away.
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    // Already gone (it exited on its own) is fine: there's nothing to kill.
    if let Some(session) = sessions.get_mut(&id) {
        let _ = session.killer.kill(); // may fail if it's exiting right now; that's fine too
    }
    Ok(())
}

/// Kill every shell. Called when the app exits so none outlive it.
pub fn stop_all(app: &AppHandle) {
    if let Ok(mut sessions) = app.state::<PtyState>().0.lock() {
        // `drain()` empties the map and hands us each session by value.
        for (_, mut session) in sessions.drain() {
            let _ = session.killer.kill();
        }
    }
}
