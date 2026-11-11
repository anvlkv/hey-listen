import { expect, it } from "vitest";
import {
  parseThemeFile,
  serializeThemeFile,
  themeIdFromName,
  type ThemeFile,
} from "../lib/themeFile";

/**
 * Unit checks for the `ThemeFile` model (`src/lib/themeFile.ts`), runnable without a
 * browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the parse/validate/normalise contract the rest of the theme feature relies
 * on: bad kind/version/base are rejected, unknown keys survive, `ui` keys gain their
 * `--`, and a parsed theme re-serialises to valid JSON. See `docs/theming.md`.
 *
 * Lives in `src/tests/` so `tsc --noEmit` type-checks it with the code it exercises;
 * nothing in the app imports it, so it is not part of the bundle. Vitest supplies
 * `it` / `expect`, so there is no harness to maintain.
 */

const VALID = {
  kind: "hey-listen.theme",
  formatVersion: 1,
  meta: { id: "retrowave-neon", name: "Retrowave Neon", base: "dark" },
  ui: { bg: "#12081f", "--accent": "#ff4fd8", ignored: 12, object: { nope: true } },
  chart: { series: "#2de2e6" },
  colormap: {
    stops: [
      [0, [0, 0, 0]],
      [1, [255, 255, 255]],
    ],
  },
};

it("parses a valid theme and normalises the ui overlay", () => {
  const result = parseThemeFile(JSON.stringify(VALID));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const { theme } = result;
  expect(theme.meta.id).toBe("retrowave-neon");
  expect(theme.meta.base).toBe("dark");
  // Keys gain their `--`; non-CSS values are dropped.
  expect(theme.ui?.["--bg"]).toBe("#12081f");
  expect(theme.ui?.["--accent"]).toBe("#ff4fd8");
  expect(theme.ui?.["--ignored"]).toBe("12");
  expect(theme.ui?.["--object"]).toBeUndefined();
  expect(theme.chart?.series).toBe("#2de2e6");
  expect(theme.colormap?.stops.length).toBe(2);
});

it("keeps unknown top-level keys (forward-compatible)", () => {
  const result = parseThemeFile(JSON.stringify({ ...VALID, futureThing: { a: 1 } }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect((result.theme as unknown as Record<string, unknown>).futureThing).toEqual({ a: 1 });
});

it("accepts a newer formatVersion without failing", () => {
  expect(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: 99 })).ok).toBe(true);
});

it("rejects a foreign kind", () => {
  expect(parseThemeFile(JSON.stringify({ ...VALID, kind: "something.else" })).ok).toBe(false);
});

it("rejects a bad / missing version", () => {
  expect(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: 0 })).ok).toBe(false);
  expect(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: "1" })).ok).toBe(false);
  const withoutVersion: Record<string, unknown> = { ...VALID };
  delete withoutVersion.formatVersion;
  expect(parseThemeFile(JSON.stringify(withoutVersion)).ok).toBe(false);
});

it("rejects a bad base or missing id", () => {
  expect(
    parseThemeFile(JSON.stringify({ ...VALID, meta: { id: "x", name: "X", base: "sepia" } })).ok,
  ).toBe(false);
  expect(parseThemeFile(JSON.stringify({ ...VALID, meta: { name: "X", base: "dark" } })).ok).toBe(
    false,
  );
});

it("rejects malformed JSON and non-objects", () => {
  expect(parseThemeFile("{not json").ok).toBe(false);
  expect(parseThemeFile("[]").ok).toBe(false);
});

it("round-trips through serialize", () => {
  const result = parseThemeFile(JSON.stringify(VALID));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const again = parseThemeFile(serializeThemeFile(result.theme as ThemeFile));
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.theme.meta.id).toBe("retrowave-neon");
});

it("slugs a display name into an id", () => {
  expect(themeIdFromName("Retrowave Neon")).toBe("retrowave-neon");
  expect(themeIdFromName("  Solarized / Dark  ")).toBe("solarized-dark");
  expect(themeIdFromName("!!!")).toBe("theme");
});
