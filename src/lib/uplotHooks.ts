import type uPlot from "uplot";

/**
 * Gate a plugin's `destroy` hooks on the chart having **readied**.
 *
 * uPlot fires `ready` from a microtask commit, so a chart that is created and torn down
 * in the same task never readies. `@dschz/solid-uplot`'s `tooltip` builds its Solid root
 * in `ready` and its `destroy` calls that root's disposer unconditionally, so such a
 * chart throws `TypeError: dispose is not a function` out of `u.destroy()`. That error
 * escapes the panel's teardown: dockview's `fromJSON` → `clear` (a project load) aborts,
 * the saved Workbench layout is lost and its compare tabs never become the active panel.
 *
 * Nothing is lost by skipping the hook in that case — the tooltip owns no state until
 * `ready` runs, and uPlot removes the chart's root (with the tooltip inside it) before
 * firing `destroy`. `u.status` stays `0` until `ready`, so it is the exact signal.
 *
 * A plugin without a `destroy` hook is returned untouched (the library hands back
 * `{ hooks: {} }` for a chart with no plugin bus). Drop this once the library guards its
 * own `destroy` (`@dschz/solid-uplot` 0.5.2 is the latest release).
 */
export function onceReady(plugin: uPlot.Plugin): uPlot.Plugin {
  const destroy = plugin.hooks?.destroy;
  if (!destroy) return plugin;
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      // uPlot accepts one hook or an array of them; wrap either shape.
      destroy: Array.isArray(destroy) ? destroy.map(whenReady) : whenReady(destroy),
    },
  };
}

/** Run `hook` only when the chart readied, so an unset disposer is never called. */
function whenReady(hook?: (u: uPlot) => void): (u: uPlot) => void {
  return (u) => {
    if (u.status > 0) hook?.(u);
  };
}
