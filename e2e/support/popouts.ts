/**
 * Driving a Workbench tab's dockview context menu: right-click → "Pop out to window".
 *
 * The system WebView does not synthesise a `contextmenu` event from WebDriver pointer
 * actions, so it is dispatched directly (dockview binds its own listener). The popout is
 * a real Tauri window, and one app instance is reused across spec files — so a spec that
 * pops a window out owns closing it (see `windows.ts` → `closeWindowsMatching`).
 */
import { tab } from "./selectors.ts";
import { waitFor } from "./dom.ts";
import { windowLabels } from "./windows.ts";

/** The dockview context-menu item that moves a tab into its own window. */
const POPOUT_ITEM = "Pop out to window";

/** Right-click an element (the WebView won't synthesise `contextmenu` from a click). */
async function rightClick(selector: string): Promise<void> {
  const el = await $(selector);
  await el.waitForExist();
  await browser.execute((sel: string) => {
    const target = document.querySelector(sel) as HTMLElement | null;
    if (!target) throw new Error(`rightClick: no element for ${sel}`);
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
        buttons: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, selector);
}

/**
 * Pop a tool's Workbench tab out into its own window and return that window's label.
 *
 * Runs against the **window the session is currently in**, so the popout is a view of
 * *that* window's project. The label is discovered by diffing `listWindows()`, since the
 * app's parent↔popout alias lives in Rust and is not exposed to the suite.
 *
 * The caller still owns the tab-side assertion (`tab(id)` is gone from the Workbench) and
 * closing the window; see `docs/testing.md` → H2.
 */
export async function popOutTab(toolId: string): Promise<string> {
  const before = new Set(await windowLabels());
  await rightClick(tab(toolId));

  const menu = await $(".dv-context-menu");
  await menu.waitForExist();
  const items = await menu.$$(".dv-context-menu-item");
  let popped = false;
  for (const item of items) {
    if ((await item.getText()).trim() === POPOUT_ITEM) {
      await item.click();
      popped = true;
      break;
    }
  }
  if (!popped) throw new Error(`the tab context menu had no "${POPOUT_ITEM}" for "${toolId}"`);

  let label = "";
  await waitFor(async () => {
    label = (await windowLabels()).find((l) => /^popout-\d+$/.test(l) && !before.has(l)) ?? "";
    return label !== "";
  }, `no popout-* window appeared for "${toolId}"`);
  return label;
}
