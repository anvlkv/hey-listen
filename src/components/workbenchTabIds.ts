import type { DockviewApi } from "dockview";

/**
 * Stamp `data-testid="tab.<panelId>"` on each dockview tab, so the E2E suite can address
 * an individual Workbench tab (`e2e/support/selectors.ts` → `tab(id)`).
 *
 * Dockview gives tabs no stable hook of their own, so each `.dv-tab` is matched to its
 * panel by title. A panel whose title changes at runtime (a compare tab gains its two
 * project names) re-runs [`scheduleStampTabIds`] after the change, so the matcher and the
 * DOM agree again.
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
