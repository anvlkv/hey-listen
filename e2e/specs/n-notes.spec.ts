/**
 * N. Notes (M14) — `docs/notes.md`.
 *
 * Drives the annotation layer end to end: add a note from the Notes rail (which
 * captures the focused chart's frozen values), confirm the row + frozen values, save
 * the project, discard it, load it back and confirm the note survives, then delete it.
 *
 * Native menus cannot be clicked by WebDriver, so File actions ride the `app:menu`
 * event and the native path dialogs are stubbed via `mockReturn` (as in `j-project`).
 * Each spec starts a fresh app session, so the window begins with no source.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, firstNoteRow } from "../support/selectors.ts";
import {
  count,
  closeAllTabs,
  menuAction,
  mockReturn,
  openFixture,
  openTool,
  restoreMocks,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForSourceLoaded,
} from "../support/helpers.ts";

/** The first note's frozen values line. */
const firstValues = '[data-testid^="note.values."]';

describe("N. Notes", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // New Project / source replacement ask the core to confirm.
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    await restoreMocks();
    await mockReturn("confirm", true);
  });

  it("N1 — a note added from the rail captures the focused chart's values", async () => {
    await openFixture("sine440");

    // The note takes its tool from the focused analyzer tab, so open one first.
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    // Reveal the Notes rail from the Toolbar (hidden by default; its open state is
    // app-level, so guard against a prior run having left it open).
    if ((await count(SEL.notesRegion)) === 0) {
      await (await $(SEL.toolbarNotes)).click();
    }
    await (await $(SEL.notesRegion)).waitForExist();
    expect(await count(firstNoteRow)).toBe(0);
    expect(await count(SEL.notesEmpty)).toBe(1);

    // Add a note at the analysis window — values are frozen from the spectrum chart.
    await (await $(SEL.notesAdd)).click();
    await waitFor(async () => (await count(firstNoteRow)) === 1, "the note row never appeared");

    const values = (await (await $(firstValues)).getText()).trim();
    expect(values).toContain("peak");
    expect((await (await $(SEL.notesCount)).getText()).trim()).toBe("1");
  });

  it("N2 — the note survives a save / load round-trip", async () => {
    const tmpFile = path.join(os.tmpdir(), `heylisten-notes-${Date.now()}.heyl`);

    await mockReturn("pick_project_save_path", tmpFile);
    await menuAction("saveAs");
    await waitFor(
      () => Promise.resolve(existsSync(tmpFile)),
      "the project file was never written to disk",
      20_000,
    );

    // Discard the project (New), then load the saved file back — the note must return.
    await menuAction("new");
    await waitFor(async () => (await count(firstNoteRow)) === 0, "New did not clear the notes");

    await mockReturn("pick_project_open_path", tmpFile);
    await menuAction("open");
    await waitForSourceLoaded();
    await waitFor(
      async () => (await count(firstNoteRow)) === 1,
      "the note did not survive the round-trip",
    );
    expect((await (await $(firstValues)).getText()).trim()).toContain("peak");
  });

  it("N3 — deleting a note removes it", async () => {
    const del = await $('[data-testid^="note.delete."]');
    await del.waitForExist();
    await del.click();
    await waitFor(async () => (await count(firstNoteRow)) === 0, "the note was not deleted");
    expect(await count(SEL.notesEmpty)).toBe(1);
  });
});
