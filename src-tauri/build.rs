use std::path::Path;
use std::process::Command;

/// The git command's trimmed stdout, or `None` when git is unavailable or the command
/// failed (a source tarball has no `.git`, and a CI checkout may be shallow).
fn git(args: &[&str], cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Embed the identity of the checkout this build came from (the About window shows it).
///
/// The commit is resolved at build time, not runtime: a shipped binary keeps the commit
/// it was compiled from even when the file is copied elsewhere. `HEYLISTEN_BUILD_COMMIT`
/// and `HEYLISTEN_BUILD_DIRTY` let a packager override the git lookup (a source tarball
/// or a CI job without `.git`).
fn embed_build_identity() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = git(&["rev-parse", "--show-toplevel"], manifest)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| manifest.to_path_buf());

    let commit = std::env::var("HEYLISTEN_BUILD_COMMIT")
        .ok()
        .or_else(|| git(&["rev-parse", "--short=12", "HEAD"], &root))
        .or_else(|| {
            std::env::var("GITHUB_SHA")
                .ok()
                .map(|sha| sha.chars().take(12).collect())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let dirty = std::env::var("HEYLISTEN_BUILD_DIRTY")
        .ok()
        .unwrap_or_else(|| match git(&["status", "--porcelain"], &root) {
            Some(status) => (!status.is_empty()).to_string(),
            None => "false".to_string(),
        });

    println!("cargo:rustc-env=HEYLISTEN_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=HEYLISTEN_BUILD_DIRTY={dirty}");
    println!(
        "cargo:rustc-env=HEYLISTEN_BUILD_PROFILE={}",
        std::env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string())
    );
    println!(
        "cargo:rustc-env=HEYLISTEN_BUILD_TARGET={}",
        std::env::var("TARGET").unwrap_or_else(|_| "unknown".to_string())
    );

    // Re-run when the checked-out commit or any build input changes, so a rebuild cannot
    // keep a stale hash or dirty marker. Explicit `rerun-if-changed` turns off Cargo's
    // default "any package file" behaviour, so the relevant trees are listed too.
    for path in [
        ".git/HEAD",
        ".git/refs/heads",
        ".git/packed-refs",
        "src",
        "package.json",
        "src-tauri/src",
        "src-tauri/Cargo.toml",
        "src-tauri/tauri.conf.json",
    ] {
        let path = root.join(path);
        if path.exists() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    println!("cargo:rerun-if-env-changed=HEYLISTEN_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=HEYLISTEN_BUILD_DIRTY");
}

fn main() {
    // The target triple names the staged sidecar (`binaries/hey-listen-cli-<triple>`, see
    // `scripts/prepareSidecar.mjs`). Embedding it lets the CLI installer find that file in
    // a dev checkout, where the bundle layout does not exist yet (M33.C).
    println!(
        "cargo:rustc-env=HEY_LISTEN_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    embed_build_identity();
    tauri_build::build()
}
