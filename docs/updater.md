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

The key pair is created **once** by `npm run setup:updater`
([`scripts/setup-updater.mjs`](../scripts/setup-updater.mjs)): it runs
`tauri signer generate`, injects the **public** key into
`tauri.conf.json` → `plugins.updater.pubkey`, and registers the **private** key as the
`TAURI_SIGNING_PRIVATE_KEY` Actions secret (plus
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when `HEY_LISTEN_SIGNING_PASSWORD` encrypted it).
Re-running it regenerates the pair, after which already-installed users can no longer
receive updates — run it once, then keep the key.

- **Private key** — signs the update artifacts. It is written to
  `~/.tauri/hey-listen.key` and read straight into `gh secret set`, so it is never
  printed, committed or placed in a `.env` file. Losing it strands already-installed
  users: they cannot receive the next update.
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

`src-tauri/capabilities/default.json` gains `updater:default` (the full
check → download → install → download-and-install workflow) and
`process:allow-restart` (what `relaunch()` calls — `process:default` would also grant
`exit`, which the app never uses). No broader scope is granted.

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

The **core** owns the check and the download; the **frontend** owns consent and progress.
Two commands (`src-tauri/src/commands/update.rs`) are the whole surface:

| Command | Does |
| --- | --- |
| `check_update` | asks the feed, keeps the offered update in `PendingUpdate` state, and returns its metadata (`None` = up to date) |
| `install_update` | downloads and installs that pending update, streaming `Started` / `Progress` / `Finished` over a `Channel<DownloadEvent>` |

`src/state/update.ts` drives both and then calls `relaunch()` from
`@tauri-apps/plugin-process` to restart into the new build. Nothing installs silently:
*Help → Check for Updates…* opens the About dialog, whose **Updates** section shows the
result (with the feed's release notes) and offers **Download and install** — the only way
an update is installed — then **Restart Now**.

The updater plugin is registered for the GUI only, so a CLI invocation (`--mcp`,
`--headless`) never loads it or reaches the feed.

A **204** (or no update) means "up to date"; a **200** returns the feed object with
`version` / `notes` / `url` / `signature`, and the whole file is validated before the
version is compared.

## CLI follows the app

1. The install copies the bundled `hey-listen-cli` to the user's bin directory
   (`~/.local/bin` on macOS/Linux, `%LOCALAPPDATA%\hey-listen\bin` on Windows) and records
   the **app version** it came from in `hey-listen-cli.version` beside it. The copy is
   staged and renamed into place, so a failure leaves any existing install working.
2. On every launch the app compares that recorded version to its own
   (`CARGO_PKG_VERSION`); when they differ — an update installed, or a repair — it
   re-copies the CLI from the bundle. It runs off the main thread, so startup never waits
   on it, and it only touches an install that already exists: a user who never asked for
   the tool does not silently get one.
3. **Update / Repair / Uninstall** in the menu (M33.D) is the same comparison: it reports
   the path and whether the installed CLI matches the app, and lets the user repair or
   remove it.

The app version is the single source of truth for what the CLI should be; the CLI never
updates independently.

## Files

| Path | Role |
| --- | --- |
| `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts`, `plugins.updater` (pubkey + endpoints) |
| `src-tauri/capabilities/default.json` | `updater:default`, `process:allow-restart` |
| `.github/workflows/release.yml` | signing env + `latest.json` publication |
| `scripts/setup-updater.mjs` | the one-time key pair + public-key injection + `gh secret set` |
| `src-tauri/src/commands/update.rs` | `check_update` / `install_update` + the download channel |
| `src/state/update.ts` | frontend check/install/progress + relaunch |
| `src/components/AboutUpdates.tsx` | the dialog's Updates section (status, notes, progress) |
| `src-tauri/src/commands/cli_install.rs` | install / refresh / uninstall / status of `hey-listen-cli` |
| `src-tauri/src/menu.rs` | the *Check for Updates…* item (and, in M33.D, the CLI menu) |
