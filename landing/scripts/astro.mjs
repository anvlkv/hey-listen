#!/usr/bin/env node
/**
 * Run the Astro CLI with telemetry off.
 *
 * Astro otherwise writes a telemetry config under the user's home directory before
 * the build starts — a write that fails in a sandbox and is pointless on CI. Setting
 * the env var here (instead of in an npm script) keeps the commands working on
 * Windows too.
 */

import { spawnSync } from "node:child_process";

const result = spawnSync("astro", process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`landing: could not run astro: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
