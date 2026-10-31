/**
 * Driving the M25 compare view from the suite: opening a comparison from a tab's
 * context menu, changing its reference, and popping it out.
 *
 * A compare view is a transient Workbench tab (`compare:<tool>`) — or its native
 * popout — owned by the **project window the session is in**, so every helper here
 * runs against the current window.
 */
import { SEL, tab } from "./selectors.ts";
import { count, mockReturn, openFixture, openTool, waitFor, waitForShell } from "./helpers.ts";
import type { FIXTURES } from "./fixtures.ts";
import { canvasHasInk } from "./analyzers.ts";
import { dismissPopovers, openSelect, pickOption } from "./popups.ts";
import { rightClick } from "./popouts.ts";
import { windowLabels, openProjectWindow } from "./windows.ts";

/** The dockview context-menu items the compare view adds. */
export const COMPARE_ITEM = "Compare with…";
export const CHANGE_REFERENCE_ITEM = "Change reference…";
export const POPOUT_ITEM = "Pop out to window";

/** Click the context-menu item labelled `label` in the open dockview tab menu. */
async function clickTabMenuItem(label: string): Promise<void> {
  const menu = await $(".dv-context-menu");
  await menu.waitForExist();
  const items = await menu.$$(".dv-context-menu-item");
  for (const item of items) {
    if ((await item.getText()).trim() === label) {
      await item.click();
      return;
    }
  }
  throw new Error(`the tab context menu had no "${label}" item`);
}

/** Pick `targetLabel` in the open Compare-with dialog. */
async function pickTarget(targetLabel: string): Promise<void> {
  const target = await $(`[data-testid="compare.target.${targetLabel}"]`);
  await target.waitForExist();
  await target.click();
}

/**
 * Open a **new** project window showing `fixture`, then return to main.
 *
 * The compare specs need a second (or third) project with its own source; the new
 * window is left open and the session returns to `main`.
 */
export async function openProjectWithFixture(fixture: keyof typeof FIXTURES): Promise<string> {
  const label = await openProjectWindow();
  await browser.tauri.switchWindow(label);
  await waitForShell();
  await mockReturn("confirm", true);
  await openFixture(fixture);
  await browser.tauri.switchWindow("main");
  await waitForShell();
  return label;
}

/**
 * Open `tool` in main and compare it with `reference` through the tab menu.
 *
 * Not `waitForAnalyzer`: a family's analyzer view legitimately shows its empty state
 * for one fixture (no notes / no modulation), which is not a failure here.
 */
export async function compareToolFromMain(tool: string, reference: string): Promise<void> {
  await browser.tauri.switchWindow("main");
  await waitForShell();
  await openTool(tool);
  await waitFor(async () => (await count(tab(tool))) === 1, `the ${tool} tab did not open`);
  await compareFromTabMenu(tool, reference);
  await waitFor(
    async () => (await count(compareView(tool))) === 1,
    `the ${tool} compare view did not open`,
  );
}

/** The compare view's root (the header + chart), per tool. */
export const compareView = (tool: string) => `[data-testid="compare.${tool}"]`;

/** The compare tab's panel id for a tool. */
export function compareTab(toolId: string): string {
  return `compare:${toolId}`;
}

/** The comparability badge. */
export const BADGE = '[data-testid="compare.badge"]';

/**
 * What a compare view is showing right now: its canvases (with their sizes) and its
 * text. A chart that never draws is either not mounted, zero-sized, an empty state, or
 * an error — this tells the four apart in the failure message.
 */
