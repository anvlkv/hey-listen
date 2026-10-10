import type { Setter } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import ChartTooltip from "./ChartTooltip";
import EmptyState from "../EmptyState";
import type { ReframeTarget } from "./ReframeMenu";
import type { UplotZoom } from "./uplotZoom";
import { chartTheme } from "../../state/settings";
import { formatHz } from "../../state/analyzer";

/**
 * Shared bits for the analyzer charts (`waveform` / `spectrum` / `series` /
 * `rhythm` and the `matrix` / `spectrogram` canvases): axis styling, the
 * "nothing to analyse yet" empty state, the time tooltip, the right-click reframe
 * handler, and the visible-range labels. Keeping them here means the views stay
 * consistent and a styling/behaviour change lands in one place. See
 * `docs/analysis-tools.md`.
 */

/** uPlot axis styling for the active theme (read on each chart (re)mount). */
export function chartAxisStyle() {
  const t = chartTheme();
  return { stroke: t.axis, grid: { stroke: t.grid }, ticks: { stroke: t.ticks }, font: t.font };
}

const NO_AUDIO_HINT =
  "Open a file, record, or render a synth from the Source panel — the analysis appears here.";
/** The overlay variant sits over a still-visible chart, so it drops the trailing hint. */
const NO_AUDIO_HINT_OVERLAY = "Open a file, record, or render a synth from the Source panel.";

/**
 * The analyzer "no audio to analyse" empty state. `overlay` renders it over a
 * chart (the canvas heatmaps keep their frame visible behind it).
 */
export function NoAudioState(props: { overlay?: boolean }) {
  return (
    <EmptyState
      icon="∿"
      title="No audio to analyse"
      hint={props.overlay ? NO_AUDIO_HINT_OVERLAY : NO_AUDIO_HINT}
      overlay={props.overlay}
    />
  );
}

/** A time tooltip component (`"t <seconds>"`, `formatY` supplies the per-tool y format). */
export function timeTooltip(formatY: (value: number) => string) {
  return (props: TooltipProps) => (
    <ChartTooltip
      {...props}
      xLabel="t"
      formatX={(value) => `${value.toFixed(3)} s`}
      formatY={formatY}
    />
  );
}

/** `"a – b s"` label for a visible time range, or `""` when there is none. */
export function timeRangeLabel(
  range: [number, number] | { t0: number; t1: number } | null,
): string {
  if (!range) return "";
  const [t0, t1] = Array.isArray(range) ? range : [range.t0, range.t1];
  return `${t0.toFixed(3)} – ${t1.toFixed(3)} s`;
}

/** `"a – b"` label for a visible frequency range (Hz), or `""` when there is none. */
export function frequencyRangeLabel(range: [number, number] | null): string {
  return range ? `${formatHz(range[0])} – ${formatHz(range[1])}` : "";
}

/**
 * Right-click handler that opens the reframe menu at the time under the pointer.
 * `timeAt` maps the event to a time in seconds (or `null` when the pointer is
 * outside the plot, which leaves the menu closed).
 */
export function createReframeHandler(
  timeAt: (event: MouseEvent) => number | null,
  setMenu: Setter<ReframeTarget | null>,
): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    event.preventDefault();
    const time = timeAt(event);
    if (time == null) return;
    setMenu({ x: event.clientX, y: event.clientY, time });
  };
}

/** [`createReframeHandler`] for the uPlot charts, reading the time via `posToVal`. */
export function createUplotReframeHandler(
  zoom: UplotZoom,
  setMenu: Setter<ReframeTarget | null>,
): (event: MouseEvent) => void {
  return createReframeHandler((event) => {
    const u = zoom.instance();
    if (!u || !u.over) return null;
    const rect = u.over.getBoundingClientRect();
    return u.posToVal(event.clientX - rect.left, "x");
  }, setMenu);
}
