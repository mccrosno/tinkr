//! Running a program for a plugin and returning what it printed (SPEC.md Rust core
//! module 5, host API): `api.programs.run('gh', ['api', 'user'])` ends up here.
//!
//! Unlike the terminal (pty.rs), there's no shell and no screen: the program is started
//! directly with a list of arguments, so nothing in an argument is ever read as shell
//! syntax, and its output comes back as text. Which plugin may run which program is
//! decided in the webview (src/plugins/host.ts), like the other plugin permissions.

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The most kept of each of stdout and stderr.
const MAX_OUTPUT: usize = 10 * 1024 * 1024;
const MAX_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// What `run_program` returns to JS.
#[derive(Serialize)]
pub struct Finished {
    /// The exit code. `None` (null in JS) if the system ended the program without one.
    code: Option<i32>,
    stdout: String,
    stderr: String,
    /// True if either output was longer than `MAX_OUTPUT` and got cut off.
    truncated: bool,
}

/// `async` keeps the window responsive: Tauri runs async commands off the main thread.
/// Waiting for a program still blocks whichever thread does it, so the work goes to
/// `spawn_blocking`, a pool of threads that are allowed to block.
#[tauri::command]
pub async fn run_program(
    app: AppHandle,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    input: Option<String>,
    timeout_ms: u64,
) -> Result<Finished, String> {
    let cwd = match cwd {
        Some(dir) => PathBuf::from(dir),
        // `?` returns early with the error; `map_err` first turns it into a String.
        None => app.path().home_dir().map_err(|e| e.to_string())?,
    };
    let timeout = Duration::from_millis(timeout_ms).min(MAX_TIMEOUT);
    // `move` hands the closure ownership of these values, because it outlives this function's frame.
    tauri::async_runtime::spawn_blocking(move || run(&program, &args, &cwd, input, timeout))
        .await
        // The outer error means the thread itself failed; `?` passes it on, and what's
        // left is `run`'s own Result.
        .map_err(|e| e.to_string())?
}

/// A bare program name, to be found on PATH: "gh", not "C:\tools\gh.exe" or "./gh".
/// The user approves names, so a name mustn't be able to mean "that file over there".
fn is_program_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

fn run(
    program: &str,
    args: &[String],
    cwd: &Path,
    input: Option<String>,
    timeout: Duration,
) -> Result<Finished, String> {
    if !is_program_name(program) {
        return Err(format!(
            "\"{program}\" isn't a program name (use a bare name such as \"gh\", not a path)"
        ));
    }
    if !cwd.is_dir() {
        return Err(format!("{} isn't a folder", cwd.display()));
    }

    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        // With no input, the program sees an empty stdin, so it can't sit waiting for typing.
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Without CREATE_NO_WINDOW, Windows flashes a console window for each run.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command.spawn().map_err(|e| match e.kind() {
        ErrorKind::NotFound => {
            format!("couldn't find \"{program}\" (is it installed and on your PATH?)")
        }
        _ => format!("couldn't start {program}: {e}"),
    })?;

    // Input is written, and both outputs are read, on their own threads. A pipe only
    // holds so much: if we did these one after another, we could be stuck writing while
    // the program is stuck printing, each waiting for the other.
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        // Dropping `stdin` when the thread ends closes it, which tells the program "that's all".
        // A write error just means the program stopped reading, so it's ignored.
        thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    // `take` moves the pipe out of `child`, so the thread can own it.
    let stdout = Capture::start(child.stdout.take().expect("stdout is piped"));
    let stderr = Capture::start(child.stderr.take().expect("stderr is piped"));

    // The standard library can't "wait with a time limit", so check every few milliseconds.
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("lost track of {program}: {e}"))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait(); // lets the system forget the ended process
            return Err(format!(
                "{program} didn't finish within {} ms and was stopped",
                timeout.as_millis()
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };

    let (stdout, cut_out) = stdout.finish();
    let (stderr, cut_err) = stderr.finish();
    Ok(Finished {
        code: status.code(),
        stdout,
        stderr,
        truncated: cut_out || cut_err,
    })
}

