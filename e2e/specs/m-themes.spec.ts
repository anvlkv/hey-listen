/**
 * M. Exchangeable themes (M11) — the Toolbar **Appearance** popover.
 *
 * Themes are **chrome** (app-level, persisted in `localStorage`), so these tests
 * drive the popover and assert the resulting root palette + `data-theme`, plus the
 * persisted preference. The parsing/validation contract lives in the unit checks
 * (`npm run test:unit`), and the Rust store is unit-tested in `src-tauri`
 * (`cargo test`).
 *
 * The theme preference persists across launches, so the spec **resets to a known
 * state** before asserting and restores the defaults at the end.
 */
import { SEL } from "../support/selectors.ts";
import {
  click,
  count,
  dismissPopovers,
  openSelect,
  pickOption,
  textOf,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";

/** Open the Appearance popover, closing it first if it is already open. */
async function openAppearance(): Promise<void> {
  await dismissPopovers();
  await click(SEL.toolbarView);
  await waitFor(async () => (await count(".pop-panel")) > 0, "the Appearance popover did not open");
}

/** The active base theme (`document.documentElement.dataset.theme`). */
async function dataTheme(): Promise<string> {
  return (await browser.execute(() => document.documentElement.dataset.theme ?? "")) as string;
}

/** One CSS custom property's computed value on the root (trimmed). */
async function rootVar(name: string): Promise<string> {
  return (await browser.execute(
    (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  )) as string;
}

/** Pick a mode (`Auto` / `Dark` / `Light`). Opens the popover itself. */
async function selectMode(label: "Auto" | "Dark" | "Light"): Promise<void> {
  await openAppearance();
  await click(`.pop-panel [aria-label="${label} mode"]`);
}

/** Assign a theme to a slot (`Dark` / `Light`). Opens the popover itself. */
async function setSlot(slot: "Dark" | "Light", name: string): Promise<void> {
  await openAppearance();
  await openSelect(`.pop-panel [aria-label="${slot} slot theme"]`);
  await pickOption(name);
}

/** The persisted preference (`hey-listen:theme`), parsed. */
async function storedPreference(): Promise<Record<string, unknown>> {
  const raw = (await browser.execute(() => localStorage.getItem("hey-listen:theme"))) as
    | string
    | null;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

describe("M. Exchangeable themes", () => {
  before(async () => {
    await waitForApp();
    // Reset to the shipped default: dark mode, retrowave neon in the dark slot.
    await selectMode("Dark");
    await setSlot("Dark", "Retrowave Neon");
    await dismissPopovers();
  });

  it("M1 — the default look is Retrowave Neon (dark base)", async () => {
    await waitFor(
      async () => (await rootVar("--bg")) === "#12081f",
      "the retrowave neon palette is not applied",
    );
    expect(await dataTheme()).toBe("dark");

    // The popover names the active theme.
    await openAppearance();
    expect(await textOf(".pop-panel")).toContain("Retrowave Neon");
    await dismissPopovers();
  });

  it("M2 — switching the mode swaps the base palette", async () => {
    await selectMode("Light");
    await waitFor(async () => (await dataTheme()) === "light", "the light base did not apply");
    await waitFor(
      async () => (await rootVar("--bg")) === "#f0f1f4",
      "the built-in light palette did not apply",
    );

    await selectMode("Dark");
    await waitFor(async () => (await dataTheme()) === "dark", "the dark base did not return");
    await waitFor(
      async () => (await rootVar("--bg")) === "#12081f",
      "the retrowave neon palette did not return",
    );
  });

  it("M3 — assigning a theme to the dark slot changes the palette", async () => {
    await selectMode("Dark");

    await setSlot("Dark", "Nord");
    await waitFor(async () => (await rootVar("--bg")) === "#2e3440", "the nord palette did not apply");

    // Restore the default slot for later specs.
    await setSlot("Dark", "Retrowave Neon");
    await waitFor(
      async () => (await rootVar("--bg")) === "#12081f",
      "the retrowave palette did not return",
    );
  });

  it("M4 — the preference persists to localStorage", async () => {
    await selectMode("Auto");
    await waitFor(
      async () => (await storedPreference()).mode === "auto",
      "the mode was not persisted",
    );

    // Leave the shipped default applied for any later spec.
    await selectMode("Dark");
    await waitFor(
      async () => (await storedPreference()).darkThemeId === "builtin:retrowave-neon",
      "the dark slot did not persist",
    );
  });
});
