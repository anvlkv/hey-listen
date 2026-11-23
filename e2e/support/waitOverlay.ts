/**
 * Paint every harness wait (E2E).
 *
 * A run spends most of its wall time inside `browser.waitUntil`, and an idle WebView gives
 * no clue whether the suite is thinking or wedged. This module wraps that command
 * (`wdio.conf.ts` → `before`) so the window being driven wears a dull yellow hazard pattern
 * while a wait runs, with the wait's own `timeoutMsg` in the corner. A wait that **times
 * out** leaves the pattern and its label up, so the failure screenshot (`wdio.conf.ts` →
 * `afterTest`) says what the suite was waiting for; `afterTest` clears it afterwards.
 *
 * Deliberately **static**: WebKit throttles — and can pause — animations while the window
 * is occluded, which is the norm under CI (see `docs/testing.md` → Selectors). A pattern
 * that stops moving would read as settled, which is the one thing it must not say.
 *
 * Scope: the pattern is painted in the **window the session currently addresses**, because
 * a WebDriver script runs in one window. The main window paints for nearly every wait; a
 * popout paints while a wait runs in it. Painting every window at once would need the core
 * to broadcast. The element `waitFor*` commands go through `@wdio/utils` rather than this
 * command, and those waits are short.
 */
import { withRetry } from "./dom.ts";

/** The injected style's id; passing it in keeps the in-page script self-contained. */
const STYLE_ID = "e2e-wait-style";

/**
 * The overlay: `::after` is the pattern (dull yellow diagonals over whatever the theme
 * paints, blended so neither theme loses its contrast), `::before` is the wait's reason.
 */
const WAIT_CSS = `
html[data-e2e-wait]::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  background: repeating-linear-gradient(
    -45deg,
    rgba(214, 176, 0, 0.3) 0 18px,
    transparent 18px 36px
  );
  box-shadow: inset 0 0 0 2px rgba(214, 176, 0, 0.28);
  mix-blend-mode: overlay;
}
html[data-e2e-wait]::before {
  content: attr(data-e2e-wait);
  position: fixed;
  inset-inline-end: 12px;
  inset-block-end: 12px;
  z-index: 2147483647;
  max-width: 70vw;
  padding: 4px 10px;
  border-radius: 4px;
  background: rgba(255, 208, 0, 0.92);
  color: #241b00;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}`;

/** The subset of WDIO's wait options this module reads. */
type WaitOptions = { timeout?: number; timeoutMsg?: string; interval?: number };

/** WDIO's `waitUntil`, as the overwrite wrapper receives it. */
type WaitCommand = (condition: () => Promise<boolean>, options?: WaitOptions) => Promise<unknown>;

/** How many waits are open (a condition may itself call `waitFor`). */
let depth = 0;

/** Paint (`text`) or clear (`null`) the overlay in the current window. */
async function paint(text: string | null): Promise<void> {
  try {
    // The same stall retry our other in-page reads get: the first script after
    // `switchWindow` can hang until the command timeout while the next answers at once.
    await withRetry(() =>
      browser.execute(
        (label: string | null, css: string, id: string) => {
          if (!document.getElementById(id)) {
            const style = document.createElement("style");
            style.id = id;
            style.textContent = css;
            document.head.append(style);
          }
          const root = document.documentElement;
          if (label === null) root.removeAttribute("data-e2e-wait");
          else root.setAttribute("data-e2e-wait", label);
        },
        text,
        WAIT_CSS,
        STYLE_ID,
      ),
    );
  } catch {
    // Painting must never fail — or slow — a wait: the window may be booting or gone.
  }
}

/** Wrap `browser.waitUntil` so the driven window is painted for as long as it waits. */
export function installWaitOverlay(): void {
  const client = browser as unknown as {
    overwriteCommand?: (
      name: string,
      command: (
        original: WaitCommand,
        condition: () => Promise<boolean>,
        options?: WaitOptions,
      ) => Promise<unknown>,
    ) => void;
    __e2eWaitOverlay?: boolean;
  };
  if (client.__e2eWaitOverlay) return;
  if (typeof client.overwriteCommand !== "function") {
    console.warn("[e2e] waits are not painted: browser.overwriteCommand is unavailable");
    return;
  }
  client.__e2eWaitOverlay = true;
  client.overwriteCommand("waitUntil", async (original, condition, options) => {
    depth += 1;
    if (depth === 1) await paint(`waiting · ${options?.timeoutMsg ?? "a condition"}`);
    try {
      return await original(condition, options);
    } catch (err) {
      depth = 0; // a timeout keeps its label up for the failure screenshot
      throw err;
    } finally {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) await paint(null);
      }
    }
  });
}

/** Drop a label a timed-out wait left up (called after the failure screenshot). */
export async function clearWaitOverlay(): Promise<void> {
  depth = 0;
  await paint(null);
}
