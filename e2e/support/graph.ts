/**
 * Graph-editor drivers (M8, rows C1–C8).
 *
 * The filter and synth graphs drive one `solid-flow` editor, so the palette search,
 * the palette drag, and the geometry reads the "add a node" tests need are shared
 * here rather than duplicated per spec. The drag helpers dispatch synthetic
 * `pointer*` events (not HTML5 drag-and-drop — Tauri's native file-drop handler
 * consumes those), matching what the editor's real handlers expect.
 */
import { SEL, graphNode } from "./selectors.ts";
import { click, count, waitFor } from "./dom.ts";

/**
 * The Timeline Filter switch (`SEL.toolbarFilter` — a Kobalte `Switch.Input`). It is
 * visually hidden (`pointer-events: none`), so it must be clicked via script; its
 * pressed state is Kobalte's `data-checked` attribute. The switch reads **on** only
 * while a composed filter exists (the identity seed reads off).
 */
export async function filterSwitchOn(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const input = document.querySelector(sel);
    return !!input && input.hasAttribute("data-checked");
  }, SEL.toolbarFilter)) as boolean;
}

/** Whether the filter graph does more than the `Input → Output` seed. */
export async function filterGraphComposed(): Promise<boolean> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.getAttribute("data-composed") === "true",
    SEL.toolbarFilter,
  )) as boolean;
}

/**
 * Toggle the Filter switch. Enabling a graph with nothing composed keeps the switch
 * off (there is no filter to apply) while opening the filter view, so that case waits
 * for the view instead of for a flip.
 */
export async function toggleFilter(): Promise<void> {
  const before = await filterSwitchOn();
  await click(SEL.toolbarFilter);
  if (!before && !(await filterGraphComposed())) {
    await waitFor(
      async () => (await count(SEL.graphHint)) > 0,
      "enabling an empty filter graph did not open the filter view",
    );
    return;
  }
  await waitFor(
    async () => (await filterSwitchOn()) !== before,
    "the Filter switch did not toggle",
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
      Array.from(document.querySelectorAll(sel)).some((b) => (b.textContent ?? "").includes(want)),
    SEL.graphPaletteBtn,
    text,
  )) as boolean;
}

/** Wait until a palette button whose text contains `text` is present. */
async function waitForPaletteButton(text: string): Promise<void> {
  await waitFor(async () => paletteHasButton(text), `palette node "${text}" never appeared`);
}

/** Add a node from the graph palette, narrowed by the "Search nodes" box. */
export async function addPaletteNode(search: string, buttonText: string): Promise<void> {
  await setPaletteSearch(search);
  await waitForPaletteButton(buttonText);
  await browser.execute(
    (sel: string, text: string) => {
      const button = Array.from(document.querySelectorAll(sel)).find((b) =>
        (b.textContent ?? "").includes(text),
      ) as HTMLElement | undefined;
      button?.click();
    },
    SEL.graphPaletteBtn,
    buttonText,
  );
  await setPaletteSearch("");
}

/** Whether a node kind is reachable in the palette via the search box. */
export async function paletteHasNode(search: string, buttonText: string): Promise<boolean> {
  await setPaletteSearch(search);
  const found = await paletteHasButton(buttonText);
  await setPaletteSearch("");
  return found;
}

/**
 * Drag a palette node onto the canvas at a **client** point. The editor drives the
 * drag with **pointer** events (not HTML5 drag-and-drop — Tauri's native file-drop
 * handler consumes those), so — as `pointerDrag` does — the suite dispatches
 * `pointerdown`/`pointermove`/`pointerup`; the editor reads the drop point from
 * `clientX`/`clientY` and runs its real handlers.
 */
export async function dragPaletteNode(
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
      const rect = button.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, cy: number, buttons: number) =>
        button.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons,
          }),
        );
      fire("pointerdown", startX, startY, 1);
      fire("pointermove", startX + 2, startY + 2, 1); // past the drag threshold
      fire("pointermove", x, y, 1);
      fire("pointerup", x, y, 0);
    },
    SEL.graphPaletteBtn,
    buttonText,
    target.x,
    target.y,
  );
  await setPaletteSearch("");
}

/** Reset the filter graph to its `Input → Output` seed and wait for it to settle. */
export async function clearFilterGraph(): Promise<void> {
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
export async function ensureFilterEnabled(): Promise<void> {
  if (!(await filterSwitchOn())) await toggleFilter();
}

/** A client point inside the graph canvas, as a fraction of its size. */
export async function canvasPoint(fx: number, fy: number): Promise<{ x: number; y: number }> {
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
export async function seedEdgeMidpoint(): Promise<{ x: number; y: number }> {
  return (await browser.execute(
    (inputSel: string, outputSel: string) => {
      const input = document.querySelector(inputSel);
      const output = document.querySelector(outputSel);
      if (!input || !output) throw new Error("the seed Input/Output nodes are missing");
      const a = input.getBoundingClientRect();
      const b = output.getBoundingClientRect();
      return {
        x: (a.right + b.left) / 2,
        y: (a.top + a.height / 2 + b.top + b.height / 2) / 2,
      };
    },
    graphNode("input"),
    graphNode("output"),
  )) as { x: number; y: number };
}

/** The client centre of the first node of `kind`, or null. */
export async function nodeCentre(kind: string): Promise<{ x: number; y: number } | null> {
  return (await browser.execute((sel: string) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, graphNode(kind))) as { x: number; y: number } | null;
}

/** The tiny port labels rendered on the canvas. */
export async function portLabels(): Promise<string[]> {
  return (await browser.execute(
    (sel: string) =>
      Array.from(document.querySelectorAll(sel)).map((p) => (p.textContent ?? "").trim()),
    SEL.graphPort,
  )) as string[];
}

/** The filter tab's toolbar hint (node/link counts and applied/bypassed state). */
export async function filterHint(): Promise<string> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.textContent ?? "",
    SEL.graphHint,
  )) as string;
}
