fn main() {
    // The target triple names the staged sidecar (`binaries/hey-listen-cli-<triple>`, see
    // `scripts/prepareSidecar.mjs`). Embedding it lets the CLI installer find that file in
    // a dev checkout, where the bundle layout does not exist yet (M33.C).
    println!(
        "cargo:rustc-env=HEY_LISTEN_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    tauri_build::build()
}
