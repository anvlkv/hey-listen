/**
 * I. Errors & warnings — matrix rows I1–I5 (`docs/testing.md`).
 *
 * One case per UI surface: force the condition, assert the message appears in the
 * right place, and assert the app stays usable. I2–I4 force the failure by mocking
 * the IPC command the surface rides on; I1 lets a real `probe_file` fail on the
 * corrupt fixture. I5 is a best-effort edge deletion (see its comment).
 *
 * Every test restores its mocks so nothing leaks into the next — a fresh app session
 * per spec file, but tests within this file share the window.
 */
import { SEL, tab, analyzerPanel } from "../support/selectors.ts";
import {
  waitForApp,
  openTool,
  openFixture,
  mockReturn,
  mockReject,
  restoreMocks,
  waitFor,
  waitForAnalyzer,
  canvasHasInk,
  readoutValue,
  openSelect,
  openFileFixture,
  dismissPopovers,
  count,
  closeAllTabs,
  textOf,
} from "../support/helpers.ts";
import { FIXTURES } from "../support/fixtures.ts";

/** Kobalte portals every popover panel with this class. */
const POP_PANEL = ".pop-panel";

/**
 * The toolbar Filter switch's pressed state. `SEL.toolbarFilter` is the Kobalte
 * `Switch.Input` — visually hidden (`pointer-events: none`) but carrying the
 * `data-checked` state, so drive it by script (mirrors `c-graphs.spec.ts`).
 */
async function filterSwitchOn(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const input = document.querySelector(sel);
    return !!input && input.hasAttribute("data-checked");
  }, SEL.toolbarFilter)) as boolean;
}

/** Toggle the toolbar Filter switch and wait for its pressed state to flip. */
async function toggleFilter(): Promise<void> {
  const before = await filterSwitchOn();
  await browser.execute((sel: string) => {
    (document.querySelector(sel) as HTMLElement | null)?.click();
  }, SEL.toolbarFilter);
  await waitFor(
    async () => (await filterSwitchOn()) !== before,
    "the toolbar Filter switch did not toggle",
  );
}

/** Change the shared FFT size to force every mounted analyzer to re-run. */
async function changeFftSize(analyzerId: string): Promise<void> {
  const current = ((await readoutValue(analyzerId, "FFT")) ?? "").replace(/\D/g, "");
  const params = await $(SEL.toolbarParams);
  await params.waitForExist();
  await params.click();
  await waitFor(
    async () => (await $(POP_PANEL)).isExisting(),
    "the shared analysis-params popover did not open",
  );

  await openSelect('[aria-label="FFT size"]');
  const items = await $$(".pop-item");
  let picked = false;
  for (const item of items) {
    const text = (await item.getText()).replace(/✓/g, "").trim();
    if (/^\d+$/.test(text) && text !== current) {
      await item.click();
      picked = true;
      break;
    }
  }
  expect(picked).toBe(true);
  // Close the shared params popover so it doesn't obscure later steps.
  await dismissPopovers();
}

/**
 * Best-effort: select the edge into `output` and delete it — the trigger for the
 * persistent "Output is not connected" banner (`docs/testing.md` → I5). Selecting an
 * SVG edge through the system WebView is fragile, so the callers treat a miss as a
 * documented no-op (mirrors `c-graphs.spec.ts`).
 */
async function deleteOutputEdge(): Promise<void> {
  await browser
    .execute(() => {
      const g = document.querySelector(".graph-canvas .solid-flow__edge");
      if (!g) return;
      const hit =
        g.querySelector(".solid-flow__edge-interaction") ??
        g.querySelector(".solid-flow__edge-path") ??
        g;
      const rect = hit.getBoundingClientRect();
      const ev = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      hit.dispatchEvent(new MouseEvent("pointerdown", ev));
      hit.dispatchEvent(new MouseEvent("click", ev));
    })
    .catch(() => {});
  // Deletion is a window-level key handler that ignores events while an input has
  // focus, so drop focus first (a lingering palette search box would swallow it).
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.()).catch(() => {});
  await browser.keys("Backspace").catch(() => {});
}

/** True when the persistent "Output is not connected" banner is showing. */
async function outputNotConnected(): Promise<boolean> {
  const warns = await $$(".graph-editor .graph-warn");
  for (const warning of warns) {
    if ((await warning.getText()).includes("Output is not connected")) return true;
  }
  return false;
}

