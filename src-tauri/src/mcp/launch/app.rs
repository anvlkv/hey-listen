//! Where the app is, and how to start it.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::APP_BIN;

/// How to start the app: the executable, plus the macOS bundle to open instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppTarget {
    exe: PathBuf,
    /// macOS: start through LaunchServices rather than spawning the executable.
    #[cfg(target_os = "macos")]
    bundle: Option<PathBuf>,
}

impl AppTarget {
    /// The app at `exe`; `open_bundle` asks macOS to start its bundle when there is one.
    pub(super) fn new(exe: PathBuf, open_bundle: bool) -> Self {
        #[cfg(target_os = "macos")]
        let bundle = if open_bundle { bundle_of(&exe) } else { None };
        #[cfg(not(target_os = "macos"))]
        let _ = open_bundle;
        Self {
            exe,
            #[cfg(target_os = "macos")]
            bundle,
        }
    }

    /// The app executable — the identity a recorded advertisement must match.
    pub fn exe(&self) -> &Path {
        &self.exe
    }

    /// The app a helper should start, when it can find one.
    pub(super) fn locate(helper: &Path) -> Option<Self> {
        Self::locate_in(helper, &installed_roots())
    }

    /// [`Self::locate`] with an explicit search path: tests pass none, so the result does
    /// not depend on which app happens to be installed on the machine.
    pub(super) fn locate_in(helper: &Path, roots: &[PathBuf]) -> Option<Self> {
        candidates(helper, roots)
            .into_iter()
            .find(|path| path.is_file())
            .map(|exe| Self::new(exe, true))
    }
}

/// Where to look for the app, nearest first.
fn candidates(helper: &Path, roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(dir) = helper.parent() {
        // Beside the helper: the dev `target/debug|release/` pair, and a helper that
        // ships inside a bundle's `Contents/MacOS/`.
        found.push(dir.join(app_name()));
    }
    // `roots` are `.app` bundles (macOS only), so their executable is in `Contents/MacOS`.
    for root in roots {
        found.push(root.join("Contents/MacOS").join(app_name()));
    }
    found
}

/// An installed app bundle, for a helper that sits apart from it.
fn installed_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut roots = vec![PathBuf::from("/Applications/Hey Listen.app")];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Applications/Hey Listen.app"));
        }
        roots
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// The app's file name on this platform.
fn app_name() -> &'static str {
    if cfg!(windows) {
        "hey-listen.exe"
    } else {
        APP_BIN
    }
}

/// macOS: the `.app` bundle `exe` belongs to (`<…>/X.app/Contents/MacOS/<exe>`).
#[cfg(target_os = "macos")]
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|ancestor| ancestor.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

/// Start the app, detached.
///
/// The child's stdio is `null` on purpose: this process's stdout is the MCP client's
/// protocol stream, and the app must never write into it.
pub(super) fn spawn(target: &AppTarget) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = match &target.bundle {
        Some(bundle) => {
            let mut command = Command::new("open");
            command.arg(bundle);
            command
        }
        None => Command::new(&target.exe),
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = Command::new(&target.exe);

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn()?;
    // Reap in the background — the child is the app (or `open`, which exits at once) —
    // and never wait for it: the bridge must outlive the launch.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
