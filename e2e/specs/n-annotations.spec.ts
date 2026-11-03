/**
 * N. Annotations (M14) — `docs/annotations.md`.
 *
 * Drives the annotation layer end to end: add an annotation from the Annotations rail
 * (which captures the focused chart's frozen values), confirm the row + frozen values,
 * save the project, discard it, load it back and confirm the annotation survives, edit
 * it in its own window, then delete it.
 *
 * Native menus cannot be clicked by WebDriver, so File actions ride the `app:menu`
 * event and the native path dialogs are stubbed via `mockReturn` (as in `j-project`).
 * Each spec starts a fresh app session, so the window begins with no source.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, firstAnnotationRow } from "../support/selectors.ts";
import {
  count,
  menuAction,
  mockReturn,
  openFixture,
  openTool,
  waitFor,
  waitForAnalyzer,
  waitForSourceLoaded,
} from "../support/helpers.ts";
import { windowLabels } from "../support/windows.ts";
import { projectSessionHooks } from "../support/session.ts";

/** The first annotation's frozen values line. */
const firstValues = '[data-testid^="annotation.values."]';

describe("N. Annotations", () => {
  // An annotation opened in its own window lives until it is closed; make sure the next spec
  // starts on a single project window.
  projectSessionHooks(/^annotation-\d+$/);

  it("N1 — an annotation added from the rail captures the focused chart's values", async () => {
    await openFixture("sine440");

    // The annotation takes its tool from the focused analyzer tab, so open one first.
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    // Reveal the Annotations rail from the Toolbar (hidden by default; its open state is
    // app-level, so guard against a prior run having left it open).
    if ((await count(SEL.annotationsRegion)) === 0) {
      await (await $(SEL.toolbarAnnotations)).click();
    }
    await (await $(SEL.annotationsRegion)).waitForExist();
    expect(await count(firstAnnotationRow)).toBe(0);
    expect(await count(SEL.annotationsEmpty)).toBe(1);

    // Add an annotation at the analysis window — values are frozen from the spectrum chart.
    await (await $(SEL.annotationsAdd)).click();
    await waitFor(
      async () => (await count(firstAnnotationRow)) === 1,
      "the annotation row never appeared",
    );

    const values = (await (await $(firstValues)).getText()).trim();
    expect(values).toContain("peak");
    expect((await (await $(SEL.annotationsCount)).getText()).trim()).toBe("1");
  });

  it("N2 — the annotation survives a save / load round-trip", async () => {
    const tmpFile = path.join(os.tmpdir(), `heylisten-annotations-${Date.now()}.heyl`);

    await mockReturn("pick_project_save_path", tmpFile);
    await menuAction("saveAs");
    await waitFor(
      () => Promise.resolve(existsSync(tmpFile)),
      "the project file was never written to disk",
      20_000,
    );

    // Discard the project (New), then load the saved file back — the annotation must return.
    await menuAction("new");
    await waitFor(
      async () => (await count(firstAnnotationRow)) === 0,
      "New did not clear the annotations",
    );

    await mockReturn("pick_project_open_path", tmpFile);
    await menuAction("open");
    await waitForSourceLoaded();
    await waitFor(
      async () => (await count(firstAnnotationRow)) === 1,
      "the annotation did not survive the round-trip",
    );
    expect((await (await $(firstValues)).getText()).trim()).toContain("peak");
  });

  it("N3 — an annotation opens in its own window, edits there, and the edit reaches the rail", async () => {
    // The annotation window is a *view* of the same project (like an analyzer popout), so the
    // row's popout action opens it and it renders just that annotation's editor.
    await (await $('[data-testid^="annotation.popout."]')).click();

    let annotationWindow = "";
    await waitFor(async () => {
      annotationWindow =
        (await windowLabels()).find((label) => /^annotation-\d+$/.test(label)) ?? "";
      return annotationWindow !== "";
    }, "no annotation-* window appeared");

    await browser.tauri.switchWindow(annotationWindow);
    await waitFor(
      async () => (await count('[data-testid="annotations.window"]')) > 0,
      "the annotation window never rendered its editor",
    );
    const edited = "Edited in its own window";
    await (await $('[data-testid="annotations.window.body"]')).setValue(edited);
    // Done commits *and destroys the window*, which can win the race against this
    // click's reply (the window is gone before WebDriver can answer) — so don't await
    // it. Same reason `closeCurrentWindow` in `support/windows.ts` is fire-and-forget.
    await (await $('[data-testid="annotations.window.done"]')).click().catch(() => {});

    // Done commits and destroys the annotation window. WebDriver must not stay focused on
    // the gone window — the next `listWindows()` runs a script in the *current* handle
    // and WKWebView stalls on it until the 30 s command timeout. Switch to `main`
    // first, then confirm the annotation window is gone and the rail picked the edit up.
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(
      async () => !(await windowLabels()).includes(annotationWindow),
      "the annotation window stayed open",
    );
    await waitFor(
      async () =>
        (await (await $('[data-testid^="annotation.heading."]')).getText()).trim() === edited,
      "the annotation window's edit did not reach the rail",
    );
  });

  it("N4 — deleting an annotation removes it", async () => {
    const del = await $('[data-testid^="annotation.delete."]');
    await del.waitForExist();
    await del.click();
    await waitFor(
      async () => (await count(firstAnnotationRow)) === 0,
      "the annotation was not deleted",
    );
    expect(await count(SEL.annotationsEmpty)).toBe(1);
  });
});
