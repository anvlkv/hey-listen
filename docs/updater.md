# Self-update & the command-line tool

How Hey Listen checks for and installs its own updates, and how the installed batch CLI
stays in step with the app. This is **M33.C** and **M33.D**; see
[`roadmap.md`](roadmap.md) → M33 and [`decisions.md`](decisions.md) → ADR-30 / ADR-31.

## Model

- The app updates itself with `tauri-plugin-updater` against a **static JSON feed**
  published to GitHub Releases. There is no update server — GitHub Releases is the CDN.
- Updates are **signed**; the updater will not install an artifact it cannot verify.
- The **batch CLI (`hey-listen-cli`, ADR-29) follows the app**: it records the app version
  it was installed from, and is refreshed from the updated bundle, so there is no separate
  CLI release channel and no way for the two to drift.

## Keys

`tauri signer generate` produces a key pair.

- **Private key** — signs the update artifacts. Stored as a repo secret
  (`TAURI_SIGNING_PRIVATE_KEY`), never committed and never in a `.env` file. Losing it
  strands already-installed users: they cannot receive the next update.
- **Public key** — committed in `tauri.conf.json` → `plugins.updater.pubkey` (the *content*
  of the public key, not a path).

## Configuration

```jsonc
// src-tauri/tauri.conf.json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<content of publickey.pem>",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

- `createUpdaterArtifacts: true` (the v2 shape) makes each build emit its updater bundle
  **plus a `.sig`**: a `.app.tar.gz` on macOS, the `.AppImage` on Linux, and the
  `.msi`/`.exe` on Windows.
- TLS is enforced in production; the feed URL must be `https://`.
- The endpoint supports `{{target}}`, `{{arch}}`, `{{current_version}}`; with the single
  static `latest.json` we rely on the feed's per-`OS-ARCH` `platforms` map instead.

## Capability

`src-tauri/capabilities/default.json` gains `"updater:default"` (the full
check → download → install → download-and-install workflow). No broader scope is granted.

## Delivery (GitHub Actions)

`release.yml`:

1. Sets `TAURI_SIGNING_PRIVATE_KEY` (and the optional password secret) in the build env so
   Tauri signs each updater artifact.
2. Builds the platform matrix as today (`bundle.targets: "all"`), now also emitting the
   `.sig` files.
3. tauri-action uploads the bundles + signatures to the GitHub Release and publishes a
   **`latest.json`** feed — one `platforms` entry per `OS-ARCH` with that build's `url`
   and `signature`, a `version`, `notes`, and `pub_date`. The whole file is validated
   before the version is compared, so every listed platform must be complete.

## Checking & installing

```ts
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const update = await check();
if (update) {
  await update.downloadAndInstall((event) => {
    /* Started / Progress / Finished → progress UI */
  });
  await relaunch();
}
```

A **204** (or no `update`) means "up to date"; a **200** returns the feed object with
`version` / `notes` / `url` / `signature`. The frontend drives this through a small Rust
command + `Channel<DownloadEvent>` (the shape in the plugin docs), surfacing progress in
the About dialog (or a dedicated menu item) rather than auto-installing silently.

## CLI follows the app

1. The menu install (ADR-31) writes `hey-listen-cli` and records the **app version** it
   came from (next to the binary or in a small sidecar).
2. On launch — or immediately after an update installs — the app compares the recorded CLI
   version to the running app version; if the app is newer, it refreshes the installed CLI
   from the updated bundle (copy-then-swap, so a failure leaves the old CLI working).
3. **Update / Repair / Uninstall** in the menu is the same comparison: it reports whether
   the installed CLI matches the app, and lets the user repair or remove it.

The app version is the single source of truth for what the CLI should be; the CLI never
updates independently.

## Files

| Path | Role |
| --- | --- |
| `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts`, `plugins.updater` (pubkey + endpoints) |
| `src-tauri/capabilities/default.json` | `updater:default` |
| `.github/workflows/release.yml` | signing env + `latest.json` publication |
| `src-tauri/src/commands/update.rs` (new) | check / install commands + the download channel |
| `src/state/update.ts` (new) | frontend check/install/progress + relaunch |
| `src-tauri/src/commands/cli_install.rs` (new) | install / update / repair / uninstall of `hey-listen-cli` |
| `src-tauri/src/menu.rs` | the "Install Command Line Tool…" / "Check for Updates…" items |