async function describeCompare(tool: string): Promise<string> {
  return (await browser.execute((sel: string) => {
    const root = document.querySelector(sel) as HTMLElement | null;
    if (!root) return "the compare view is not in the DOM";
    const canvases = Array.from(root.querySelectorAll("canvas")).map((canvas) => {
      const c = canvas as HTMLCanvasElement;
      return `${c.width}x${c.height}`;
    });
    const rect = root.getBoundingClientRect();
    const text = (root.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    const box = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    return `view=${box} canvases=[${canvases.join(", ")}] text="${text}"`;
  }, compareView(tool))) as string;
}

/** Wait until a compare view has a live comparison and its chart has drawn ink. */
export async function waitForCompareChart(tool: string): Promise<void> {
  const chart = `${compareView(tool)} canvas`;
  try {
    await waitFor(() => canvasHasInk(chart), `the ${tool} compare chart never drew`);
  } catch (error) {
    throw new Error(`${error}\n${await describeCompare(tool)}`, { cause: error });
  }
}

/** The comparability badge: its text and the mismatch list it carries as a tooltip. */
export async function badge(): Promise<{ text: string; title: string }> {
  return (await browser.execute((selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    return { text: (el?.textContent ?? "").trim(), title: el?.title ?? "" };
  }, BADGE)) as { text: string; title: string };
}

/** Wait for a badge text, reporting the mismatch list when it never arrives. */
export async function waitForBadge(expected: string): Promise<void> {
  try {
    await waitFor(
      async () => (await badge()).text === expected,
      `the compare badge never read "${expected}"`,
    );
  } catch (error) {
    const info = await badge();
    throw new Error(`${error}\nbadge="${info.text}" mismatches="${info.title}"`, { cause: error });
  }
}

/** Set the shared FFT size through the current window's Toolbar popover. */
export async function setFft(value: string): Promise<void> {
  await (await $(SEL.toolbarParams)).click();
  await browser.waitUntil(async () => (await $(".pop-panel")).isExisting(), {
    timeoutMsg: "the shared analysis-params popover did not open",
  });
  await openSelect('[aria-label="FFT size"]');
  await pickOption(value);
  await dismissPopovers();
}

/**
 * Compare an analyzer tab with another project, via the tab menu.
 *
 * `targetLabel` is the reference project's **window label** (a `list_projects` label).
 */
export async function compareFromTabMenu(toolId: string, targetLabel: string): Promise<void> {
  await rightClick(tab(toolId));
  await clickTabMenuItem(COMPARE_ITEM);
  const dialog = await $('[data-testid="compare.picker"]');
  await dialog.waitForExist();
  await pickTarget(targetLabel);
  await waitFor(
    async () => (await $(tab(compareTab(toolId)))).isExisting(),
    "the compare tab did not open",
  );
}

/**
 * Record page-level errors from now on.
 *
 * A click whose effect never appears usually means a render threw (Solid reports it as
 * an unhandled rejection, which WebDriver otherwise swallows) — so the failure below
 * can say *why* instead of just timing out.
 */
async function watchErrors(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as { __compareErrors?: string[] };
    w.__compareErrors = [];
    const record = (text: string) => w.__compareErrors?.push(text);
    window.addEventListener("unhandledrejection", (event) =>
      record(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`),
    );
    window.addEventListener("error", (event) => record(`error: ${event.message}`));
    const original = console.error;
    console.error = (...args: unknown[]) => {
      record(`console.error: ${args.map(String).join(" ")}`);
      original(...args);
    };
  });
}

/** The errors recorded since [`watchErrors`]. */
async function watchedErrors(): Promise<string[]> {
  return (await browser.execute(
    () => (window as unknown as { __compareErrors?: string[] }).__compareErrors ?? [],
  )) as string[];
}

/** Change an open compare tab's reference through its own tab menu. */
export async function changeReference(toolId: string, targetLabel: string): Promise<void> {
  await watchErrors();
  await rightClick(tab(compareTab(toolId)));
  await clickTabMenuItem(CHANGE_REFERENCE_ITEM);
  const dialog = await $('[data-testid="compare.picker"]');
  try {
    await dialog.waitForExist();
  } catch (error) {
    const errors = await watchedErrors();
    const why = errors.length > 0 ? `: ${errors.join("; ")}` : "";
    throw new Error(`the reference picker never opened${why}`, { cause: error });
  }
  await pickTarget(targetLabel);
}

/** Pop a compare tab into its native compare window; returns the new window's label. */
export async function popOutCompareTab(toolId: string): Promise<string> {
  const before = new Set(await windowLabels());
  await rightClick(tab(compareTab(toolId)));
  await clickTabMenuItem(POPOUT_ITEM);
  let label = "";
  await waitFor(async () => {
    label = (await windowLabels()).find((l) => /^compare-\d+$/.test(l) && !before.has(l)) ?? "";
    return label !== "";
  }, "no compare-* window appeared");
  return label;
}
