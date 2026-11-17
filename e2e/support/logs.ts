/**
 * The app's own log in an E2E run (ADR-33).
 *
 * `HEYLISTEN_LOG_DIR` relocates the plugin's file target (`src-tauri/src/logging.rs` →
 * `targets`), and the suite sets it through the service's `env` (`wdio.conf.ts`), which
 * `@wdio/tauri-service` merges over `process.env` when it spawns the app. So the run owns
 * the destination: a CI job uploads `e2e/artifacts/` and carries the app log with it,
 * instead of leaving it in the runner's OS log directory — and a developer's own log is
 * never touched.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The directory the run's app log lands in (inside `e2e/artifacts`, gitignored). */
export const E2E_LOG_DIR = path.resolve(here, "..", "artifacts", "logs");

/** The app log file the current run writes — the core's `<stem>.<extension>`. */
export function appLogPath(): string {
  return path.join(E2E_LOG_DIR, "hey-listen.log");
}
