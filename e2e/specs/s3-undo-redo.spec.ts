/**
 * S3. Undo / redo (M24.A) — `docs/undo-redo.md` → "Testing".
 *
 * Undo/redo is a core-owned project operation: the frontend pushes settled project
 * state, the core owns the snapshot and the stacks, and `Mod+Z` / `Shift+Mod+Z` are
 * command-registry commands with a text-field guard. These cases pin the four headline
 * behaviours: an edit is one step (undo/redo round-trip), a fresh project has an empty
 * stack, a text field keeps `Mod+Z` for native text undo, and a source change resets the
 * stack.
 */
import { SEL, tab } from "../support/selectors.ts";
import {
  count,
  invokeCore,
  newEmptyProject,
  openFixture,
  openTool,
  pressChord,
  waitFor,
} from "../support/helpers.ts";
import { projectSessionHooks } from "../support/session.ts";

/** Ask the core whether undo/redo would step somewhere. */
const canUndo = () => invokeCore<boolean>("can_undo");
const canRedo = () => invokeCore<boolean>("can_redo");

/** A clean project with the sine source and no Workbench tabs, its history empty. */
async function freshProject(): Promise<void> {
  // File → New drops the previous project (and its history), then a source load resets
  // the history again at the source boundary — so the base is "sine, no tabs".
  await newEmptyProject();
  await openFixture("sine440");
  // Let the post-reset pushes settle and the core lock the base (its 350 ms quiet
  // period), so the *next* edit records a step instead of being absorbed into the base.
  await browser.pause(1000);
}

describe("S3. Undo / redo (M24.A)", () => {
  projectSessionHooks(/^popout-\d+$/);

  it("S3.1 — an edit is one step: undo restores it, redo re-applies it", async () => {
    await freshProject();

    // Opening a Workbench tab is project content (SETUP.openTools + LAYOUT).
    await openTool("spectrum");
    await waitFor(
      async () => (await count(tab("spectrum"))) === 1,
      "the spectrum tab never opened",
    );
    await waitFor(async () => (await canUndo()) === true, "undo never became available");

    await pressChord("Mod+Z");
    await waitFor(async () => (await count(tab("spectrum"))) === 0, "undo did not close the tab");
    expect(await canRedo()).toBe(true);

    await pressChord("Shift+Mod+Z");
    await waitFor(async () => (await count(tab("spectrum"))) === 1, "redo did not reopen the tab");
  });

  it("S3.2 — a fresh project has an empty undo stack (no spurious step)", async () => {
    // File → New rebases the history; the settling empty state must not record a step.
    await newEmptyProject();
    await browser.pause(600); // let the post-reset state settle into the base
    expect(await canUndo()).toBe(false);
    expect(await canRedo()).toBe(false);
  });

  it("S3.3 — a text field keeps Mod+Z for native text undo, not the project", async () => {
    await freshProject();
    await openTool("spectrum");
    await waitFor(async () => (await canUndo()) === true, "undo never became available");

    // Dispatch the chord at the focused search input: the guard must leave the project
    // alone, so the key stays with native text undo.
    await pressChord("Mod+Z", SEL.sidebarSearch);

    expect(await count(tab("spectrum"))).toBe(1); // the project did not undo
    expect(await canUndo()).toBe(true);
    expect(await canRedo()).toBe(false);
  });

  it("S3.4 — a source change resets the undo stack", async () => {
    await freshProject();
    await openTool("spectrum");
    await waitFor(async () => (await canUndo()) === true, "undo never became available");

    // Replacing the source replaces the whole timeline, so history must not step across
    // it: the open tab becomes part of the new base, not a restorable step.
    await openFixture("chirpNoise");
    await waitFor(async () => !(await canUndo()), "the source change did not reset undo");
    await waitFor(async () => !(await canRedo()), "the source change left a redo step");
    expect(await count(tab("spectrum"))).toBe(1); // the tab survives the reset
  });
});
