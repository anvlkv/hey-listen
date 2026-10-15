/**
 * Kobalte popups (M8): Select / Combobox triggers, their portal items, and
 * popover dismissal. Kobalte portals panels to the body, so these read the DOM
 * in-page rather than through element handles.
 */
import { SEL } from "./selectors.ts";
import { click, count, waitForSelector } from "./dom.ts";

/** Open a Kobalte Select/Combobox trigger, tolerating WebView click quirks. */
export async function openSelect(trigger: string): Promise<void> {
  await waitForSelector(trigger, `the control "${trigger}" is missing`);
  await click(trigger);
  try {
    await browser.waitUntil(async () => (await count(".pop-item")) > 0, { timeout: 2_000 });
    return;
  } catch {
    // Fall back to synthesized pointer events: Kobalte opens on pointerdown.
    await browser.execute((sel: string) => {
      const target = document.querySelector(sel);
      if (!target) return;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const event = type.startsWith("pointer")
          ? new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: 1,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            })
          : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1 });
        target.dispatchEvent(event);
      }
    }, trigger);
  }
  await browser.waitUntil(async () => (await count(".pop-item")) > 0, {
    timeoutMsg: `the popup for "${trigger}" did not open`,
  });
}

/** Click a Kobalte popup option by its label (portal items carry `.pop-item`). */
export async function pickOption(label: string): Promise<void> {
  const clicked = (await browser.execute((wanted: string) => {
    const items = Array.from(document.querySelectorAll(".pop-item"));
    for (const item of items) {
      const text = (item.textContent ?? "").replace(/✓/g, "").trim();
      if (text === wanted || text.startsWith(wanted)) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, label)) as boolean;
  if (!clicked) throw new Error(`popup option "${label}" not found`);
}

/** Click a popover trigger, assert its panel opened, then dismiss it (by toggling). */
export async function openThenClosePopover(trigger: string): Promise<void> {
  await click(trigger);
  await browser.waitUntil(async () => (await count(".pop-panel")) > 0, {
    timeoutMsg: `popover "${trigger}" did not open`,
  });
  await dismissPopovers();
}

/** Dismiss any open Kobalte popover/select (robust across WebView quirks). */
export async function dismissPopovers(): Promise<void> {
  if ((await count(".pop-panel")) === 0) return;
  await browser.execute(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  if ((await count(".pop-panel")) > 0) await click(SEL.toolbar);
  await browser.waitUntil(async () => (await count(".pop-panel")) === 0, {
    timeoutMsg: "a popover did not close",
  });
}
