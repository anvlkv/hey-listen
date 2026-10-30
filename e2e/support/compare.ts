/**
 * Driving the M25 compare view from the suite: opening a comparison from a tab's
 * context menu, changing its reference, and popping it out.
 *
 * A compare view is a transient Workbench tab (`compare:<tool>`) — or its native
 * popout — owned by the **project window the session is in**, so every helper here
 * runs against the current window.
 */
import { tab } from "./selectors.ts";
import { waitFor } from "./dom.ts";
import { rightClick } from "./popouts.ts";
import { windowLabels } from "./windows.ts";

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

/** The compare tab's panel id for a tool. */
export function compareTab(toolId: string): string {
  return `compare:${toolId}`;
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
