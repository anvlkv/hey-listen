/**
 * Call `listener` whenever the window's device pixel ratio changes; returns a disposer.
 *
 * A canvas sizes its bitmap from `window.devicePixelRatio`, but a `ResizeObserver` only
 * fires on a CSS size change. Dragging the window between a Retina and a non-Retina
 * display changes the DPR alone, so the old bitmap would be stretched and draw at the
 * wrong scale until the next resize. There is no DPR event and a `resolution` media query
 * is one-shot, so re-arm the query for the new ratio after each change.
 */
export function onDevicePixelRatioChange(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};

  let query: MediaQueryList | null = null;

  function arm() {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener("change", onChange);
  }

  function onChange() {
    // The armed query described the ratio we just left; listen for the next one instead.
    query?.removeEventListener("change", onChange);
    arm();
    listener();
  }

  arm();
  return () => {
    query?.removeEventListener("change", onChange);
    query = null;
  };
}
