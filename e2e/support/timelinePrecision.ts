/**
 * Timeline precision & accessibility helpers (D-11 / D-12 / D-14).
 *
 * The Timeline's **right-click menu** and its **canvas keyboard surface** are driven the way
 * the app listens for them — with in-page events — because W3C pointer/keyboard actions do not
 * reliably reach the system WebView (see `dom.ts`). Two app behaviours shape the helpers:
 *
 * - Kobalte's `MenuItemBase` runs a menu item's action on **`pointerup`** with the primary
 *   button, so a synthetic `click()` never selects anything: the menu item needs a
 *   `pointerdown`/`pointerup` pair. A `CheckboxItem` closes the menu on select like any other
 *   item, so a toggle is "open the menu, click the item, wait for the menu to go".
 * - The canvas keyboard map is a `keydown` handler on the focusable `role="application"`
 *   canvas, so a key press is a bubbling `KeyboardEvent` dispatched on that element.
 *
 * The menu content is unmounted while closed (`MenuContentBase` renders it behind `Show`), so
 * "closed" is always a DOM count of zero rather than a `data-closed` attribute.
 */
import { SEL } from "./selectors.ts";
import { click, count, waitForSelector } from "./dom.ts";

/** The menu content's test id — one constant, so every wait reads what the spec asserts on. */
const MENU = SEL.timelineMenu;

/** Wait until `selector` matches nothing (a closed menu or popover is unmounted). */
async function waitForGone(selector: string, timeoutMsg: string, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => (await count(selector)) === 0, { timeout, timeoutMsg });
}

/**
 * Right-click the Timeline canvas at a fraction of its box; waits for the menu.
 *
 * The context menu's pointer time comes from a capture-phase `contextmenu` listener on the
 * canvas wrapper, and Kobalte opens on the same event — so a `contextmenu` dispatched at the
 * wanted `clientX` both records the time and opens the menu, exactly as a real right-click.
 */
export async function openTimelineMenu(fx = 0.5, fy = 0.5): Promise<void> {
  await browser.execute(
    (sel: string, x: number, y: number) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("openTimelineMenu: no timeline canvas");
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
          button: 2,
          buttons: 2,
        }),
      );
    },
    SEL.timelineCanvas,
    fx,
    fy,
  );
  await waitForSelector(MENU, "the timeline context menu did not open");
}

/**
 * Activate a Kobalte menu item: `pointerdown` + `pointerup` (primary button, mouse).
 *
 * Kobalte's item selects on `pointerup` (`button === 0`) — not on `click` — so the events are
 * dispatched at the element's centre with a mouse pointer. A plain item closes the menu
 * (`closeOnSelect`), which is awaited; a **checkbox** item keeps the menu open
 * (`closeOnSelect: false`), so a toggle is read back in place and dismissed by the caller.
 */
export async function clickMenuItem(selector: string, closes = true): Promise<void> {
  const dispatched = (await browser.execute((sel: string) => {
    const item = document.querySelector(sel) as HTMLElement | null;
    if (!item) return false;
    const rect = item.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const fire = (type: string, buttons: number) =>
      item.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons,
        }),
      );
    fire("pointerdown", 1);
    fire("pointerup", 0);
    return true;
  }, selector)) as boolean;
  if (!dispatched) throw new Error(`clickMenuItem: no menu item for ${selector}`);
  if (!closes) return;
  await waitForGone(MENU, `the menu did not close after selecting ${selector}`);
}

/**
 * Dismiss the open menu with `Escape` and wait for it to leave the DOM.
 *
 * The press goes to the menu content so it bubbles to Kobalte's document-level dismiss
 * listener, which is what closes the layer.
 */
export async function closeTimelineMenu(): Promise<void> {
  await browser.execute((sel: string) => {
    const menu = document.querySelector(sel);
    if (!menu) return;
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  }, MENU);
  await waitForGone(MENU, "the timeline context menu did not close on Escape");
}

/** Whether the Timeline canvas is the document's focused element. */
async function canvasFocused(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    return document.activeElement === document.querySelector(sel);
  }, SEL.timelineCanvas)) as boolean;
}

/** Focus the Timeline canvas (it is the focusable `role="application"` element). */
export async function focusTimeline(): Promise<void> {
  await browser.execute((sel: string) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!canvas) throw new Error("focusTimeline: no timeline canvas");
    canvas.focus();
  }, SEL.timelineCanvas);
  await browser.waitUntil(canvasFocused, {
    timeoutMsg: "the timeline canvas never took focus",
  });
}

/**
 * Dispatch a bubbling `keydown` on the Timeline canvas.
 *
 * `shift` selects the coarse step (ten grid steps) the canvas keyboard map documents; the
 * event bubbles so the app's delegated listener on the document sees it.
 */
export async function pressOnTimeline(key: string, shift = false): Promise<void> {
  await browser.execute(
    (sel: string, name: string, shiftKey: boolean) => {
      const canvas = document.querySelector(sel);
      if (!canvas) throw new Error("pressOnTimeline: no timeline canvas");
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
      );
    },
    SEL.timelineCanvas,
    key,
    shift,
  );
}

/**
 * Set a text/number input's value, fire `input`, then `Enter` (the form's commit path).
 *
 * The window fields keep their draft in local state and commit on `Enter`, so the value is
 * written on the DOM node and announced with a bubbling `input` first — the app's own
 * handlers then run, exactly as they do while typing.
 */
export async function setInputValue(selector: string, value: string): Promise<void> {
  const found = (await browser.execute(
    (sel: string, text: string) => {
      const input = document.querySelector(sel) as HTMLInputElement | null;
      if (!input) return false;
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      return true;
    },
    selector,
    value,
  )) as boolean;
  if (!found) throw new Error(`setInputValue: no input for ${selector}`);
}

/**
 * Dismiss the numeric-window popover, then wait for its fields to leave the DOM.
 *
 * `Escape` is dispatched on the **document body**: the fields' own `Escape` handler reverts
 * the draft and calls `stopImmediatePropagation`, so a press aimed at a field never reaches
 * the popover, while the body is not on the field's event path and Kobalte's document-level
 * dismiss listener closes the layer. A synthetic key can be swallowed while the WebView is
 * busy (see `dom.ts`), so the trigger — which toggles the same popover — is the second route.
 */
export async function closeWindowPopover(): Promise<void> {
  await browser.execute(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  try {
    await waitForGone(SEL.windowEnd, "the numeric window popover did not close", 5_000);
    return;
  } catch {
    // Still open: fall through to the trigger, which toggles it shut.
  }
  await click(SEL.timelineWindowEdit);
  await waitForGone(SEL.windowEnd, "the numeric window popover did not close");
}
