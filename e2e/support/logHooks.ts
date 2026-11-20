/**
 * The per-spec app-log contract: an empty log when a spec starts, and a failure when it
 * ends having logged an `[ERROR]` the spec did not declare (see `logs.ts`).
 *
 * Registered as a Mocha **root hook plugin** from `wdio.conf.ts` (`mochaOpts.require`),
 * which is the only hook shape that can *fail* a spec file: an error thrown from a WDIO
 * `after` hook is logged and then swallowed (`@wdio/utils` → `executeHooksWithArgs`), so a
 * run would stay green while the log said otherwise.
 */
import {
  HARNESS_LOG_ERRORS,
  appLogPath,
  expectLogErrors,
  resetAppLog,
  unexpectedLogErrors,
  type LogFailure,
} from "./logs.ts";

/** Tests that failed in this file, so a broken spec does not also report its symptoms. */
let failures = 0;

export const mochaHooks = {
  async beforeAll(): Promise<void> {
    failures = 0;
    await resetAppLog();
    // Conditions the harness itself cannot provide (a microphone grant) are expected in
    // every spec; a spec adds its own with `expectLogErrors`.
    expectLogErrors(...HARNESS_LOG_ERRORS);
  },

  afterEach(this: { currentTest?: { state?: string } }): void {
    // The spec's own result is the verdict on its behaviour; the log is a second opinion.
    if (this.currentTest?.state === "failed") failures += 1;
  },

  async afterAll(): Promise<void> {
    if (failures > 0) return;
    const errors = await unexpectedLogErrors();
    if (errors.length === 0) return;
    throw new Error(
      `the app logged ${errors.length} unexpected error(s):\n\n` +
        errors.map(describe).join("\n\n") +
        `\n\nA test that makes one on purpose declares it with expectLogErrors().` +
        `\nThe whole log is ${appLogPath()} (the run's artifact).`,
    );
  },
};

/**
 * One unexpected error, with what makes it diagnosable: the record's **target** (which
 * side wrote it — a Rust module, or `webview` / `webview::<location>` for the UI) and the
 * records around it, which say what the app was doing when it logged it.
 */
function describe(failure: LogFailure, index: number): string {
  return [
    `${index + 1}) [ERROR] [${failure.target}] ${failure.message}`,
    `   before: ${list(failure.before)}`,
    `   after:  ${list(failure.after)}`,
  ].join("\n");
}

/** A context list as indented lines, or a note that the app logged nothing usable there. */
function list(lines: string[]): string {
  if (lines.length === 0) return "(nothing)";
  return `\n${lines.map((line) => `     ${line}`).join("\n")}`;
}
