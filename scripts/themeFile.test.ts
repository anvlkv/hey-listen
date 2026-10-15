import {
  parseThemeFile,
  serializeThemeFile,
  themeIdFromName,
  type ThemeFile,
} from "../src/lib/themeFile";
import { assertDeepEqual, assertEqual, check, report } from "./testHarness";

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
 * Lives outside `src/` so it is not part of the app bundle or the frontend
 * `tsc --noEmit` graph; the shared harness in `scripts/testHarness.ts` needs no extra
 * type packages, and `tsx` turns a thrown check into a non-zero exit.
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

check("parses a valid theme and normalises the ui overlay", () => {
  const result = parseThemeFile(JSON.stringify(VALID));
  assertEqual(result.ok, true);
  if (!result.ok) return;
  const { theme } = result;
  assertEqual(theme.meta.id, "retrowave-neon");
  assertEqual(theme.meta.base, "dark");
  // Keys gain their `--`; non-CSS values are dropped.
  assertEqual(theme.ui?.["--bg"], "#12081f");
  assertEqual(theme.ui?.["--accent"], "#ff4fd8");
  assertEqual(theme.ui?.["--ignored"], "12");
  assertEqual(theme.ui?.["--object"], undefined);
  assertEqual(theme.chart?.series, "#2de2e6");
  assertEqual(theme.colormap?.stops.length, 2);
});

check("keeps unknown top-level keys (forward-compatible)", () => {
  const result = parseThemeFile(JSON.stringify({ ...VALID, futureThing: { a: 1 } }));
  assertEqual(result.ok, true);
  if (!result.ok) return;
  assertDeepEqual((result.theme as unknown as Record<string, unknown>).futureThing, { a: 1 });
});

check("accepts a newer formatVersion without failing", () => {
  assertEqual(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: 99 })).ok, true);
});

check("rejects a foreign kind", () => {
  assertEqual(parseThemeFile(JSON.stringify({ ...VALID, kind: "something.else" })).ok, false);
});

check("rejects a bad / missing version", () => {
  assertEqual(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: 0 })).ok, false);
  assertEqual(parseThemeFile(JSON.stringify({ ...VALID, formatVersion: "1" })).ok, false);
  const withoutVersion: Record<string, unknown> = { ...VALID };
  delete withoutVersion.formatVersion;
  assertEqual(parseThemeFile(JSON.stringify(withoutVersion)).ok, false);
});

check("rejects a bad base or missing id", () => {
  assertEqual(
    parseThemeFile(JSON.stringify({ ...VALID, meta: { id: "x", name: "X", base: "sepia" } })).ok,
    false,
  );
  assertEqual(
    parseThemeFile(JSON.stringify({ ...VALID, meta: { name: "X", base: "dark" } })).ok,
    false,
  );
});

check("rejects malformed JSON and non-objects", () => {
  assertEqual(parseThemeFile("{not json").ok, false);
  assertEqual(parseThemeFile("[]").ok, false);
});

check("round-trips through serialize", () => {
  const result = parseThemeFile(JSON.stringify(VALID));
  assertEqual(result.ok, true);
  if (!result.ok) return;
  const again = parseThemeFile(serializeThemeFile(result.theme as ThemeFile));
  assertEqual(again.ok, true);
  if (!again.ok) return;
  assertEqual(again.theme.meta.id, "retrowave-neon");
});

check("slugs a display name into an id", () => {
  assertEqual(themeIdFromName("Retrowave Neon"), "retrowave-neon");
  assertEqual(themeIdFromName("  Solarized / Dark  "), "solarized-dark");
  assertEqual(themeIdFromName("!!!"), "theme");
});

report("themeFile");
