/**
 * The per-spec app-log contract: an empty log when a spec starts, and a failure when it
 * ends having logged an `[ERROR]` the spec did not declare (see `logs.ts`).
 *
 * Registered as a Mocha **root hook plugin** from `wdio.conf.ts` (`mochaOpts.require`),
 * which is the only hook shape that can *fail* a spec file: an error thrown from a WDIO
 * `after` hook is logged and then swallowed (`@wdio/utils` → `executeHooksWithArgs`), so a
 * run would stay green while the log said otherwise.
 */
import { HARNESS_LOG_ERRORS, expectLogErrors, resetAppLog, unexpectedLogErrors } from "./logs.ts";

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
      `the app logged ${errors.length} unexpected error(s):\n` +
        errors.map((line) => `  [ERROR] ${line}`).join("\n") +
        "\nA test that makes one on purpose declares it with expectLogErrors().",
    );
  },
};
