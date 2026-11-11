/**
 * In-page DOM primitives (M8).
 *
 * **Prefer `browser.execute` DOM reads to element handles inside `waitUntil` polls** —
 * element-handle commands occasionally stall in WKWebView, so counts, clicks and
 * readouts are done in-page. `waitFor` and `pointerDrag` sit here too: they are
 * generic and shared by every other helper module.
 */

/**
 * How many attempts an in-page read gets before a stall is a failure. The macOS stall is
 * one-shot: the second attempt answers in milliseconds (see [`withRetry`]).
 */
const PAGE_ATTEMPTS = 3;

/** Whether `err` is WebDriver's script timeout (the in-page script stalled), not a page error. */
function isScriptTimeout(err: unknown): boolean {
  return err instanceof Error && /Script execution timed out/i.test(err.message);
}

/**
 * Retry an in-page **read** that the embedded driver stalled.
 *
 * On macOS a script addressed to a window that was **just created** (an analyzer popout, an
 * annotation window, a comparison popout) can hang until WebDriver's script timeout fires —
 * 30 s, the `commandTimeout` in `wdio.conf.ts` — and the very next attempt answers in
 * milliseconds. That is how H2, R2.6 and N3 flaked in CI: always the first read after
 * `switchWindow`. Retrying here (with a warning, so the stall stays visible in the run log)
 * keeps a *genuine* hang a failure while the one-shot stall no longer fails a spec.
 *
 * Reads only. A stalled *gesture* may well have run before its reply was lost, so re-sending
 * a `click` could act twice — those helpers stay single-shot.
 */
async function withRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      if (attempt >= PAGE_ATTEMPTS || !isScriptTimeout(err)) throw err;
      console.warn(`[e2e] an in-page script timed out; retrying (${attempt}/${PAGE_ATTEMPTS - 1})`);
    }
  }
}

/** Count elements matching a selector via a raw DOM read. */
export async function count(selector: string): Promise<number> {
  return (await withRetry(() =>
    browser.execute((sel: string) => document.querySelectorAll(sel).length, selector),
  )) as number;
}

/** Like [`count`], scoped to descendants of `scopeSelector`. */
export async function countWithin(scopeSelector: string, selector: string): Promise<number> {
  return (await withRetry(() =>
    browser.execute(
      (scope: string, sel: string) => {
        const root = document.querySelector(scope);
        return root ? root.querySelectorAll(sel).length : 0;
      },
      scopeSelector,
      selector,
    ),
  )) as number;
}

/** The text content of the first element matching `selector` (`""` if absent). */
export async function textOf(selector: string): Promise<string> {
  return (await withRetry(() =>
    browser.execute((sel: string) => document.querySelector(sel)?.textContent ?? "", selector),
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

/**
 * Dispatch a wheel gesture at the centre of an element (`deltaY < 0` zooms in).
 * Charts and the Timeline listen for `wheel` on a canvas/element rather than the DOM
 * scroll container, so the event is dispatched at the element's centre.
 */
export async function wheelOver(selector: string, deltaY: number): Promise<void> {
  await browser.execute(
    (sel: string, delta: number) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error(`wheelOver: no element for ${sel}`);
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: delta,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    selector,
    deltaY,
  );
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
