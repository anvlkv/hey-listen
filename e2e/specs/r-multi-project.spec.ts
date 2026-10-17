/**
 * R. Two projects at once (M7 multi-window).
 *
 * One window = one project (ADR-3), so H1/H2 only ever exercise a *single* project: H1
 * replaces the source within one window, H2 pops a tab out of the one window. This spec is
 * the cross-window angle — two project windows, each with its own audio, its own analysis,
 * and its own popout.
 *
 * Three properties of the harness matter here, and hold throughout:
 *  - `browser.tauri.switchWindow(label)` moves the **standard** WebDriver context with it
 *    (`@wdio/tauri-service` calls `browser.switchToWindow(label)` for the embedded
 *    provider), so the existing DOM helpers keep working in the window switched to;
 *  - a window is listed *before* its webview has booted, so every switch to a window this
 *    spec just created is followed by `waitForShell()`;
 *  - a fresh webview has the test seam but **no installed IPC override**, so each newly
 *    entered window installs its dialog mocks before anything can raise a native dialog
 *    (see `e2e/support/ipc.ts`).
 *
 * Actions are driven through commands/in-app clicks, or a **targeted** `app:menu` emit:
 * the suite's `menuAction` emits with `event.emit`, which Tauri delivers to all windows —
 * with two projects open, one menu emit would act on both.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, analyzerPanel, sidebarTool, tab } from "../support/selectors.ts";
import { canvasSignature } from "../support/analyzers.ts";
import {
  canvasHasInk,
  closeAllTabs,
  count,
  dismissPopovers,
  invokeCore,
  menuActionIn,
  mockReturn,
  openFixture,
  openSelect,
  openTabTitles,
  openTool,
  pickOption,
  readoutValue,
  textOf,
  timelineReadoutText,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForReadouts,
  waitForShell,
} from "../support/helpers.ts";
import { popOutTab } from "../support/popouts.ts";
import {
  closeCurrentWindow,
  closeWindowsMatching,
  openProjectWindow,
  windowLabels,
} from "../support/windows.ts";

/** Kobalte portals every popover panel with this class (as in the F spec). */
const POP_PANEL = ".pop-panel";

/** The second project window this spec drives (opened by R1). */
let second = "";
/** The two popouts, one per project (opened by R2). */
let mainPopout = "";
let secondPopout = "";
/** A popout the project loaded in R5 does not record (must close on load). */
let levelsPopout = "";

/** The `second` project window, opening one if this spec has not made it yet. */
async function ensureSecondWindow(): Promise<string> {
  if (!second) second = await openProjectWindow();
  return second;
}

/** The chart signature of a tool in a named window, switching the session there first. */
async function chartSignatureIn(label: string, toolId: string): Promise<string> {
  await browser.tauri.switchWindow(label);
  await waitForShell();
  const chart = `${analyzerPanel(toolId)} canvas`;
  await waitFor(() => canvasHasInk(chart), `no chart was drawn in ${label}`);
  return canvasSignature(chart);
}

/**
 * The native window states the service itself reads: `label`, native `title`, visibility.
 *
 * `plugin:wdio|get_window_states` is the ACL-safe way to see a window's **native** title
 * from the suite — `document.title` is `index.html`'s `<title>` ("Hey Listen") in every
 * window, and `core:window:allow-title` is not granted.
 */
async function windowStates(): Promise<{ label: string; title: string }[]> {
  return (await browser.tauri.execute(({ core }) =>
    core.invoke("plugin:wdio|get_window_states"),
  )) as { label: string; title: string }[];
}

/** A selector's text in a named window. */
async function textIn(label: string, selector: string): Promise<string> {
  await browser.tauri.switchWindow(label);
  await waitForShell();
  return (await textOf(selector)).trim();
}

