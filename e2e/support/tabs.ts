/**
 * Workbench tabs (M8).
 *
 * The Workbench is the only tabbed region (managed by `dockview`); these helpers
 * open/focus/close a tool's tab and read the tab strip.
 */
import { sidebarTool, tab } from "./selectors.ts";
import { click, count, waitForSelector } from "./dom.ts";

/** Open a tool from the Sidebar (or focus it if already open). */
export async function openTool(id: string): Promise<void> {
  await waitForSelector(sidebarTool(id), `the sidebar entry for "${id}" is missing`);
  const entry = await $(sidebarTool(id));
  await entry.click();
  try {
    await waitForTab(id, 8_000);
  } catch {
    // A first click can be swallowed while a portal/overlay settles; retry in-page.
    await click(sidebarTool(id));
    await waitForTab(id);
  }
}

/** Focus an already-open tool's tab (dockview unmounts hidden panels, so this
 * re-mounts its content). */
export async function activateTab(id: string): Promise<void> {
  await waitForTab(id);
  await click(tab(id));
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
