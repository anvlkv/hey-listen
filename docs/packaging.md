# Packaging & releases

Hey Listen ships as a Tauri bundle for macOS (Apple silicon + Intel), Linux, and
Windows. Releases are built by GitHub Actions and published as GitHub Releases;
the `.heyl` project file association is registered by the bundle.

## Release process

1. Bump `version` in all three of `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `package.json` — keep them equal.
2. Commit, then tag: `git tag vX.Y.Z`.
3. Push the tag: `git push origin vX.Y.Z`.
4. `.github/workflows/release.yml` builds the platform matrix;
   `tauri-apps/tauri-action` creates a **draft** GitHub Release with the bundles.
5. Review the draft, then publish it.

A manual `workflow_dispatch` run takes the tag as an input and republishes.

## Workflows

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | frontend `typecheck` + `build`; `cargo check` on the 3-OS matrix |
| `release.yml` | tags `v*`, manual | bundles the platform matrix and opens a GitHub Release |

## Artifacts

`bundle.targets` is `"all"`, so each platform gets every format it supports:

| Platform | Runner | Bundle(s) |
| --- | --- | --- |
| macOS (Apple silicon) | `macos-latest` | `.dmg` (`aarch64-apple-darwin`) |
| macOS (Intel) | `macos-latest` | `.dmg` (`x86_64-apple-darwin`) |
| Linux (x86_64) | `ubuntu-24.04` | `.deb`, `.rpm`, `.AppImage` |
| Windows (x86_64) | `windows-latest` | `.msi`, `.exe` (NSIS) |

> **Why 24.04 for Linux.** `flexaudio`'s Linux backend depends on `pipewire` 0.10, and
> `libspa`/`libspa-sys` are generated from the **system** PipeWire headers — the crate's
> baseline feature is `v0_3_65`, so it needs headers ≥ 0.3.65. Ubuntu 22.04 ships PipeWire
> 0.3.48 and fails to compile (`spa_meta_region_is_valid`, `spa_video_info_raw.flags`);
> 24.04 ships 1.0.x and builds. The trade-off is the glibc baseline of the Linux bundles
> (24.04 → glibc 2.39), and a **runtime** PipeWire ≥ 0.3.65 for the live-capture backends.
> Building on 22.04 again would mean building newer PipeWire headers there (a PPA or from
> source) rather than the distro's.

Bundles are **unsigned**: macOS Gatekeeper and Windows SmartScreen warn on first
launch. Code signing / notarization is out of scope until signing keys exist.
