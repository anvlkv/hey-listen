/**
 * In-page DOM primitives (M8).
 *
 * **Prefer `browser.execute` DOM reads to element handles inside `waitUntil` polls** —
 * element-handle commands occasionally stall in WKWebView, so counts, clicks and
 * readouts are done in-page. `waitFor` and `pointerDrag` sit here too: they are
 * generic and shared by every other helper module.
 */

/** Count elements matching a selector via a raw DOM read. */
export async function count(selector: string): Promise<number> {
  return (await browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    selector,
  )) as number;
}

/** Like [`count`], scoped to descendants of `scopeSelector`. */
export async function countWithin(scopeSelector: string, selector: string): Promise<number> {
  return (await browser.execute(
    (scope: string, sel: string) => {
      const root = document.querySelector(scope);
      return root ? root.querySelectorAll(sel).length : 0;
    },
    scopeSelector,
    selector,
  )) as number;
}

/** The text content of the first element matching `selector` (`""` if absent). */
export async function textOf(selector: string): Promise<string> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.textContent ?? "",
    selector,
  )) as string;
}

/** Click the first element matching `selector` (in-page, no element handle). */
export async function click(selector: string): Promise<void> {
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`no element for ${sel}`);
    el.click();
  }, selector);
}

/** Poll until `selector` matches at least one element. */
export async function waitForSelector(selector: string, timeoutMsg: string, timeout = 15_000) {
  await browser.waitUntil(async () => (await count(selector)) > 0, { timeout, timeoutMsg });
}

/** Wait for a condition with a friendly message. */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMsg: string,
  timeout = 15_000,
): Promise<void> {
  await browser.waitUntil(condition, { timeout, timeoutMsg });
}

/**
 * Drag an element by (dx, dy) from its centre, driving the app's `pointer*`
 * handlers. W3C pointer actions don't reliably produce Pointer Events inside the
 * system WebView, so we dispatch them directly (still the app's real handlers).
 */
export async function pointerDrag(selector: string, dx: number, dy: number): Promise<void> {
  await browser.execute(
    (sel: string, offX: number, offY: number) => {
      const target = document.querySelector(sel) as HTMLElement | null;
      if (!target) throw new Error(`pointerDrag: no element for ${sel}`);
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, cy: number, buttons: number) => {
        target.dispatchEvent(
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
      };
      fire("pointerdown", x, y, 1);
      fire("pointermove", x + offX, y + offY, 1);
      fire("pointerup", x + offX, y + offY, 0);
    },
    selector,
    dx,
    dy,
  );
}
