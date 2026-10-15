/**
 * Shared unit-check harness for the standalone `tsx` test scripts in this folder,
 * run by `npm run test:unit`.
 *
 * Each script runs as its own process (`tsx scripts/a.test.ts && tsx scripts/b.test.ts`),
 * so the counter below belongs to the script that imported it. There is deliberately no
 * `node:assert` dependency: a failed check throws, and `tsx` turns that uncaught error
 * into a non-zero exit.
 *
 * ```ts
 * import { assertEqual, check, report } from "./testHarness";
 *
 * check("adds", () => assertEqual(1 + 1, 2));
 * report("adder"); // "adder: 1 checks passed"
 * ```
 */

let passed = 0;

/** Runs `fn`, counting it as passed; on failure prints `✗ name` and rethrows. */
export function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

/** Strict (`===`) equality, for primitives. */
export function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      `${message ?? "assertEqual"}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

/** Structural equality via `JSON.stringify`, for plain data. */
export function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`assertDeepEqual: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/** Prints the script's summary line, e.g. `myThing: 9 checks passed`. */
export function report(label: string) {
  console.log(`${label}: ${passed} checks passed`);
}