/** The FFT size the spectrum readout reports in the *current* window (0 when absent). */
async function fftHere(): Promise<number> {
  const match = ((await readoutValue("spectrum", "FFT")) ?? "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

/** Switch to a window showing the spectrum tool and read the FFT size it ran with. */
async function fftIn(label: string): Promise<number> {
  await browser.tauri.switchWindow(label);
  await waitForShell();
  await waitFor(
    () => canvasHasInk(`${analyzerPanel("spectrum")} canvas`),
    `the spectrum chart never rendered in ${label}`,
  );
  return fftHere();
}

/** Pick an FFT size other than `current` through the current window's Toolbar popover. */
async function changeFft(current: number): Promise<number> {
  const next = current === 1024 ? 4096 : 1024;
  await (await $(SEL.toolbarParams)).click();
  await browser.waitUntil(async () => (await $(POP_PANEL)).isExisting(), {
    timeoutMsg: "the shared analysis-params popover did not open",
  });
  await openSelect('[aria-label="FFT size"]');
  await pickOption(String(next));
  await dismissPopovers();
  return next;
}

describe("R. Two projects at once", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await mockReturn("confirm", true);
  });

  // Every window this spec opens is its own to close: popouts first, then project
  // windows (closing a project also destroys its popouts), then back to a clean main.
  after(async () => {
    await closeWindowsMatching(/^popout-\d+$/);
    await closeWindowsMatching(/^project-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("R1 — two project windows hold different audio and analyse it independently", async () => {
    await waitForApp();
    await closeAllTabs();

    // main: the 2 s tone, analysed.
    await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const mainReadout = await timelineReadoutText();
    const mainChart = await canvasSignature(`${analyzerPanel("spectrum")} canvas`);

    // A second, independent project window (File → New Window): its own source and its
    // own Workbench, not a view of main's project.
    second = await openProjectWindow();
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await mockReturn("confirm", true);
    expect(await count(tab("spectrum"))).toBe(0);

    await openFixture("chirpNoise");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const secondReadout = await timelineReadoutText();
    const secondChart = await canvasSignature(`${analyzerPanel("spectrum")} canvas`);

    expect(mainReadout).toContain("0:02");
    expect(secondReadout).toContain("0:03");
    // Different audio, each analysed against its own project's core state.
    expect(secondChart).not.toBe(mainChart);

    // Back to main: the second window's work did not disturb it.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    expect(await timelineReadoutText()).toBe(mainReadout);
    expect(await canvasSignature(`${analyzerPanel("spectrum")} canvas`)).toBe(mainChart);
  });

  it("R2 — a popped-out tool belongs to the project window that popped it out", async () => {
    await waitForApp();
    second = await ensureSecondWindow();

    // Pop main's spectrum tab out, then the second project's — same tool, two projects.
    mainPopout = await popOutTab("spectrum");
    await waitFor(
      async () => (await count(tab("spectrum"))) === 0,
      "the tab stayed in main after popping out",
    );

    await browser.tauri.switchWindow(second);
    await waitForShell();
    secondPopout = await popOutTab("spectrum");
    await waitFor(
      async () => (await count(tab("spectrum"))) === 0,
      `the tab stayed in ${second} after popping out`,
    );
    expect(secondPopout).not.toBe(mainPopout);

    // Each popout is a view of *its own* project: same tool + same params, different audio
    // ⇒ a different chart. A popout that aliased to the wrong project would match here.
    const mainChart = await chartSignatureIn(mainPopout, "spectrum");
    const secondChart = await chartSignatureIn(secondPopout, "spectrum");
    expect(mainChart).not.toBe("none");
    expect(secondChart).not.toBe("none");
    expect(secondChart).not.toBe(mainChart);

    // Two windows showing the same tool id, one per project: each is titled after *its
    // own* project (the source's name, while the projects are unnamed). A popout aliased
    // to the wrong project would repeat the other's title.
    const states = await windowStates();
    const titleOf = new Map(states.map((s) => [s.label, s.title]));
    const mainTitle = titleOf.get(mainPopout) ?? "";
    const secondTitle = titleOf.get(secondPopout) ?? "";
    expect(mainTitle).toContain("Spectrum —");
    expect(secondTitle).toContain("Spectrum —");
    expect(secondTitle).not.toBe(mainTitle);
  });

  it("R3 — selecting a popped-out tool raises that project's popout only", async () => {
    await waitForApp();
    second = await ensureSecondWindow();
    await browser.tauri.switchWindow(second);
    await waitForShell();

    // `spectrum` is popped out of *this* project: selecting it must raise the popout
    // instead of opening a duplicate tab (the no-duplicate rule, per project). Note the
    // raw click: `openTool` *requires* a tab to appear, which is exactly what must not
    // happen here (H2 does the same for the same reason).
    const before = await openTabTitles();
    const entry = await $(sidebarTool("spectrum"));
    await entry.waitForExist();
    await entry.click();
    await browser.pause(500); // let the focus_popout round-trip land
    expect(await openTabTitles()).toEqual(before);
    expect(await count(tab("spectrum"))).toBe(0);
    // …and the popout it raised is still the same, live window.
    expect(await windowLabels()).toContain(secondPopout);

    // The other project is untouched — it keeps its own spectrum popout and no tab.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    expect(await openTabTitles()).toEqual([]);
  });

  it("R4 — a shared-param change stays inside its own project", async () => {
    await waitForApp();
    second = await ensureSecondWindow();

    // The same tool is popped out of both projects; each reports its own FFT size.
    const mainBefore = await fftIn(mainPopout);
    const secondBefore = await fftIn(secondPopout);
    expect(mainBefore).toBeGreaterThan(0);
    expect(secondBefore).toBeGreaterThan(0);

    // Change main's shared FFT through its own Toolbar (a popout has no Toolbar).
    await browser.tauri.switchWindow("main");
    await waitForShell();
    const next = await changeFft(mainBefore);

    // It reaches main's own popout — a view of the same project …
    await waitFor(
      async () => (await fftIn(mainPopout)) === next,
      "main's popout did not follow the shared FFT change",
    );
    // … and stops at the project boundary (checked *after* main's re-run has settled).
    expect(await fftIn(secondPopout)).toBe(secondBefore);
  });

  it("R5 — saving and loading in one project leaves the other's unsaved work alone", async () => {
    await waitForApp();
    second = await ensureSecondWindow();

    // main holds unsaved work (its source, and the param change from R4).
    const mainBefore = await textIn("main", SEL.projectName);
    expect(mainBefore.endsWith("*")).toBe(true);

    const tmpFile = path.join(os.tmpdir(), `heylisten-e2e-multi-${Date.now()}.heyl`);
    const label = path.basename(tmpFile, ".heyl");

    // Save the *second* project while main is dirty. The menu emit is targeted at this
    // window, and `app:menu` is listened for per window (`src/lib/windowEvents.ts`), so
    // main runs nothing.
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await mockReturn("pick_project_save_path", tmpFile);
    await menuActionIn(second, "saveAs");
    await waitFor(
      () => Promise.resolve(existsSync(tmpFile)),
      "the project file was never written",
      20_000,
    );
    await waitFor(
      async () => (await textIn(second, SEL.projectName)) === label,
      "the second project did not adopt the saved name",
    );

    // main is untouched by the other window's save: same name, still dirty.
    expect(await textIn("main", SEL.projectName)).toBe(mainBefore);

    // New unsaved work in the second project — the state the load below must not touch.
    const secondFft = await fftIn(secondPopout);
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await changeFft(secondFft);
    await waitFor(
      async () => (await textIn(second, SEL.projectName)).endsWith("*"),
      "the second project did not become dirty after the param change",
    );
    const secondDirty = await textIn(second, SEL.projectName);

    // A popout the loaded project does *not* record — it must close on load (R6).
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openTool("levels");
    await waitForReadouts("levels");
    levelsPopout = await popOutTab("levels");

    // Load that file into *main* while the second project has unsaved work.
    await mockReturn("pick_project_open_path", tmpFile);
    await menuActionIn("main", "open");
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:03"),
      "main did not load the saved project",
      30_000,
    );
    await waitFor(
      async () => (await textOf(SEL.projectName)).trim() === label,
      "main did not adopt the loaded project's name",
      30_000,
    );
    expect((await textOf(SEL.projectName)).trim().endsWith("*")).toBe(false);

    // The other project is exactly as it was: same name, still dirty, same audio.
    expect(await textIn(second, SEL.projectName)).toBe(secondDirty);
    expect(await timelineReadoutText()).toContain("0:03");
  });

  it("R6 — loading a project reconciles its popout windows", async () => {
    // R5 loaded into main a project whose layout records `spectrum` as popped out, while
    // main already had `spectrum` *and* `levels` popped out. The load must leave exactly
    // the project's own popouts: one window per recorded tool, and the extras closed.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await browser.pause(1000); // the reconcile runs on a `setTimeout(0)` tick
    expect(await invokeCore<string[]>("popout_tools")).toEqual(["spectrum"]);
    expect(await windowLabels()).not.toContain(levelsPopout);
  });

  it("R7 — closing a project window closes its own popouts, not the other project's", async () => {
    await waitForApp();
    second = await ensureSecondWindow();
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await closeCurrentWindow();
    // Closing the window the session is *in* leaves the service pinned to a dead label,
    // so point it at a live one before asking for the window list (see `windowLabels`).
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(second), `${second} did not close`);

    const remaining = await windowLabels();
    expect(remaining).not.toContain(secondPopout);
    expect(remaining).toContain(mainPopout);
    second = "";
  });
});
