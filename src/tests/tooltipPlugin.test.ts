import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";
import { onceReady } from "../lib/uplotHooks";

/**
 * The `destroy` guard over `@dschz/solid-uplot`'s plugins (M23 review): a chart that is
 * created and torn down in one task never fires `ready`, and the library's tooltip then
 * calls an unset disposer. That throw escapes the panel teardown and aborts a Workbench
 * layout restore, so the guard is pinned here rather than only in the E2E suite.
 */

/** A uPlot stand-in: the guard reads `status` and nothing else. */
const chart = (status: number) => ({ status }) as uPlot;

/** A plugin whose `destroy` records the uPlot it was called with. */
function tracked() {
  const destroy = vi.fn();
  return { destroy, plugin: { hooks: { destroy } } as uPlot.Plugin };
}

describe("the tooltip plugin's destroy guard", () => {
  it("skips destroy until the chart has readied", () => {
    const { destroy, plugin } = tracked();
    const guarded = onceReady(plugin);
    if (typeof guarded.hooks.destroy !== "function") throw new Error("destroy was dropped");

    guarded.hooks.destroy(chart(0));
    expect(destroy).not.toHaveBeenCalled();

    guarded.hooks.destroy(chart(1));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("guards every hook of an array and keeps them all", () => {
    const first = vi.fn();
    const second = vi.fn();
    const plugin = { hooks: { destroy: [first, second] } } as uPlot.Plugin;
    const guarded = onceReady(plugin);
    const hooks = guarded.hooks.destroy;
    if (!Array.isArray(hooks)) throw new Error("an array of hooks became a single hook");

    for (const hook of hooks) hook?.(chart(0));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    for (const hook of hooks) hook?.(chart(1));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("returns a plugin without a destroy hook untouched", () => {
    const plugin = { hooks: {} } as uPlot.Plugin;
    expect(onceReady(plugin)).toBe(plugin);
  });
});
