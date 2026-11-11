# Packaging & releases

Hey Listen ships as a Tauri bundle for macOS (Apple silicon + Intel), Linux, and
Windows. Releases are built by GitHub Actions and published as GitHub Releases;
the `.heyl` project file association is registered by the bundle.

## Release process

1. Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
   `src-tauri/cli/Cargo.toml`, `src-tauri/mcp/Cargo.toml` and `package.json` — keep them
   equal (the console binaries follow the app version they were built from, ADR-30). That
   is everything:
   the marketing page's download button takes its version from `package.json`,
   stamped into `site/` by `scripts/buildSite.mjs` when Pages deploys.
2. Commit, then tag: `git tag vX.Y.Z`.
3. Push the tag: `git push origin vX.Y.Z`.
4. `.github/workflows/release.yml` builds the platform matrix;
   `tauri-apps/tauri-action` creates a **draft** GitHub Release with the bundles.
5. Review the draft, then publish it.

A manual `workflow_dispatch` run takes the tag as an input and republishes.

## Workflows

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | **code changes only** (docs-only skips the build/test jobs): frontend `typecheck` / `build` / maid, Rust fmt + clippy + tests on the 3-OS matrix, and the E2E suite |
| `pages.yml` | push to `main`, manual | **always** (no paths filter): regenerates the doc subpages + stamps the version, then deploys `site/` to GitHub Pages |
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

Bundles are **not code-signed** for the OS: macOS Gatekeeper and Windows SmartScreen
warn on first launch. Code signing / notarization is out of scope until signing keys
exist.

**Update artifacts *are* signed (M33.C).** `bundle.createUpdaterArtifacts` is enabled by the
release workflow's `TAURI_CONFIG` override (not committed in `tauri.conf.json`, so a
local/CI `tauri build` — e.g. the E2E suite — never demands a signing key), so each
release emits its updater artifact and a `.sig` next to its bundles (the formats are
listed in [`updater.md`](updater.md) → Configuration), and `tauri-action` publishes the
`latest.json` feed the app's `plugins.updater.endpoints` reads. Signing uses the
`TAURI_SIGNING_PRIVATE_KEY` secret (plus the optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), both registered by `npm run setup:updater`
([`scripts/setup-updater.mjs`](../scripts/setup-updater.mjs)) — see
[`updater.md`](updater.md) → Keys. The updater verifies every download against the public
key committed in `tauri.conf.json`, so an artifact signed by any other key is never
installed.

> **The MCP client binary is not bundled.** `heylisten-mcp` (M9) — a plain console binary
> built next to the app (`target/{debug,release}/`) — is **not** shipped inside the
> `.app` / installer. It is a *client* tool (an MCP client spawns it), not part of the
> app, so bundling it as a sidecar (`externalBin`, which is meant to be *spawned by the
> app*) would be the wrong tool. It is its own crate (`src-tauri/mcp/`, package
> `heylisten-mcp`) for the same reason the batch CLI is: a non-main bin target of the app
> package is installed by the rpm/msi/deb bundles. See [`mcp.md`](mcp.md).

> **The batch CLI *is* bundled (M33.B).** `bundle.externalBin` names
> `binaries/hey-listen-cli`, so the `hey-listen-cli` console binary ships beside the app —
> the app spawns it to install it (M33.D, ADR-31). The console binary is **its own crate**
> (`src-tauri/cli/`, package `hey-listen-cli`, member of the `src-tauri/` workspace) that
> links the app crate as a library. That is what keeps it out of the app package's bin
> targets: as an auto-detected bin of the app it was bundled twice — the cargo binary *and*
> the `externalBin` sidecar — which fails the rpm build (`invalid destination path
> /usr/bin/hey-listen-cli - duplicate file entry`) and the WiX MSI (`ICE30`). All three
> crates are one workspace, so they share one `Cargo.lock` and one `target/`.
>
> Tauri appends the target triple to the sidecar file name, so
> `src-tauri/binaries/hey-listen-cli-<triple>` must exist **before any `cargo` command**
> (Tauri's build script resolves it, not just the bundler). No binary is committed:
>
> ```bash
> npm run sidecar   # cargo build -p hey-listen-cli + copy to src-tauri/binaries/
> ```
>
> `tauri build` runs the same script through `beforeBuildCommand`, so releases (and
> `tauri-action`) need no extra step; the CI `rust` job runs it once before
> clippy/tests. `tauri dev` and a bare `cargo test` on a fresh checkout do need the
> one-time `npm run sidecar`. The binary links the app's Tauri lib, so the staging build
> masks `externalBin` to break the chicken-and-egg (the file must exist to build it). See
> [`cli.md`](cli.md).
