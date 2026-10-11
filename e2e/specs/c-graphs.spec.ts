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
import { SEL, graphNode, sidebarTool, tab } from "../support/selectors.ts";
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

/** Set the graph palette's "Search nodes" box (in-page). */
async function setPaletteSearch(value: string): Promise<void> {
  await browser.execute((val: string) => {
    const input = document.querySelector('[aria-label="Search nodes"]') as HTMLInputElement | null;
    if (!input) throw new Error("the palette search box is missing");
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Live check for a palette button whose text contains `text`. */
async function paletteHasButton(text: string): Promise<boolean> {
  return (await browser.execute(
    (sel: string, want: string) =>
      Array.from(document.querySelectorAll(sel)).some((b) =>
        (b.textContent ?? "").includes(want),
      ),
    SEL.graphPaletteBtn,
    text,
  )) as boolean;
}

/** Wait until a palette button whose text contains `text` is present. */
async function waitForPaletteButton(text: string): Promise<void> {
  await waitFor(async () => paletteHasButton(text), `palette node "${text}" never appeared`);
}

/** Add a node from the graph palette, narrowed by the "Search nodes" box. */
async function addPaletteNode(search: string, buttonText: string): Promise<void> {
  await setPaletteSearch(search);
  await waitForPaletteButton(buttonText);
  await browser.execute((sel: string, text: string) => {
    const button = Array.from(document.querySelectorAll(sel)).find((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLElement | undefined;
    button?.click();
  }, SEL.graphPaletteBtn, buttonText);
  await setPaletteSearch("");
}

/** Whether a node kind is reachable in the palette via the search box. */
async function paletteHasNode(search: string, buttonText: string): Promise<boolean> {
  await setPaletteSearch(search);
  const found = await paletteHasButton(buttonText);
  await setPaletteSearch("");
  return found;
}

/**
 * Drag a palette node onto the canvas at a **client** point. The system WebView's
 * native drag-and-drop can't be driven by WebDriver, so — as `pointerDrag` does for
 * pointers — the suite dispatches `dragstart`/`dragover`/`drop` MouseEvents; the
 * editor reads the drop point from `clientX`/`clientY` and runs its real handlers.
 */
async function dragPaletteNode(
  search: string,
  buttonText: string,
  target: { x: number; y: number },
): Promise<void> {
  await setPaletteSearch(search);
  await waitForPaletteButton(buttonText);
  await browser.execute(
    (sel: string, text: string, x: number, y: number) => {
      const button = Array.from(document.querySelectorAll(sel)).find((b) =>
        (b.textContent ?? "").includes(text),
      ) as HTMLElement | null;
      if (!button) throw new Error(`no palette button for ${text}`);
      const canvas = document.querySelector('[data-testid="graph.canvas"]');
      if (!canvas) throw new Error("the graph canvas is missing");
      const fire = (el: EventTarget, type: string) =>
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
          }),
        );
      fire(button, "dragstart");
      fire(canvas, "dragover");
      fire(canvas, "drop");
    },
    SEL.graphPaletteBtn,
    buttonText,
    target.x,
    target.y,
  );
  await setPaletteSearch("");
}

/** Reset the filter graph to its `Input → Output` seed and wait for it to settle. */
async function clearFilterGraph(): Promise<void> {
  await click(SEL.graphClear);
  await waitFor(async () => {
    const hint = await filterHint();
    return hint.includes("2 nodes") && hint.includes("1 link");
  }, "the filter graph did not reset to its seed");
  await waitFor(
    async () => (await count(SEL.graphError)) === 0,
    "the graph error did not clear after the reset",
  );
}

/** Make sure the toolbar Filter switch is on, so graph edits round-trip to the core. */
async function ensureFilterEnabled(): Promise<void> {
  if (!(await filterSwitchOn())) await toggleFilter();
}

/** A client point inside the graph canvas, as a fraction of its size. */
async function canvasPoint(fx: number, fy: number): Promise<{ x: number; y: number }> {
  return (await browser.execute(
    (rx: number, ry: number) => {
      const canvas = document.querySelector('[data-testid="graph.canvas"]');
      if (!canvas) throw new Error("the graph canvas is missing");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width * rx, y: rect.top + rect.height * ry };
    },
    fx,
    fy,
  )) as { x: number; y: number };
}

/**
 * The client midpoint between the seed `Input` source handle and `Output` target
 * handle. The source handle is centred on the Input node's right border and the
 * target handle on the Output node's left border (both at the node's vertical
 * middle), so the node rects are enough — no library-internal handle selectors.
 */
async function seedEdgeMidpoint(): Promise<{ x: number; y: number }> {
  return (await browser.execute((inputSel: string, outputSel: string) => {
    const input = document.querySelector(inputSel);
    const output = document.querySelector(outputSel);
    if (!input || !output) throw new Error("the seed Input/Output nodes are missing");
    const a = input.getBoundingClientRect();
    const b = output.getBoundingClientRect();
    return {
      x: (a.right + b.left) / 2,
      y: (a.top + a.height / 2 + b.top + b.height / 2) / 2,
    };
  }, graphNode("input"), graphNode("output"))) as { x: number; y: number };
}

/** The client centre of the first node of `kind`, or null. */
async function nodeCentre(kind: string): Promise<{ x: number; y: number } | null> {
  return (await browser.execute((sel: string) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, graphNode(kind))) as { x: number; y: number } | null;
}

/** The tiny port labels rendered on the canvas. */
async function portLabels(): Promise<string[]> {
  return (await browser.execute((sel: string) =>
    Array.from(document.querySelectorAll(sel)).map((p) => (p.textContent ?? "").trim()),
    SEL.graphPort,
  )) as string[];
}

/** The filter tab's toolbar hint (node/link counts and applied/bypassed state). */
async function filterHint(): Promise<string> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.textContent ?? "",
    SEL.graphHint,
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
    await ensureFilterEnabled();

    const drop = await seedEdgeMidpoint();
    await dragPaletteNode("gain", "Gain", drop);

    // Spliced: Input → Gain → Output (3 nodes, 2 links), and the core accepts it.
    await waitFor(
      async () => {
        const hint = await filterHint();
        return hint.includes("3 nodes") && hint.includes("2 links");
      },
      "the dropped node was not spliced into the connector",
    );
    await browser.pause(500); // let the debounced set_filter_graph settle
    expect(await count(SEL.graphError)).toBe(0);

    // Leave the project's filter graph as the identity seed for the later specs.
    await clearFilterGraph();
  });
});
