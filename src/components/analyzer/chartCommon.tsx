import { createSignal, type JSX, type Setter } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import ChartTooltip from "./ChartTooltip";
import EmptyState from "../EmptyState";
import ZoomControls from "./ZoomControls";
import type { ReframeTarget } from "./ReframeMenu";
import type { UplotZoom } from "./uplotZoom";
import { chartTheme } from "../../state/themes";
import { formatHz } from "../../state/analyzer";
import { axisToHz, type FrequencyScale } from "./frequencyScale";

/**
 * Shared bits for the analyzer charts (`waveform` / `spectrum` / `series` /
 * `rhythm` and the `matrix` / `spectrogram` canvases): axis styling, the chart surface
 * and its zoom chrome, the "nothing to analyse yet" empty state, the time tooltip, the
 * right-click reframe handler, and the visible-range labels. Keeping them here means the
 * views stay consistent and a styling/behaviour change lands in one place. See
 * `docs/analysis-tools.md`.
 */

/** uPlot axis styling for the active theme (read on each chart (re)mount). */
export function chartAxisStyle() {
  const t = chartTheme();
  // The grid is one role fainter than the axis/tick strokes: it orients without
  // competing with the data, and it can be toned down from the theme alone (M36).
  return {
    stroke: t.axis,
    grid: { stroke: t.gridFaint },
    ticks: { stroke: t.ticks },
    font: t.font,
  };
}

/** What the shared [`ChartPlot`] needs to drive its zoom controls. */
export interface ChartZoom {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** The visible-range readout beside the buttons. */
  label: string;
  /**
   * True while the chart is zoomed away from its full extent. Keeps the controls
   * revealed after a wheel zoom, so the reset is never stranded behind a hover.
   */
  zoomed?: boolean;
}

/**
 * The reveal state for a chart's zoom chrome (M36, chart review item 13): revealed
 * while the pointer is inside the surface (or it has keyboard focus), and kept revealed
 * while the chart is zoomed away from its full extent, so a wheel-zoom user still has a
 * reset. Spread `attach` onto the chart's own container — the uPlot wrapper and the
 * canvas heatmaps both use it, so the convention is implemented once.
 */
export function createZoomReveal(zoomed?: () => boolean) {
  const [active, setActive] = createSignal(false);
  return {
    revealed: () => active() || (zoomed?.() ?? false),
    attach: {
      onPointerEnter: () => setActive(true),
      onPointerLeave: () => setActive(false),
      onFocusIn: () => setActive(true),
      onFocusOut: () => setActive(false),
    },
  };
}

/** The gated zoom controls — hidden (and untouchable) until the chart is in use. */
export function ZoomChrome(props: { zoom: ChartZoom; revealed: boolean }) {
  return (
    <div class="chart-zoom-chrome" classList={{ "is-idle": !props.revealed }}>
      <ZoomControls
        onZoomIn={props.zoom.zoomIn}
        onZoomOut={props.zoom.zoomOut}
        onFit={props.zoom.fit}
        label={props.zoom.label}
      />
    </div>
  );
}

/**
 * The one chart surface for the uPlot tabs: the wheel-zoom / right-click surface plus
 * the zoom chrome, revealed only while the chart is in use. The canvas heatmaps use
 * [`createZoomReveal`] + [`ZoomChrome`] directly, because their plot surface is the
 * canvas itself.
 */
