/**
 * The app's own log in an E2E run (ADR-33), and the per-spec contract on it.
 *
 * `HEYLISTEN_LOG_DIR` relocates the plugin's file target (`src-tauri/src/logging.rs` →
 * `targets`), and the suite sets it through the service's `env` (`wdio.conf.ts`), which
 * `@wdio/tauri-service` merges over `process.env` when it spawns the app. So the run owns
 * the destination: a CI job uploads `e2e/artifacts/` and carries the app log with it,
 * instead of leaving it in the runner's OS log directory — and a developer's own log is
 * never touched.
 *
 * Every spec starts with an **empty** log and ends with a check that the app logged no
 * error it did not declare — both registered from `e2e/support/logHooks.ts`. A test that
 * forces a failure on purpose says so:
 *
 * ```ts
 * expectLogErrors("run_analysis failed: analysis failed (mock)");
 * ```
 *
 * so an `[ERROR]` nobody asked for — a real defect the UI quietly survived — fails the
 * spec instead of scrolling past.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The directory the run's app log lands in (inside `e2e/artifacts`, gitignored). */
export const E2E_LOG_DIR = path.resolve(here, "..", "artifacts", "logs");

/** The app log file the current run writes — the core's `<stem>.<extension>`. */
export function appLogPath(): string {
  return path.join(E2E_LOG_DIR, "hey-listen.log");
}

/** An error a spec intends to produce: matched against a record's message text. */
type ExpectedError = string | RegExp;

/**
 * Failures every spec may log because the **harness** cannot provide the condition.
 *
 * A live capture started from the Source panel is refused by the OS: the suite launches
 * the app without a microphone permission grant (the capture happy path, B5, is a manual
 * smoke — `docs/testing.md`). The backend's message text is platform-specific, so only its
 * stable prefix is matched; a **mocked** or otherwise unexpected `start_capture` failure
 * still fails the spec.
 */
export const HARNESS_LOG_ERRORS: ExpectedError[] = ["start_capture failed: capture backend error"];

/** The plugin's record format: `[date][time][target][LEVEL] message`. */
const RECORD = /^\[[^\]]*\]\[[^\]]*\]\[[^\]]*\]\[([A-Z]+)\]\s?(.*)$/;

/** How long the last fire-and-forget record gets to reach the file before it is read. */
const SETTLE_MS = 300;

/**
 * The errors the current spec declared, consumed by [`unexpectedLogErrors`]. A spec file
 * runs in its own worker process, so this state is per spec.
 */
let expected: ExpectedError[] = [];

/** Clear the run's app log, so a spec is judged only on the lines it produced. */
export async function resetAppLog(): Promise<void> {
  // The core opens the file in **append** mode (`OpenOptions::append`), so truncating it
  // from here is safe: the next record starts at offset 0, and the core never has to
  // re-open it.
  await mkdir(E2E_LOG_DIR, { recursive: true });
  await writeFile(appLogPath(), "");
}

/** Declare the errors this spec **intends** the app to log (a substring, or a regex). */
export function expectLogErrors(...patterns: ExpectedError[]): void {
  expected.push(...patterns);
}

/**
 * The app's `[ERROR]` lines since the reset, minus the ones this spec declared.
 *
 * Both producers are checked: a Rust `log::error!` / panic line and a forwarded
 * frontend line have the same record shape (the target says which side wrote it). The
 * frontend bridge's `[ui <file>:<line>]` prefix is stripped for matching and de-duplication
 * — the suite's own console forwarding repeats each line once — while the first record's
 * text (with its origin) is what gets reported.
 */
export async function unexpectedLogErrors(): Promise<string[]> {
  // A frontend line is forwarded fire-and-forget, so the spec's last one may still be in
  // flight when the file is read.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const text = await readFile(appLogPath(), "utf8").catch(() => "");
  const patterns = expected;
  expected = [];

  const errors = new Map<string, string>();
  for (const line of text.split("\n")) {
    const record = RECORD.exec(line);
    // A continuation line (a formatted stack or object) has no record prefix; the record
    // it belongs to already carried the verdict.
    if (record?.[1] !== "ERROR") continue;
    const shown = record[2].trim();
    const message = stripOrigin(shown);
    if (!message || patterns.some((pattern) => matches(pattern, message))) continue;
    if (!errors.has(message)) errors.set(message, shown);
  }
  return [...errors.values()];
}

/** Drop this app's `[ui <file>:<line>]` origin from a forwarded line. */
function stripOrigin(message: string): string {
  return message.replace(/^\[ui [^\]]*\]\s?/, "");
}

/** Whether `message` is one the spec declared. */
function matches(pattern: ExpectedError, message: string): boolean {
  return typeof pattern === "string" ? message.includes(pattern) : message.match(pattern) !== null;
}
