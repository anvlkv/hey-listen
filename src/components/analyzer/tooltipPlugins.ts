import type { Component } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import {
  tooltip as solidTooltip,
  type CursorPluginMessageBus,
  type FocusSeriesPluginMessageBus,
  type TooltipProps,
} from "@dschz/solid-uplot/plugins";
import { onceReady } from "../../lib/uplotHooks";

/** The tooltip options `@dschz/solid-uplot` accepts (it does not export the type). */
type TooltipOptions = Parameters<typeof solidTooltip>[1];

/**
 * The `tooltip` plugin from `@dschz/solid-uplot/plugins`, safe to destroy **before the
 * chart is ready** — see [`onceReady`](../../lib/uplotHooks.ts) for the crash it prevents
 * and why it is not ours to fix upstream.
 *
 * Every analyzer and compare chart takes its tooltip from here, so the guard is
 * impossible to forget in one view.
 */
export const tooltip = (
  Component: Component<TooltipProps>,
  options?: TooltipOptions,
): UplotPluginFactory<CursorPluginMessageBus & FocusSeriesPluginMessageBus> => {
  const create = solidTooltip(Component, options);
  return (context) => onceReady(create(context));
};
