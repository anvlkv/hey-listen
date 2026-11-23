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
 * - A live capture started from the Source panel is refused by the OS: the suite launches
 *   the app without a microphone permission grant (the capture happy path, B5, is a manual
 * smoke.
 * - A desktop CI runner has **no audio output device**, so the first real `preview_region`
 *   (and the UI's `preview failed` report of it) is rejected. A spec that previews audio
 *   therefore records these two lines on any machine without an output device.
 *
 * Both texts are platform-specific past the prefix, so only the stable part is matched; a
 * **mocked** or otherwise unexpected failure still fails the spec.
 */
export const HARNESS_LOG_ERRORS: ExpectedError[] = [
  "start_capture failed: capture backend error",
  "preview_region failed",
  "preview failed",
];

/** The plugin's record format: `[date][time][target][LEVEL] message`. */
const RECORD = /^\[[^\]]*\]\[[^\]]*\]\[([^\]]*)\]\[([A-Z]+)\]\s?(.*)$/;

/** How many records before (and after) an unexpected error the report shows. */
const CONTEXT_BEFORE = 6;
const CONTEXT_AFTER = 2;

/** The most text one reported line carries, so a huge message cannot bury the report. */
const REPORT_MAX_CHARS = 240;

/** One parsed record of the app log. */
interface LogRecord {
  /** The writer: a Rust module, or `webview` / `webview::<location>` for the frontend. */
  target: string;
  level: string;
  message: string;
}

/**
 * One unexpected `[ERROR]` the app logged, with the records around it.
 *
 * The target and the neighbours are what make a failure diagnosable: the message alone
 * often names no command, while the target says which side wrote it and the neighbouring
 * lines say what the app was doing when it did.
 */
export interface LogFailure {
  /** The erroring record's target (see [`LogRecord.target`]). */
  target: string;
  /** Its text, with the bridge's `[ui <file>:<line>]` origin kept when it had one. */
  message: string;
  /** Records logged before it, oldest first (other unexpected errors left out). */
  before: string[];
  /** Records logged after it, oldest first (other unexpected errors left out). */
  after: string[];
}

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
 * The app's unexpected `[ERROR]` records since the reset, each with its neighbours.
 *
 * Both producers are checked: a Rust `log::error!` / panic line and a forwarded frontend
 * line have the same record shape (the target says which side wrote it). The frontend
 * bridge's `[ui <file>:<line>]` prefix is stripped for matching and de-duplication — the
 * suite's own console forwarding repeats each line once — while the first record's text
 * (with its origin) is what gets reported.
 */
export async function unexpectedLogErrors(): Promise<LogFailure[]> {
  // A frontend line is forwarded fire-and-forget, so the spec's last one may still be in
  // flight when the file is read.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const text = await readFile(appLogPath(), "utf8").catch(() => "");
  const patterns = expected;
  expected = [];

  const records = text.split("\n").flatMap((line) => {
    const record = RECORD.exec(line);
    // A continuation line (a formatted stack or object) has no record prefix; the record
    // it belongs to already carried the verdict.
    return record ? [{ target: record[1], level: record[2], message: record[3].trim() }] : [];
  });

  const unexpected = (record: LogRecord) => {
    if (record.level !== "ERROR") return false;
    const message = stripOrigin(record.message);
    return message !== "" && !patterns.some((pattern) => matches(pattern, message));
  };

  // One entry per distinct message, at the index of its first record: a burst of the same
  // failure is one defect, not N.
  const failures = new Map<string, { index: number; record: LogRecord }>();
  records.forEach((record, index) => {
    if (!unexpected(record)) return;
    const key = stripOrigin(record.message);
    if (!failures.has(key)) failures.set(key, { index, record });
  });

  const neighbour = (record: LogRecord) => (unexpected(record) ? null : format(record));

  return [...failures.values()].map(({ index, record }) => ({
    target: record.target,
    message: record.message,
    before: records
      .slice(Math.max(0, index - CONTEXT_BEFORE), index)
      .flatMap((each) => neighbour(each) ?? []),
    after: records
      .slice(index + 1, index + 1 + CONTEXT_AFTER)
      .flatMap((each) => neighbour(each) ?? []),
  }));
}

/** One record as a report line: `[LEVEL] [target] message`, capped in length. */
function format(record: LogRecord): string {
  const line = `[${record.level}] [${record.target}] ${record.message}`;
  return line.length <= REPORT_MAX_CHARS ? line : `${line.slice(0, REPORT_MAX_CHARS)}…`;
}

/** Drop this app's `[ui <file>:<line>]` origin from a forwarded line. */
function stripOrigin(message: string): string {
  return message.replace(/^\[ui [^\]]*\]\s?/, "");
}

/** Whether `message` is one the spec declared. */
function matches(pattern: ExpectedError, message: string): boolean {
  return typeof pattern === "string" ? message.includes(pattern) : message.match(pattern) !== null;
}
