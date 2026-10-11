/**
 * C. Graph editors (M8) — matrix rows C1–C4 (`docs/testing.md`).
 *
 * The filter and synth graphs share one `solid-flow` editor (`GraphEditor`) and a
 * module-scope store (`src/state/graph.ts`), so a graph — and the project's single
 * source — persists across the tests in this file (one app window per project).
 *
 * Building `input → lowpass → output` by dragging handle-to-handle is fragile in the
 * system WebView, so C1 is **structural**: it asserts the default seed compiles
 * cleanly and that adding a node keeps the canvas rendering without a `graph.error`,
 * rather than simulating a drag. Clicks and reads go through `browser.execute` to
 * avoid the element-handle stalls WKWebView occasionally produces.
 */
import { SEL, sidebarTool, tab } from "../support/selectors.ts";
import {
  waitForApp,
  waitFor,
  openTool,
  mockReturn,
  mockReject,
  invokeCore,
  waitForSourceLoaded,
  openFixture,
  canvasHasInk,
  restoreMocks,
  click,
  count,
  textOf,
} from "../support/helpers.ts";

/**
 * The toolbar Filter switch (`SEL.toolbarFilter` — a Kobalte `Switch.Input`). It is
 * visually hidden (`pointer-events: none`), so it must be clicked via script; its
 * pressed state is Kobalte's `data-checked` attribute.
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
  await click(SEL.toolbarFilter);
  await waitFor(
    async () => (await filterSwitchOn()) !== before,
    "the toolbar Filter switch did not toggle",
  );
}

/** Add a node from the graph palette, narrowed by the "Search nodes" box. */
async function addPaletteNode(search: string, buttonText: string): Promise<void> {
  const setSearch = (value: string) =>
    browser.execute(
      (val: string) => {
        const input = document.querySelector('[aria-label="Search nodes"]') as HTMLInputElement | null;
        if (!input) throw new Error("the palette search box is missing");
        input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value,
    );

  await setSearch(search);
  await waitFor(
    async () =>
      (await browser.execute(
        (text: string) =>
          Array.from(document.querySelectorAll(".graph-palette-btn")).some((b) =>
            (b.textContent ?? "").includes(text),
          ),
        buttonText,
      )) as boolean,
    `palette node "${buttonText}" never appeared`,
  );
  await browser.execute((text: string) => {
    const button = Array.from(document.querySelectorAll(".graph-palette-btn")).find((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLElement | undefined;
    button?.click();
  }, buttonText);
  await setSearch("");
}

/** The filter tab's toolbar hint (node/link counts and applied/bypassed state). */
async function filterHint(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".graph-toolbar-hint")?.textContent ?? "",
  )) as string;
}

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:04.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

describe("C. Graph editors", () => {
  before(async () => {
    await waitForApp();
  });

  after(async () => {
    await restoreMocks();
  });

  it("C1 — the filter graph renders and compiles", async () => {
    // A source gives the (identity) filter a signal to condition.
    await openFixture("sine440");

    await openTool("filter");
    expect(await count(tab("filter"))).toBe(1);
    expect(await count(sidebarTool("filter"))).toBe(1);

    // The container the `solid-flow` graph is rendered in.
    await waitFor(async () => (await count(SEL.graphCanvas)) > 0, "the graph canvas did not render");

    // The default `Input → Output` seed is pushed to the core; it must compile
    // cleanly (a failure would surface the graph tab's error banner).
    expect(await count(SEL.graphError)).toBe(0);

    // A direct core check of the same identity graph (belt-and-braces with the UI).
    await invokeCore("set_filter_graph", {
      spec: {
        nodes: [
          { id: "in", kind: "input", params: [] },
          { id: "out", kind: "output", params: [] },
        ],
        edges: [{ from: "in", fromPort: 0, to: "out", toPort: 0 }],
      },
    });

    // Drag-to-wire `input → lowpass → output` is fragile in the WebView, so cover
    // the editor + core round-trip structurally: add a node from the palette and
    // assert the canvas keeps rendering and the graph still compiles. (An unwired
    // node is valid — the core only requires the anchors and the edges to be sound.)
    await addPaletteNode("low-pass", "Low-pass");
    await waitFor(
      async () => (await filterHint()).includes("3 node"),
      "the added node never appeared in the filter graph",
    );
    // Let the debounced `set_filter_graph` round-trip settle before asserting.
    await browser.pause(500);
    await waitFor(async () => (await count(SEL.graphCanvas)) > 0, "the graph canvas vanished");
    expect(await count(SEL.graphError)).toBe(0);

    // The Clear hook is part of this milestone's selector contract.
    expect(await count(SEL.graphClear)).toBe(1);
  });

  it("C2 — the toolbar Filter switch toggles bypass without error", async () => {
    await openTool("filter"); // focus the tab opened in C1

    expect(await filterSwitchOn()).toBe(true); // the project default is enabled

    await toggleFilter(); // → bypassed
    expect(await filterSwitchOn()).toBe(false);
    expect(await count(SEL.graphError)).toBe(0);

    await toggleFilter(); // → back on (leave enabled for C4)
    expect(await filterSwitchOn()).toBe(true);
    expect(await count(SEL.graphError)).toBe(0);
  });

  it("C3 — the synth graph renders its PCM to the timeline", async () => {
    await openTool("synth");
    expect(await count(tab("synth"))).toBe(1);

    // The default seed is `sine → output`; render it to the timeline.
    await click(SEL.graphRender);
    await waitForSourceLoaded();

    // A source already existed, so confirm the render replaced it: the default 4 s
    // length lands on the timeline, drawn from the synth PCM.
    await waitFor(
      async () => (await timelineReadout()).includes("0:04"),
      "the rendered synth (4 s) never replaced the timeline source",
    );
    expect(await count(SEL.graphError)).toBe(0);
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the synth PCM never rendered");
  });

  it("C4 — a rejected graph change surfaces an error and stays usable", async () => {
    await openTool("filter");

    // Keep the filter enabled so a graph edit pushes a real spec (not `null`).
    if (!(await filterSwitchOn())) await toggleFilter();

    // Force the core to reject every `set_filter_graph` round-trip.
    await mockReject("set_filter_graph", "graph rejected by test");

    // Changing the graph now fails to reach the core → the tab shows `graph.error`.
    await addPaletteNode("high-pass", "High-pass");
    await waitFor(
      async () => (await count(SEL.graphError)) > 0,
      "the graph error did not appear after a rejected push",
    );
    expect((await textOf(SEL.graphError)).trim().length).toBeGreaterThan(0);

    // No crash: the canvas keeps rendering and the bypass toggle still responds.
    expect(await count(SEL.graphCanvas)).toBe(1);
    const before = await filterSwitchOn();
    await toggleFilter();
    expect(await filterSwitchOn()).toBe(!before);
    expect(await count(SEL.graphError)).toBe(1); // still latched
  });
});
