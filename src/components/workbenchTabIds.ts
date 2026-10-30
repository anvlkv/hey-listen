import type { DockviewApi } from "dockview";

/**
 * Stamp `data-testid="tab.<panelId>"` on each dockview tab, so the E2E suite can address
 * an individual Workbench tab (`e2e/support/selectors.ts` → `tab(id)`).
 *
 * Dockview gives tabs no stable hook of their own, so each `.dv-tab` is matched to its
 * panel by title. A panel whose title changes at runtime (a compare tab gains its two
 * project names) is re-stamped by the observer installed through
 * [`observeTabIds`], so the matcher and the DOM agree again.
 */
export function stampTabIds(api: DockviewApi) {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>(".dv-tabs-container .dv-tab"));
  for (const panel of api.panels) {
    const title = panel.title ?? panel.id;
    for (const el of tabs) {
      const content = el.querySelector(".dv-default-tab-content");
      const label = (content?.textContent ?? el.textContent ?? "")
        .replace(/[\s\u00d7]+$/, "")
        .trim();
      if (label === title) {
        el.dataset.testid = `tab.${panel.id}`;
        break;
      }
    }
  }
}

/**
 * Stamp tab test ids once the tab DOM has settled, retrying briefly.
 *
 * This must **not** use `requestAnimationFrame`: WebKit throttles animation frames —
 * and can pause them entirely — while the window is occluded, which is the norm under
 * E2E/CI (a headless display: macOS runners and Linux `xvfb`). `requestAnimationFrame`
 * would then never run, leaving every tab unstamped and every tab-addressing test
 * failing. `setTimeout` still fires when occluded.
 */
export function scheduleStampTabIds(api: DockviewApi) {
  let attempts = 0;
  const tick = () => {
    stampTabIds(api);
    attempts += 1;
    const missing = api.panels.some(
      (panel) => !document.querySelector(`[data-testid="tab.${panel.id}"]`),
    );
    if (missing && attempts < 40) window.setTimeout(tick, 25);
  };
  window.setTimeout(tick, 0);
}

/**
 * Keep the stamps correct for the Workbench's lifetime.
 *
 * A layout restore (`fromJSON`) and a runtime title change both re-render dockview's
 * tabs *after* the panel events fire, so the retry loop above can finish too early —
 * leaving a tab with no stamp, which the suite then cannot address (e.g. a tab restored
 * by opening a project). Watching the Workbench subtree for **child and text** changes
 * (deliberately not attributes, so writing the stamp cannot re-trigger the observer)
 * stamps each tab whenever the DOM settles.
 *
 * Returns a disposer.
 */
export function observeTabIds(api: DockviewApi, root: HTMLElement): () => void {
  if (typeof MutationObserver === "undefined") {
    scheduleStampTabIds(api);
    return () => {};
  }
  const observer = new MutationObserver(() => stampTabIds(api));
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  scheduleStampTabIds(api);
  return () => observer.disconnect();
}
