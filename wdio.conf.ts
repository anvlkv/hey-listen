/// <reference types="@wdio/tauri-service" />
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Options } from "@wdio/types";
import { writeFixtures } from "./e2e/support/fixtures.ts";
import { restoreWindowSize } from "./e2e/support/app.ts";
import { E2E_LOG_DIR } from "./e2e/support/logs.ts";

/**
 * WebdriverIO config for the Hey Listen E2E suite (M8).
 *
 * The suite drives the **release** binary through the system WebView with
 * `@wdio/tauri-service` and the **embedded** driver (`tauri-plugin-wdio-webdriver`)
 * — no external driver, and the only macOS route that needs no API key. See
 * `docs/testing.md`.
 *
 * Build first: `npm run tauri build` (`appBinaryPath` → `src-tauri/target/release/`).
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The embedded driver's fixed WebDriver port (`tauri-plugin-wdio-webdriver`).
 *
 * The app also advertises its MCP endpoint in `mcp.json` under the app data dir, and
 * the suite reads that file — so a stale instance must not survive into a run.
 */
const WEBDRIVER_PORT = 4445;

/** PIDs printed by `cmd` (one per line); empty when it matches nothing. */
function pids(cmd: string, args: string[]): number[] {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" })
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return []; // `lsof`/`pgrep` exit non-zero when there is no match
  }
}

/**
 * Kill any Hey Listen instance left over from a previous run (a crashed session, a
 * manual launch, a stray bundle). The embedded driver binds a **fixed** port, so a
 * survivor would keep that port busy and WDIO would silently attach to the **old**
 * window instead of launching a fresh app — and the survivor's `mcp.json` would race
 * the new one. Waits for the port to be released before returning.
 */
async function resetStaleApps(): Promise<void> {
  const stale = new Set<number>([
    ...pids("lsof", ["-ti", `tcp:${WEBDRIVER_PORT}`, "-sTCP:LISTEN"]),
    ...pids("pgrep", ["-f", "target/release/hey-listen"]),
    ...pids("pgrep", ["-f", "MacOS/hey-listen"]),
  ]);
  for (const pid of stale) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (pids("lsof", ["-ti", `tcp:${WEBDRIVER_PORT}`, "-sTCP:LISTEN"]).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** All run artifacts (JSON report, service logs, the app log) land here (gitignored). */
const ARTIFACTS_DIR = "./e2e/artifacts";

/** A failing test's screenshot name: suite + title, filesystem-safe and short. */
function screenshotName(suite: string, title: string): string {
  const slug = (text: string) =>
    text
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  return `${slug(suite)}.${slug(title)}.png`;
}

/** The release binary the suite drives. Override with `HEYLISTEN_BINARY`. */
const appBinaryPath =
  process.env.HEYLISTEN_BINARY ??
  path.join(
    here,
    "src-tauri",
    "target",
    "release",
    process.platform === "win32" ? "hey-listen.exe" : "hey-listen",
  );

export const config: Options.Testrunner & {
  capabilities: Record<string, unknown>[];
} = {
  runner: "local",
  specs: ["./e2e/specs/**/*.spec.ts"],
  // Where the service writes its logs and the JSON reporter writes the report.
  outputDir: ARTIFACTS_DIR,
  // One app instance at a time: the embedded WebDriver server binds a fixed port and
  // the app keeps per-window state, so parallel workers would fight over both.
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath },
    },
  ],

  services: [
    [
      "@wdio/tauri-service",
      {
        // The embedded provider (in-app W3C WebDriver server). Works on all three
        // platforms and needs no external driver or key.
        driverProvider: "embedded",
        appBinaryPath,
        // Surface both sides' logs in the report so a failure is diagnosable.
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: "info",
        frontendLogLevel: "info",
        commandTimeout: 30_000,
        startTimeout: 90_000,
        // The app's own log (ADR-33) rides the `env` the service merges over `process.env`
        // when it spawns the binary: `HEYLISTEN_LOG_DIR` moves the file target into the
        // run's artifacts, and an explicit level keeps a developer's shell setting out of
        // the run. See docs/testing.md → Artifacts.
        env: {
          HEYLISTEN_LOG_DIR: E2E_LOG_DIR,
          HEYLISTEN_LOG_LEVEL: "info",
        },
      },
    ],
  ],

  logLevel: "info",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,

  framework: "mocha",
  // Console output plus a machine-readable JSON report. WDIO writes one JSON per
  // spec file (into `outputDir`); `onComplete` merges them into `wdio-report.json`.
  reporters: ["spec", ["json", {}]],
  mochaOpts: {
    ui: "bdd",
    // `logHooks.ts` as a Mocha root hook plugin: every spec file starts with an empty app
    // log and fails when it ends with an error the spec did not declare. Root hooks are
    // the only shape that can fail a file — a WDIO `after` hook error is swallowed. See
    // docs/testing.md → Artifacts.
    require: ["./e2e/support/logHooks.ts"],
    // Analysis can be slow on the longest fixture; a generous per-test ceiling.
    timeout: 120_000,
  },

  /** Restore the window geometry the session may have resized (see `support/app.ts`). */
  async afterSession() {
    await restoreWindowSize().catch(() => {});
  },

  /**
   * Capture the window a failing test left behind.
   *
   * A failure without a picture is a diagnosis by guesswork: a stalled popout and a missing
   * element look identical in the logs. Best-effort — a wedged window must not turn the
   * artifact step into a failure of its own.
   */
  async afterTest(test, _context, result) {
    if (!result.error) return;
    await browser
      .saveScreenshot(path.join(ARTIFACTS_DIR, screenshotName(test.parent, test.title)))
      .catch(() => {});
  },

  /** Generate the deterministic fixtures before the app launches. */
  async onPrepare() {
    // Clear any app left over from a previous run *before* the service launches one.
    await resetStaleApps();
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    // A previous run's app log must not satisfy this run's assertions (the core rotates
    // the file on launch, but a run that never launched must leave nothing behind).
    await rm(E2E_LOG_DIR, { recursive: true, force: true });
    // Clear a previous run's JSON so the merge below only sees this run (the
    // service's own log file may already be open here, so leave non-JSON alone).
    for (const name of await readdir(ARTIFACTS_DIR)) {
      if (name.endsWith(".json")) await rm(path.join(ARTIFACTS_DIR, name), { force: true });
    }
    await writeFixtures();
  },

  /** Merge the per-spec JSON reports into one `wdio-report.json`. */
  async onComplete() {
    const { default: mergeResults } = await import("@wdio/json-reporter/mergeResults");
    await mergeResults(ARTIFACTS_DIR, /\.json$/, "wdio-report.json");
  },
};
