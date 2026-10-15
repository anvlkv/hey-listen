/**
 * N. Notes (M14) — `docs/notes.md`.
 *
 * Drives the annotation layer end to end: add a note from the Notes rail (which
 * captures the focused chart's frozen values), confirm the row + frozen values, save
 * the project, discard it, load it back and confirm the note survives, edit it in its
 * own window, then delete it.
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
import { closeWindowsMatching, windowLabels } from "../support/windows.ts";

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

  // A note opened in its own window lives until it is closed; make sure the next spec
  // starts on a single project window.
  after(async () => {
    await browser.tauri.switchWindow("main").catch(() => {});
    await closeWindowsMatching(/^note-\d+$/);
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

  it("N3 — a note opens in its own window, edits there, and the edit reaches the rail", async () => {
    // The note window is a *view* of the same project (like an analyzer popout), so the
    // row's popout action opens it and it renders just that note's editor.
    await (await $('[data-testid^="note.popout."]')).click();

    let noteWindow = "";
    await waitFor(async () => {
      noteWindow = (await windowLabels()).find((label) => /^note-\d+$/.test(label)) ?? "";
      return noteWindow !== "";
    }, "no note-* window appeared");

    await browser.tauri.switchWindow(noteWindow);
    await waitFor(
      async () => (await count('[data-testid="notes.window"]')) > 0,
      "the note window never rendered its editor",
    );
    const edited = "Edited in its own window";
    await (await $('[data-testid="notes.window.body"]')).setValue(edited);
    await (await $('[data-testid="notes.window.done"]')).click();

    // Committing closes the window, and the rail picks the new heading up.
    await waitFor(
      async () => !(await windowLabels()).includes(noteWindow),
      "the note window stayed open",
    );
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(
      async () => (await (await $('[data-testid^="note.heading."]')).getText()).trim() === edited,
      "the note window's edit did not reach the rail",
    );
  });

  it("N4 — deleting a note removes it", async () => {
    const del = await $('[data-testid^="note.delete."]');
    await del.waitForExist();
    await del.click();
    await waitFor(async () => (await count(firstNoteRow)) === 0, "the note was not deleted");
    expect(await count(SEL.notesEmpty)).toBe(1);
  });
});
