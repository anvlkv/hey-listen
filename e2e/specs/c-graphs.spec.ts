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
 *
 * The graph-specific drivers (palette search, palette drags, port labels, geometry)
 * live in `e2e/support/graph.ts`; C5–C8 stay in this file — and in order — because
 * they share the one app window's graph state.
 */
import { SEL, sidebarTool, tab } from "../support/selectors.ts";
import {
  waitForApp,
  waitFor,
  openTool,
  mockReject,
  invokeCore,
  waitForSourceLoaded,
  openFixture,
  canvasHasInk,
  restoreMocks,
  click,
  count,
  textOf,
  timelineReadoutText,
} from "../support/helpers.ts";
import {
  addPaletteNode,
  canvasPoint,
  clearFilterGraph,
  dragPaletteNode,
  ensureFilterEnabled,
  filterHint,
  filterSwitchOn,
  nodeCentre,
  paletteHasNode,
  portLabels,
  seedEdgeMidpoint,
  toggleFilter,
} from "../support/graph.ts";

describe("C. Graph editors", () => {
  before(async () => {
    await waitForApp();
  });

  // Restore the dialog defaults after every test, so a mock a test set (e.g. C4's
  // `set_filter_graph` rejection) can never leak into the next one.
  afterEach(async () => {
    await restoreMocks();
  });

  it("C1 — the filter graph renders and compiles", async () => {
    // A source gives the (identity) filter a signal to condition.
    await openFixture("sine440");

    await openTool("filter");
    expect(await count(tab("filter"))).toBe(1);
    expect(await count(sidebarTool("filter"))).toBe(1);

    // The container the `solid-flow` graph is rendered in.
    await waitFor(
      async () => (await count(SEL.graphCanvas)) > 0,
      "the graph canvas did not render",
    );

    // The default `Input → Output` seed is not applied (it is an identity pass-through);
    // a failed push would still surface the graph tab's error banner.
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

    expect(await filterSwitchOn()).toBe(true); // C1 composed a filter, so it reads on

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
      async () => (await timelineReadoutText()).includes("0:04"),
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

  it("C5 — the math nodes are offered and compile in the core", async () => {
    await openTool("filter");
    await clearFilterGraph();

    const math: [string, string][] = [
      ["add", "Add"],
      ["subtract", "Subtract"],
      ["multiply", "Multiply"],
      ["divide", "Divide"],
      ["min", "Minimum"],
      ["max", "Maximum"],
      ["abs", "Absolute"],
      ["invert", "Invert"],
    ];
    for (const [search, label] of math) {
      expect(await paletteHasNode(search, label)).toBe(true);
    }

    // A math node compiles in the core (direct round-trip): input → multiply ← dc.
    // An unknown kind would reject, failing this invoke.
    await invokeCore("set_filter_graph", {
      spec: {
        nodes: [
          { id: "in", kind: "input", params: [] },
          { id: "k", kind: "dc", params: [0.5] },
          { id: "mul", kind: "multiply", params: [] },
          { id: "out", kind: "output", params: [] },
        ],
        edges: [
          { from: "in", fromPort: 0, to: "mul", toPort: 0 },
          { from: "k", fromPort: 0, to: "mul", toPort: 1 },
          { from: "mul", fromPort: 0, to: "out", toPort: 0 },
        ],
      },
    });
    expect(await count(SEL.graphCanvas)).toBe(1);

    // The direct invoke set the core's active filter; clear it again so no later
    // analyzer runs against it (the next test's clear would, but be explicit).
    await invokeCore("set_filter_graph", { spec: null });
  });

  it("C6 — nodes carry tiny input/output port labels", async () => {
    await openTool("filter");
    await clearFilterGraph();

    // The seed anchors label their single port: Input → out, Output → in.
    const seed = await portLabels();
    expect(seed).toContain("in");
    expect(seed).toContain("out");

    // A binary math node labels its two inputs A and B.
    await addPaletteNode("multiply", "Multiply");
    await waitFor(
      async () => (await portLabels()).includes("A"),
      "the multiply node never showed its port labels",
    );
    const labels = await portLabels();
    expect(labels).toContain("A");
    expect(labels).toContain("B");
  });

  it("C7 — dragging a palette node drops it where it is released", async () => {
    await openTool("filter");
    await clearFilterGraph();

    const drop = await canvasPoint(0.55, 0.8); // empty area, away from the seed edge
    await dragPaletteNode("gain", "Gain", drop);

    await waitFor(
      async () => (await filterHint()).includes("3 nodes"),
      "the dragged node never appeared on the canvas",
    );
    // Dropped off a connector: no splice, the seed link is untouched.
    expect(await filterHint()).toContain("1 link");

    // Centred on the cursor (generous screen tolerance for node/zoom rounding).
    const centre = await nodeCentre("gain");
    expect(centre).not.toBeNull();
    expect(Math.abs(centre!.x - drop.x)).toBeLessThan(60);
    expect(Math.abs(centre!.y - drop.y)).toBeLessThan(60);
  });

  it("C8 — dropping a node onto a connector splices it in", async () => {
    await openTool("filter");
    await clearFilterGraph();

    const drop = await seedEdgeMidpoint();
    await dragPaletteNode("gain", "Gain", drop);
    // The graph now does something, so the switch follows (it reads off on the seed).
    await ensureFilterEnabled();

    // Spliced: Input → Gain → Output (3 nodes, 2 links), and the core accepts it.
    await waitFor(async () => {
      const hint = await filterHint();
      return hint.includes("3 nodes") && hint.includes("2 links");
    }, "the dropped node was not spliced into the connector");
    await browser.pause(500); // let the debounced set_filter_graph settle
    expect(await count(SEL.graphError)).toBe(0);

    // Leave the project's filter graph as the identity seed for the later specs.
    await clearFilterGraph();
  });
});
