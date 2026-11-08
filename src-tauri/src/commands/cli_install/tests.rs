//! Install / refresh / uninstall against a temp target directory, using a copy of the
//! real sidecar `npm run sidecar` stages. A bare checkout without that file skips these
//! tests (they compile either way; there is just nothing to copy).

use super::*;

/// The sidecar `npm run sidecar` stages; tests skip when a bare checkout has none.
fn staged_sidecar() -> Option<PathBuf> {
    let staged = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "{BINARY_NAME}-{}",
            env!("HEY_LISTEN_TARGET_TRIPLE")
        ));
    staged.is_file().then_some(staged)
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hey_listen_cli_{}_{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// Run `body` with the staged sidecar and a fresh target directory, or skip.
fn with_install(name: &str, f: impl FnOnce(&Path, &Path)) {
    let Some(sidecar) = staged_sidecar() else {
        return;
    };
    let dir = temp_dir(name);
    f(&sidecar, &dir);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn install_writes_the_binary_and_records_the_app_version() {
    with_install("install", |sidecar, dir| {
        let path = install(sidecar, dir).expect("install");
        assert!(path.is_file());

        let written = fs::read(&path).expect("read installed binary");
        assert_eq!(written, fs::read(sidecar).expect("read sidecar"));
        assert_eq!(recorded_version(dir).as_deref(), Some(APP_VERSION));

        let status = status(dir);
        assert!(status.installed);
        assert!(!status.stale);
        assert_eq!(status.current_version, APP_VERSION);
    });
}

#[test]
fn a_second_install_replaces_the_existing_copy() {
    with_install("replace", |sidecar, dir| {
        let path = install(sidecar, dir).expect("install");
        fs::write(&path, b"stale placeholder").expect("overwrite");
        assert_eq!(fs::read(&path).expect("read"), b"stale placeholder");

        install(sidecar, dir).expect("reinstall");
        assert_eq!(
            fs::read(&path).expect("read"),
            fs::read(sidecar).expect("read sidecar")
        );
    });
}

#[test]
fn refresh_is_a_no_op_for_the_current_version() {
    with_install("refresh-current", |sidecar, dir| {
        let path = install(sidecar, dir).expect("install");
        fs::write(&path, b"placeholder").expect("overwrite");

        assert!(!refresh_if_stale(sidecar, dir).expect("refresh"));
        assert_eq!(fs::read(&path).expect("read"), b"placeholder");
    });
}

#[test]
fn refresh_reinstalls_when_the_recorded_version_is_old() {
    with_install("refresh-stale", |sidecar, dir| {
        let path = install(sidecar, dir).expect("install");
        fs::write(&path, b"placeholder").expect("overwrite");
        fs::write(version_path(dir), "0.0.0\n").expect("downgrade record");
        assert!(status(dir).stale);

        assert!(refresh_if_stale(sidecar, dir).expect("refresh"));
        assert_eq!(
            fs::read(&path).expect("read"),
            fs::read(sidecar).expect("read sidecar")
        );
        assert_eq!(recorded_version(dir).as_deref(), Some(APP_VERSION));
    });
}

#[test]
fn uninstall_removes_the_binary_and_its_version_record() {
    with_install("uninstall", |sidecar, dir| {
        install(sidecar, dir).expect("install");
        assert!(uninstall(dir).expect("uninstall"));
        assert!(!binary_path(dir).exists());
        assert!(recorded_version(dir).is_none());
        assert!(!status(dir).installed);
        assert!(!uninstall(dir).expect("second uninstall"));
    });
}

#[test]
fn a_missing_sidecar_is_reported_not_installed() {
    let dir = temp_dir("missing");
    let missing = dir.join("no-such-cli");
    let err = install(&missing, &dir).expect_err("missing sidecar");
    assert!(matches!(err, CliInstallError::SidecarMissing(_)));
    assert!(!binary_path(&dir).exists());
    let _ = fs::remove_dir_all(&dir);
}
