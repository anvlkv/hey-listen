import { defineConfig } from "vitest/config";

/**
 * Runner for the browser-free unit suites, `npm run test:unit`.
 *
 * These suites used to be one `tsx` process per file under `scripts/`, chained with
 * `&&` in `package.json`; vitest replaces that chain so a failure names its file and
 * case and the suites can share a fixture (`src/tests/support/`). They exercise pure
 * helpers — option tables, theme colours, chart geometry — and import nothing that
 * needs a DOM, so the `node` environment is enough and keeps them fast.
 *
 * They live under `src/` so `tsc --noEmit` type-checks them against the code they
 * test; nothing in the app imports them, so they stay out of the bundle.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