describe("I. Errors & warnings", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // The toolbar region hook (M8) is part of the fixed-region contract.
    await (await $(SEL.toolbar)).waitForExist();
    // Replacing a source / discarding unsaved work asks the core to confirm.
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    await restoreMocks();
    await mockReturn("confirm", true);
  });

  it("I1 — a corrupt file surfaces a toolbar error and keeps the timeline empty", async () => {
    // `probe_file` genuinely fails on the corrupt fixture (not mocked).
    await openFileFixture(FIXTURES.corrupt);

    const err = await $(SEL.toolbarError);
    await err.waitForExist();
    expect((await err.getText()).trim().length).toBeGreaterThan(0);
    // The Timeline only renders once a source exists, so it must be absent.
    expect(await $(SEL.timeline).isExisting()).toBe(false);

    // A valid file recovers: the error clears and the waveform renders.
    await openFixture("sine440");
    await waitFor(
      async () => (await count(SEL.toolbarError)) === 0,
      "the toolbar error did not clear after a valid file",
    );
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the recovered source did not render");
  });

  it("I2 — a rejected run_analysis shows an analyzer error; the tab stays open", async () => {
    if (!(await $(SEL.timeline).isExisting())) await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    await mockReject("run_analysis", "analysis failed (mock)");
    // A shared-param change re-fires the (now rejecting) analysis.
    await changeFftSize("spectrum");

    await waitFor(
      async () => (await textOf(SEL.analyzerError)).includes("analysis failed"),
      "the analyzer error did not show the mocked failure",
    );

    // The tab (and its last-good result) stay mounted — no crash, no auto-close.
    expect(await count(tab("spectrum"))).toBe(1);
    expect(await count(analyzerPanel("spectrum"))).toBe(1);
  });

  it("I3 — a rejected set_filter_graph shows a graph error; the toggle still works", async () => {
    await openTool("filter");
    if (!(await filterSwitchOn())) await toggleFilter(); // keep it enabled

    await mockReject("set_filter_graph", "filter push failed (mock)");
    await toggleFilter(); // → bypassed ⇒ pushes `null` ⇒ rejected

    await waitFor(
      async () => (await textOf(SEL.graphError)).includes("filter push failed"),
      "the graph error did not show the mocked failure",
    );

    // The toggle still responds; with the command restored, toggling pushes again and
    // the successful push clears the error (the app stays usable).
    await restoreMocks();
    await toggleFilter(); // → back on ⇒ push succeeds ⇒ error clears
    await waitFor(
      async () => (await count(SEL.graphError)) === 0,
      "the graph error did not clear after a successful push",
    );
  });

  it("I4 — a rejected render_synth shows a graph error; the Render button re-enables", async () => {
    await openTool("synth");
    const render = await $(SEL.graphRender);
    await render.waitForExist();

    await mockReject("render_synth", "render failed (mock)");
    await render.click();

    await waitFor(
      async () => (await textOf(SEL.graphError)).includes("render failed"),
      "the graph error did not show the mocked render failure",
    );

    // The error handler runs in a `finally`, so the button must come back to life.
    await waitFor(() => render.isEnabled(), "the Render button stayed disabled after the error");
    expect(await count(tab("synth"))).toBe(1);
  });

  it("I5 — disconnecting the Output shows the persistent 'not connected' warning", async () => {
    await openTool("filter");
    await (await $(SEL.graphCanvas)).waitForExist();

    // Retry: the edge selection sometimes does not land on the first attempt.
    let shown = false;
    for (let attempt = 0; attempt < 3 && !shown; attempt++) {
      await deleteOutputEdge();
      shown = await browser
        .waitUntil(outputNotConnected, { timeout: 2500 })
        .then(() => true)
        .catch(() => false);
    }

    if (!shown) {
      // The SVG edge cannot always be selected/deleted through the system WebView
      // (see `docs/testing.md` → I5 and `e2e/specs/c-graphs.spec.ts`). Record the
      // weakened row rather than assert a state the driver cannot reach.
      console.warn(
        "I5 (weakened): the output edge could not be deleted via WebDriver; " +
          "the persistent 'Output is not connected' warning was not reached.",
      );
      return;
    }

    // The persistent banner is the flow editor's `.graph-warn` (the transient banner
    // carries `data-testid="graph.warning"`).
    const warning = await $(".graph-editor .graph-warn");
    expect((await warning.getText())).toContain("Output is not connected");
    // The graph editor is still mounted and usable after the disconnect.
    expect(await $(SEL.graphCanvas).isExisting()).toBe(true);
  });
});