/// One output pipe being read on its own thread.
struct Capture {
    /// The bytes so far, and whether some were dropped. `Arc` lets the reading thread and
    /// this one share it; `Mutex` lets only one of them touch it at a time.
    output: Arc<Mutex<(Vec<u8>, bool)>>,
    /// Receives a message when the pipe is closed.
    done: mpsc::Receiver<()>,
}

impl Capture {
    fn start(mut pipe: impl Read + Send + 'static) -> Self {
        let output = Arc::new(Mutex::new((Vec::new(), false)));
        let shared = Arc::clone(&output); // a second handle to the same data, not a copy
        let (finished, done) = mpsc::channel();
        thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break, // closed
                    Ok(n) => {
                        // `unwrap`: locking only fails if a thread panicked while holding it.
                        let mut guard = shared.lock().unwrap();
                        let keep = n.min(MAX_OUTPUT - guard.0.len());
                        guard.0.extend_from_slice(&chunk[..keep]);
                        // Past the limit, keep reading (and dropping) so the program can finish.
                        guard.1 |= keep < n;
                    }
                }
            }
            let _ = finished.send(());
        });
        Capture { output, done }
    }

    /// The text, once the program has ended. A program can leave a background process
    /// holding the pipe open, so don't wait for it to close for more than a second.
    fn finish(self) -> (String, bool) {
        let _ = self.done.recv_timeout(Duration::from_secs(1));
        let guard = self.output.lock().unwrap();
        // "Lossy": bytes that aren't valid UTF-8 become the � character instead of an error.
        (String::from_utf8_lossy(&guard.0).into_owned(), guard.1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run a line in the platform's shell, only to have a program every test machine has.
    fn shell(line: &str, input: Option<&str>, timeout: Duration) -> Result<Finished, String> {
        let (program, flag) = if cfg!(windows) {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };
        let args = [flag.to_string(), line.to_string()];
        run(
            program,
            &args,
            &std::env::temp_dir(),
            input.map(String::from),
            timeout,
        )
    }

    const LONG: Duration = Duration::from_secs(20);

    #[test]
    fn returns_output_and_exit_code() {
        let r = shell("echo out&& echo err 1>&2&& exit 3", None, LONG).unwrap();
        assert_eq!(r.code, Some(3));
        assert_eq!(r.stdout.trim(), "out");
        assert_eq!(r.stderr.trim(), "err");
        assert!(!r.truncated);
    }

    #[test]
    fn passes_input_to_the_program() {
        // `sort` reads all of stdin and prints it back (one line is already sorted).
        let r = shell("sort", Some("hello\n"), LONG).unwrap();
        assert_eq!(r.stdout.trim(), "hello");
    }

    #[test]
    fn stops_a_program_that_takes_too_long() {
        let sleep = if cfg!(windows) {
            "ping -n 6 127.0.0.1"
        } else {
            "sleep 5"
        };
        let started = Instant::now();
        let error = shell(sleep, None, Duration::from_millis(200))
            .err()
            .unwrap();
        assert!(error.contains("didn't finish"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn refuses_paths_and_reports_missing_programs() {
        let here = std::env::temp_dir();
        for name in ["", "./gh", "..", "C:\\gh.exe", "/bin/sh", "a b"] {
            let error = run(name, &[], &here, None, LONG).err().unwrap();
            assert!(error.contains("isn't a program name"), "{name}: {error}");
        }
        let error = run("tinkr-no-such-program", &[], &here, None, LONG)
            .err()
            .unwrap();
        assert!(error.contains("couldn't find"), "{error}");
        let error = run("cargo", &[], &here.join("tinkr-no-such-folder"), None, LONG)
            .err()
            .unwrap();
        assert!(error.contains("isn't a folder"), "{error}");
    }
}
