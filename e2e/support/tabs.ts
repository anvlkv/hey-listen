/**
 * Workbench tabs (M8).
 *
 * The Workbench is the only tabbed region (managed by `dockview`); these helpers
 * open/focus/close a tool's tab and read the tab strip.
 */
import { activityTab, sidebarTool, tab } from "./selectors.ts";
import { click, count, waitForSelector } from "./dom.ts";
import { ANALYZER_TOOLS } from "./tools.ts";

/** The activity-bar tab a tool lives under: its section, or `graph` for the editors. */
function tabFor(id: string): string {
  if (id === "filter" || id === "synth") return "graph";
  const tool = ANALYZER_TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`unknown tool: ${id}`);
  return tool.section;
}

/** Switch the activity bar to a tool's tab (its section, or `graph`). */
export async function activateToolSection(id: string): Promise<void> {
  const tabId = tabFor(id);
  await waitForSelector(activityTab(tabId), `the activity-bar tab "${tabId}" is missing`);
  // Selecting the tab whose cards are already showing **collapses** the rail (the tab is
  // its own toggle), so click only when this section's cards are not showing — the
  // button's `aria-pressed` means "this section is showing".
  const showing = await browser.execute(
    (sel: string) => document.querySelector(sel)?.getAttribute("aria-pressed") === "true",
    activityTab(tabId),
  );
  if (showing === true) return;
  await click(activityTab(tabId));
}

/** Open a tool from the Sidebar (switch to its tab, then click its card). */
export async function openTool(id: string): Promise<void> {
  await activateToolSection(id);
  const entry = sidebarTool(id);
  await waitForSelector(entry, `the sidebar entry for "${id}" is missing`);
  const target = await $(entry);
  await target.click();
  try {
    await waitForTab(id, 8_000);
  } catch {
    // A first click can be swallowed while a portal/overlay settles; retry in-page.
    await click(entry);
    await waitForTab(id);
  }
}

/**
 * Focus an already-open tool's tab.
 *
 * dockview activates a tab on **pointerdown** (it coordinates with its drag backend),
 * so a plain `click()` leaves the target panel hidden — and dockview only mounts the
 * visible panel, so its content never appears. Dispatch the gesture the tab listens for.
 */
export async function activateTab(id: string): Promise<void> {
  await waitForTab(id);
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`no element for ${sel}`);
    const rect = el.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
  }, tab(id));
}

/** Close a tool's dockview tab (via the tab's close button). */
export async function closeTool(id: string): Promise<void> {
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    const button = el?.querySelector(".dv-default-tab-action") as HTMLElement | null;
    button?.click();
  }, tab(id));
}

/** Close every open Workbench tab (used to reset between spec files). */
export async function closeAllTabs(): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const remaining = await count(".dv-default-tab-action");
    if (remaining === 0) return;
    await browser.execute(() => {
      document
        .querySelectorAll(".dv-default-tab-action")
        .forEach((button) => (button as HTMLElement).click());
    });
    await browser.pause(150);
  }
}

/** The title text of every open Workbench tab. */
export async function openTabTitles(): Promise<string[]> {
  return (await browser.execute(() =>
    Array.from(document.querySelectorAll(".dv-tab")).map((t) =>
      (t.textContent ?? "").replace(/[\s\u00d7]+$/, "").trim(),
    ),
  )) as string[];
}

/** Wait until a tool's tab exists (stamped with `data-testid="tab.<id>"`). */
export async function waitForTab(id: string, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => (await count(tab(id))) > 0, {
    timeout,
    timeoutMsg: `tab for "${id}" did not open`,
  });
}

/** True when a tool's tab is open. */
export async function isToolOpen(id: string): Promise<boolean> {
  return (await count(tab(id))) > 0;
}
