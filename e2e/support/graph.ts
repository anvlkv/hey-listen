/**
 * Graph-editor drivers (M8, rows C1–C8).
 *
 * The filter and synth graphs drive one `solid-flow` editor, so the palette search,
 * the palette drag, and the geometry reads the "add a node" tests need are shared
 * here rather than duplicated per spec. The drag helpers dispatch synthetic
 * `pointer*` events (not HTML5 drag-and-drop — Tauri's native file-drop handler
 * consumes those), matching what the editor's real handlers expect.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { SEL, graphNode } from "./selectors.ts";
import { click, count, waitFor } from "./dom.ts";
import { mockReturn } from "./ipc.ts";
import { CLI_BINARY } from "./fixtures.ts";
import type { ToolResult } from "./mcp.ts";

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
    if (!input) return; // the palette is gone (a closed tab or a failed test)
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Page-side key holding the element a palette drag started on. */
const DRAG_HANDLE = "__e2e_palette_drag__";

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
 * Start a palette drag (pointer events, not HTML5 drag-and-drop — Tauri's native
 * file-drop handler consumes those). Leaves the drag held so a spec can inspect the
 * ghost/drop preview, then [`paletteDragTo`], [`paletteDragRelease`] or
 * [`paletteDragCancel`] finishes it.
 */
export async function beginPaletteDrag(search: string, buttonText: string): Promise<void> {
  await setPaletteSearch(search);
  await waitForPaletteButton(buttonText);
  await browser.execute(
    (sel: string, text: string, key: string) => {
      const button = Array.from(document.querySelectorAll(sel)).find((b) =>
        (b.textContent ?? "").includes(text),
      ) as HTMLElement | null;
      if (!button) throw new Error(`no palette button for ${text}`);
      const rect = button.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      (globalThis as unknown as Record<string, unknown>)[key] = { button, startX, startY };
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX,
          clientY: startY,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1,
        }),
      );
    },
    SEL.graphPaletteBtn,
    buttonText,
    DRAG_HANDLE,
  );
}

/** Move the held palette drag to a client point (past the drag threshold on the way). */
export async function paletteDragTo(x: number, y: number): Promise<void> {
  await browser.execute(
    (key: string, tx: number, ty: number) => {
      const drag = (globalThis as unknown as Record<string, unknown>)[key] as
        { button: HTMLElement; startX: number; startY: number } | undefined;
      if (!drag) throw new Error("no palette drag is in progress");
      const fire = (cx: number, cy: number) =>
        drag.button.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 1,
          }),
        );
      fire(drag.startX + 8, drag.startY + 8); // past the drag threshold
      fire(tx, ty);
    },
    DRAG_HANDLE,
    x,
    y,
  );
}

/** Release the held palette drag at a client point (the real drop uses this point). */
export async function paletteDragRelease(x: number, y: number): Promise<void> {
  await browser.execute(
    (key: string, tx: number, ty: number) => {
      const drag = (globalThis as unknown as Record<string, unknown>)[key] as
        { button: HTMLElement } | undefined;
      if (!drag) throw new Error("no palette drag is in progress");
      delete (globalThis as unknown as Record<string, unknown>)[key];
      drag.button.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: tx,
          clientY: ty,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 0,
        }),
      );
    },
    DRAG_HANDLE,
    x,
    y,
  );
  await setPaletteSearch("");
}

/** Cancel the held palette drag (Escape/pointercancel semantics), if one is in progress. */
export async function paletteDragCancel(): Promise<void> {
  await browser.execute((key: string) => {
    const drag = (globalThis as unknown as Record<string, unknown>)[key] as
      { button: HTMLElement } | undefined;
    if (!drag) return;
    delete (globalThis as unknown as Record<string, unknown>)[key];
    drag.button.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
    );
  }, DRAG_HANDLE);
  await setPaletteSearch("");
}

/** Drag a palette node onto the canvas at a **client** point (start → move → release). */
export async function dragPaletteNode(
  search: string,
  buttonText: string,
  target: { x: number; y: number },
): Promise<void> {
  await beginPaletteDrag(search, buttonText);
  await paletteDragTo(target.x, target.y);
  await paletteDragRelease(target.x, target.y);
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

// --- DOT interchange (M39): import, export, the CLI and the hint helper -----------

/** Import a graph into the active editor (the file dialog is stubbed to `source`). */
export async function importGraph(source: string): Promise<void> {
  await mockReturn("pick_graph_file", source);
  await click(SEL.graphImport);
}

/** Export the active editor's graph (the save dialog is stubbed to `destination`). */
export async function exportGraph(destination: string): Promise<string> {
  await mockReturn("pick_save_path", destination);
  await click(SEL.graphExport);
  await waitFor(() => Promise.resolve(existsSync(destination)), "the DOT export was never written");
  return readFileSync(destination, "utf8");
}

/** Run the CLI sidecar; a missing build is a clear failure, not a cryptic ENOENT. */
export function runCli(args: string[]): string {
  if (!existsSync(CLI_BINARY)) {
    throw new Error(`the CLI sidecar is missing at ${CLI_BINARY} — run \`npm run tauri build\``);
  }
  return execFileSync(CLI_BINARY, args, { encoding: "utf8", maxBuffer: 8 << 20 });
}

/** Fail with the tool's own message when an MCP call reports an error. */
export function expectToolOk(result: ToolResult): void {
  if (result.isError) {
    throw new Error(`the MCP tool failed: ${result.content?.[0]?.text ?? "(no message)"}`);
  }
}

/** Wait until the active graph editor reports `text` in its toolbar hint. */
export async function waitForHint(text: string, failure: string): Promise<void> {
  await waitFor(async () => (await filterHint()).includes(text), failure);
}
