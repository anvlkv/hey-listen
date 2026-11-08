#!/usr/bin/env node
/**
 * One-time updater signing setup (M33.C, ADR-30).
 *
 * Generates the Tauri signing key pair, injects the **public** key into
 * `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and registers the
 * **private** key as the `TAURI_SIGNING_PRIVATE_KEY` Actions secret on the repo.
 *
 *   node scripts/setup-updater.mjs
 *
 * The private key is written to `~/.tauri/hey-listen.key` (never printed, never
 * committed) and read straight into `gh secret set`, so its content never appears
 * in a log. Regenerating overwrites the key; the old key must be re-registered or
 * already-installed users can no longer receive updates.
 *
 * Optional: `HEY_LISTEN_SIGNING_KEY` overrides the private-key path, and
 * `HEY_LISTEN_SIGNING_PASSWORD` encrypts the private key (an extra
 * `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret is then registered too).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = path.join(ROOT, "src-tauri", "tauri.conf.json");
const KEY =
  process.env.HEY_LISTEN_SIGNING_KEY ?? path.join(os.homedir(), ".tauri", "hey-listen.key");
const PASSWORD = process.env.HEY_LISTEN_SIGNING_PASSWORD;

/** Run a command and return trimmed stdout. */
function run(cmd, args, { input } = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
    ...(input ? { input } : {}),
  }).trim();
}

function fail(msg) {
  console.error(`setup-updater: ${msg}`);
  process.exit(1);
}

// 1. Generate the key pair (private key never leaves the file; the public key lands
//    beside it as `<key>.pub`).
mkdirSync(path.dirname(KEY), { recursive: true });
const signerArgs = ["tauri", "signer", "generate", "-w", KEY, "-f", "--ci"];
if (PASSWORD) signerArgs.push("-p", PASSWORD);
run("npx", signerArgs);

const pub = `${KEY}.pub`;
if (!existsSync(pub)) fail(`expected the public key at ${pub}`);

// 2. Inject the public key into the Tauri config.
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const publicKey = readFileSync(pub, "utf8").trim();
if (!publicKey) fail("the generated public key is empty");
config.plugins ??= {};
config.plugins.updater ??= {};
config.plugins.updater.pubkey = publicKey;
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

// 3. Register the private key (and optional password) as Actions secrets. The file is
//    piped straight to `gh`, so the private key is never echoed.
const secrets = [{ name: "TAURI_SIGNING_PRIVATE_KEY", path: KEY }];
if (PASSWORD) {
  secrets.push({ name: "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", value: PASSWORD });
}
for (const secret of secrets) {
  if (secret.value !== undefined) {
    run("gh", ["secret", "set", secret.name], { input: secret.value });
  } else {
    // Read the file and set the secret without printing it.
    const content = readFileSync(secret.path, "utf8").trim();
    run("gh", ["secret", "set", secret.name], { input: content });
  }
}

console.log(`updater signing configured: public key written to ${path.relative(ROOT, CONFIG)}`);
console.log(
  `private key kept at ${KEY} (registered as TAURI_SIGNING_PRIVATE_KEY; do not commit it)`,
);
if (PASSWORD) console.log("private-key password registered as TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
