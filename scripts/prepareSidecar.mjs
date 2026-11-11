#!/usr/bin/env node
/**
 * Stage the `hey-listen-cli` console binary as the app's sidecar (M33.B, ADR-29).
 *
 * The console binary is its own crate — the `hey-listen-cli` package in `src-tauri/cli/`,
 * a member of the `src-tauri/` workspace. It is deliberately **not** a bin target of the
 * app package: the bundler would then install it twice (once as the cargo binary, once
 * as the sidecar), which fails the rpm build (`duplicate file entry`) and the WiX MSI
 * (`ICE30`). See `docs/packaging.md`.
 *
 * `bundle.externalBin` in `src-tauri/tauri.conf.json` names `binaries/hey-listen-cli`,
 * which Tauri resolves to `src-tauri/binaries/hey-listen-cli-<target-triple>` (plus
 * `.exe` on Windows). No binary is committed (`.gitignore` drops the folder), so this
 * script builds the console binary for the target being bundled and copies it there.
 *
 * Tauri's build script reads that path on **every** `cargo` invocation of the app (not
 * just `tauri build`), so a fresh checkout must run this once before `cargo
 * check`/`test`/`clippy`:
 *
 *   npm run sidecar
 *
 * `tauri build` and `tauri-action` run it through `beforeBuildCommand`, so releases do
 * not need an extra step. The debug profile is enough for compile-time checks; a
 * release bundle stages the release profile (Tauri sets `TAURI_ENV_DEBUG`).
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = "hey-listen-cli";
// Workspace root: the CLI crate is a member, so `-p` builds it into the shared
// `src-tauri/target/` tree this script reads below.
const MANIFEST = path.join(ROOT, "src-tauri", "Cargo.toml");

/** The triple Tauri appends to the sidecar file name, and the host's own triple. */
function targetTriple() {
  // `npm run sidecar` (and a plain `cargo test`) has no Tauri env: the host triple is
  // the right answer for a native build.
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = info.split("\n").find((line) => line.startsWith("host: "));
  if (!host) throw new Error("cannot read the host triple from `rustc -vV`");
  const hostTriple = host.slice("host: ".length).trim();
  return { triple: process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple, hostTriple };
}

const { triple, hostTriple } = targetTriple();
// A native build reuses the warm `target/{debug,release}` tree; a cross build gets its
// own `target/<triple>` one.
const cross = triple !== hostTriple;
// `tauri build` sets TAURI_ENV_DEBUG=false; `tauri dev` and a manual run stay in debug.
const release = process.env.TAURI_ENV_DEBUG === "false";
const ext = triple.includes("windows") ? ".exe" : "";

const cargo = ["build", "--manifest-path", MANIFEST, "-p", BIN];
if (cross) cargo.push("--target", triple);
if (release) cargo.push("--release");
// Chicken and egg: Tauri's build script fails unless the sidecar already exists, and
// building the sidecar runs that build script (the console binary links the app lib).
// Building with `externalBin` masked keeps the staging step independent; `tauri build`
// then compiles the app against the real config with the file in place.
execFileSync("cargo", cargo, {
  stdio: "inherit",
  env: { ...process.env, TAURI_CONFIG: '{"bundle":{"externalBin":[]}}' },
});

const profile = release ? "release" : "debug";
const built = path.join(
  ROOT,
  "src-tauri",
  "target",
  ...(cross ? [triple] : []),
  profile,
  `${BIN}${ext}`,
);
const dest = path.join(ROOT, "src-tauri", "binaries", `${BIN}-${triple}${ext}`);
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log(`sidecar: ${path.relative(ROOT, dest)}`);