export function ChartPlot(props: {
  zoom: ChartZoom;
  onWheel?: (event: WheelEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  /** Extra classes for a layout variant (e.g. a stacked lane). */
  class?: string;
  children: JSX.Element;
}) {
  const reveal = createZoomReveal(() => props.zoom.zoomed ?? false);
  const className = () => ["analyzer-plot", "chart-plot", props.class].filter(Boolean).join(" ");
  return (
    <div
      class={className()}
      {...reveal.attach}
      onWheel={(event) => props.onWheel?.(event)}
      onContextMenu={(event) => props.onContextMenu?.(event)}
    >
      {props.children}
      <ZoomChrome zoom={props.zoom} revealed={reveal.revealed()} />
    </div>
  );
}

/**
 * [`ChartPlot`] driven by a [`UplotZoom`](./uplotZoom.ts) handle — the common case. It
 * maps the controller's actions, its live range readout and its fitted state, so every
 * uPlot tab wraps its chart the same way and the zoom chrome behaves identically.
 * `label` overrides the readout for an axis that is not in seconds (a rate or Hz).
 */
export function UplotChartPlot(props: {
  zoom: UplotZoom;
  label?: string;
  onWheel?: (event: WheelEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <ChartPlot
      class={props.class}
      zoom={{
        zoomIn: props.zoom.zoomIn,
        zoomOut: props.zoom.zoomOut,
        fit: props.zoom.fit,
        label: props.label ?? timeRangeLabel(props.zoom.range()),
        zoomed: !props.zoom.fitted(),
      }}
      onWheel={(event) => props.onWheel?.(event)}
      onContextMenu={(event) => props.onContextMenu?.(event)}
    >
      {props.children}
    </ChartPlot>
  );
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

/** Options for a time tooltip that also shows a second-scale track. */
export interface TimeTooltipOptions {
  /** Per-scale formatters (`y2` = the right-hand track). */
  formatScale?: Record<string, (value: number) => string>;
  /** Scales to leave out; the default hides `y2` (a non-comparable reference curve). */
  hideScales?: string[];
}

/**
 * A time tooltip component (`"t <seconds>"`, `formatY` supplies the per-tool y format).
 * `options` is read at render time so a chart can format a second y-scale (phon /
 * confidence) with its own units.
 */
export function timeTooltip(formatY: (value: number) => string, options?: TimeTooltipOptions) {
  return (props: TooltipProps) => (
    <ChartTooltip
      {...props}
      {...(options ?? {})}
      xLabel="t"
      formatX={(value) => `${value.toFixed(3)} s`}
      formatY={formatY}
    />
  );
}

/**
 * The frequency-axis tooltip shared by the spectrum-style charts (`f`, dB).
 *
 * The cursor's x is in the chart's **axis coordinate**, which is a Bark or ERB rate when
 * the view is transformed (M36) — so it is inverted back to Hz, and the rate is shown
 * beside it. A chart in any mode therefore reports the same physical frequency.
 */
export function frequencyDbTooltip(scale: () => FrequencyScale) {
  return (props: TooltipProps) => (
    <ChartTooltip
      {...props}
      xLabel="f"
      formatX={(value) => frequencyCursor(value, scale())}
      formatY={(value) => `${value.toFixed(1)} dB`}
    />
  );
}

/** `"1.00 kHz · 8.5 z"` — always the frequency in Hz, plus the axis rate when transformed. */
function frequencyCursor(coord: number, scale: FrequencyScale): string {
  const hz = formatHz(axisToHz(scale, coord));
  if (scale === "bark") return `${hz} · ${coord.toFixed(1)} z`;
  if (scale === "erb") return `${hz} · ${coord.toFixed(1)} ERB`;
  return hz;
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
 * `build` maps the event to a target (or `null` when the pointer is outside the plot,
 * which leaves the menu closed).
 */
export function createReframeHandler(
  build: (event: MouseEvent) => ReframeTarget | null,
  setMenu: Setter<ReframeTarget | null>,
): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    event.preventDefault();
    const target = build(event);
    if (target) setMenu(target);
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
    // `u.over` is the plot area itself, so its rect is what the callout should span.
    const rect = u.over.getBoundingClientRect();
    return {
      x: event.clientX,
      y: event.clientY,
      time: u.posToVal(event.clientX - rect.left, "x"),
      top: rect.top,
      height: rect.height,
    };
  }, setMenu);
}
