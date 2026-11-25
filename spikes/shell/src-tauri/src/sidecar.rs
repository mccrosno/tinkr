//! Sidecar manager (SPEC.md Rust module 2): start the agent sidecar, relay its
//! output to the webview, write the webview's requests to its stdin, restart it.
//!
//! Rust stays a dumb pipe here. It never parses the JSON protocol: each stdout line
//! is forwarded as a string, and the TypeScript side owns the message types.
//!
//! Events sent to the webview:
//!   "sidecar://line"  payload: one stdout line (a JSON string, unparsed)
//!   "sidecar://log"   payload: one stderr line (human-readable logs)
//!   "sidecar://exit"  payload: the process id that exited

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

/// A running sidecar: the process handle (to kill it) and its stdin (to write to it).
struct Running {
    child: Child,
    stdin: ChildStdin,
}

/// Shared app state. Tauri keeps one instance and hands it to commands.
///
/// `Mutex` because commands can run on different threads at once; only one thread
/// may touch the sidecar at a time. `Option` because there may be no sidecar
/// (not started yet, or it failed to start).
#[derive(Default)]
pub struct SidecarState(Mutex<Option<Running>>);

/// Windows only: make sure the sidecar dies with the app, even if the app crashes.
///
/// A Job Object groups processes. With "kill on job close", Windows kills every
/// process in the job when the job's last handle closes, and the OS closes our
/// handle when Tinkr exits for any reason (including a crash). Children of the
/// sidecar (the Claude CLI) join the job automatically.
#[cfg(windows)]
fn add_to_kill_on_exit_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use win32job::{ExtendedLimitInfo, Job};

    // `OnceLock` runs the closure once, the first time, and stores the result for the
    // rest of the program. `static` means it lives as long as the process, so the job
    // handle is never closed early. Holding an Option means "creating it failed".
    static JOB: OnceLock<Option<Job>> = OnceLock::new();
    let job = JOB.get_or_init(|| {
        let mut info = ExtendedLimitInfo::new();
        info.limit_kill_on_job_close();
        Job::create_with_limit_info(&info)
            .map_err(|e| eprintln!("[tinkr] could not create job object: {e:?}"))
            .ok() // Result -> Option, dropping the (already logged) error
    });
    if let Some(job) = job {
        // `as_raw_handle()` borrows the OS handle as a pointer; the crate wants it as isize.
        if let Err(e) = job.assign_process(child.as_raw_handle() as isize) {
            eprintln!("[tinkr] could not add sidecar to job object: {e:?}");
        }
    }
}

/// Build the command that launches the sidecar.
///
/// Spike: always run the TypeScript source through `bun` (found on PATH). The signed
/// `bun.exe` passes Windows Smart App Control, which blocks unsigned Bun-compiled exes.
/// A release build would point at a bundled, signed binary instead.
fn sidecar_command() -> Command {
    // `env!` reads CARGO_MANIFEST_DIR (this crate's folder) at compile time, and
    // `concat!` joins string literals, so this is a fixed path baked into the binary.
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../sidecar/slim.ts");

    let mut cmd = Command::new("bun");
    cmd.arg(script);

    // On Windows a GUI app that starts a console program pops up a console window.
    // CREATE_NO_WINDOW (0x08000000) suppresses it. `#[cfg(windows)]` means this
    // block is only compiled on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Start the sidecar, killing any previous one first. Used at startup and by restart.
///
/// Returns `Result<u32, String>`: the new process id, or an error message. Tauri sends
/// a command's `Err(String)` to JS as a rejected promise, so plain strings are enough.
pub fn start(app: &AppHandle) -> Result<u32, String> {
    let state = app.state::<SidecarState>();
    // `lock()` waits for the mutex. It only fails if another thread panicked while
    // holding it; `map_err` turns that error into a String, and `?` returns early
    // with it.
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // `take()` moves the old value out of the Option, leaving None in its place.
    if let Some(mut old) = guard.take() {
        let _ = old.child.kill(); // `let _ =` ignores the result: it may already be dead
        let _ = old.child.wait(); // reap it so it doesn't linger as a zombie
    }

    let mut child = sidecar_command()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start sidecar (is bun on PATH?): {e}"))?;

    #[cfg(windows)]
    add_to_kill_on_exit_job(&child);

    // The pipes start inside `child`. `take()` moves each one out so a reader thread
    // can own it. Each is Some right after spawn, so these errors can't really happen.
    let stdin = child.stdin.take().ok_or("sidecar has no stdin")?;
    let stdout = child.stdout.take().ok_or("sidecar has no stdout")?;
    let stderr = child.stderr.take().ok_or("sidecar has no stderr")?;
    let pid = child.id();

    // One thread per output pipe, each blocking on reads. `move` hands the thread
    // ownership of what it uses (the pipe and its own AppHandle clone; AppHandle is
    // cheap to clone).
    let app_out = app.clone();
    thread::spawn(move || {
        // `lines()` yields one line at a time and ends when the process closes stdout.
        // `map_while(Result::ok)` stops at the first read error.
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app_out.emit("sidecar://line", line);
        }
        // stdout closed means the sidecar exited (or crashed). The pid lets the UI
        // ignore exit events from a process that was already replaced.
        let _ = app_out.emit("sidecar://exit", pid);
    });

    let app_err = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit("sidecar://log", line);
        }
    });

    *guard = Some(Running { child, stdin });
    Ok(pid)
}

/// Kill the sidecar. Called when the app exits.
pub fn stop(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut running) = guard.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

/// JS: `invoke('sidecar_send', { line })`. Writes one request line to the sidecar.
///
/// `State<'_, SidecarState>` asks Tauri for the managed state. The `'_` lifetime
/// just says "borrowed for the duration of this call".
#[tauri::command]
pub fn sidecar_send(line: String, state: State<'_, SidecarState>) -> Result<(), String> {
    // A newline inside the payload would split it into two protocol messages.
    if line.contains('\n') {
        return Err("a request must be a single line of JSON".into());
    }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let running = guard.as_mut().ok_or("sidecar is not running")?;
    writeln!(running.stdin, "{line}").map_err(|e| e.to_string())?;
    running.stdin.flush().map_err(|e| e.to_string())
}

/// JS: `invoke('sidecar_restart')`. Kills and restarts the sidecar, returns the new pid.
#[tauri::command]
pub fn sidecar_restart(app: AppHandle) -> Result<u32, String> {
    start(&app)
}
