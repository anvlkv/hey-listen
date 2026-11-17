import { For, Show, createMemo } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import { rgba } from "color2k";
import {
  formatRow,
  frameProfile,
  nearestFrame,
  rateScale,
  type DrilldownGrid,
  type RateSnapshot,
} from "./drilldown";
import type { HeatmapScale } from "./heatmapScale";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/** The cursor: its plot-relative position (CSS px), its sample index, and its time. */
export interface CardCursor {
  left: number;
  top: number;
  /** The sample index under the pointer (uPlot's `cursor.idx`). */
  idx: number;
  /** The x value under the pointer, in source seconds. */
  time: number;
}

/** How many of the frame's strongest rows the card names outright. */
const TOP_ROWS = 3;

/** One cell's colour, sampled from exactly the ramp the lane was built with. */
function cellColor(scale: HeatmapScale, value: number): string {
  const [r, g, b] = scale.ramp(scale.position(value));
  return rgba(r, g, b, 1);
}

/** The strongest rows of one frame, strongest first (a zero row is not a finding). */
function strongest(profile: number[], count: number): { row: number; value: number }[] {
  return profile
    .map((value, row) => ({ row, value }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

/**
 * The **drill-down card** (M38): the cursor readout for a chart whose tool carries a
 * drill-down. One hover surface, not two — it names the tool's track(s) at the cursor,
 * then the frame's composition: the row profile as a bar register, the strongest rows in
 * the result's own unit, and (for a rate tool) the band × modulation-rate grid.
 *
 * It is inert (`pointer-events: none`), so it can never take a hover or a drag from the
 * chart behind it, and it is flipped/anchored from the plot's edges like a tooltip —
 * `right`/`bottom` keep it inside the chart without measuring it.
 *
 * Everything is DOM rather than canvas, and every colour comes from the one
 * [`HeatmapScale`](./heatmapScale.ts) the in-plot lane was built with, so the card and
 * the pixels cannot disagree.
 */
export default function DrilldownCard(props: {
  u: Uplot;
  cursor: CardCursor;
  grid: DrilldownGrid;
  scale: HeatmapScale;
  /** The chart's own tracks at the cursor, already formatted (the tooltip's content). */
  values: { label: string; value: string }[];
  /** The frame's band × rate grid (roughness / fluctuation strength only). */
  rate?: RateSnapshot | null;
  /** The model's weighted rate, named in the rate grid's caption. */
  rateTarget?: number;
}) {
  const frame = createMemo(() => nearestFrame(props.grid, props.cursor.time));
  const profile = createMemo(() => frameProfile(props.grid, frame()) ?? []);
  const peak = createMemo(() => Math.max(...profile(), 0));
  const time = createMemo(() => props.grid.times[frame()] ?? props.cursor.time);
  const rate = createMemo(() => props.rate ?? null);
  const rateRamp = createMemo(() => (rate() ? rateScale(rate()!) : null));

  /** Anchored to the cursor, flipped at the plot's edges without measuring the card. */
  const position = () => {
    const root = props.u.root;
    const b = props.u.bbox;
    const { left, top } = props.cursor;
    const flipX = b.left + left > root.clientWidth * 0.62;
    const flipY = top > b.height * 0.55;
    return {
      ...(flipX
        ? { right: `${root.clientWidth - (b.left + left) + 14}px` }
        : { left: `${b.left + left + 14}px` }),
      ...(flipY
        ? { bottom: `${root.clientHeight - (b.top + top) + 12}px` }
        : { top: `${b.top + top + 12}px` }),
    };
  };

  return (
    <div class="drilldown-card" style={position()} data-testid="drilldown.card">
      <div class="drilldown-card-head">
        <span class="drilldown-card-time">t {time().toFixed(3)} s</span>
      </div>

      <For each={props.values}>
        {(row) => (
          <div class="drilldown-readout">
            <span class="drilldown-readout-label">{row.label}</span>
            <span class="drilldown-readout-value">{row.value}</span>
          </div>
        )}
      </For>

      <Show when={profile().length > 0}>
        <div class="drilldown-card-caption">{props.grid.cellLabel}</div>
        <div class="drilldown-bars">
          <For each={profile()}>
            {(value) => (
              <i
                style={{
                  "--drilldown-h": `${peak() > 0 ? Math.max((value / peak()) * 100, 2) : 2}%`,
                  "--drilldown-fill": cellColor(props.scale, value),
                }}
              />
            )}
          </For>
        </div>
        <div class="drilldown-axis">
          <span>{formatRow(props.grid.rowCentres[0] ?? 0)}</span>
          <span>{props.grid.rowLabel}</span>
          <span>{formatRow(props.grid.rowCentres[props.grid.rows - 1] ?? 0)}</span>
        </div>

        <For each={strongest(profile(), TOP_ROWS)}>
          {(item) => (
            <div class="drilldown-top-row">
              <span class="drilldown-top-at">
                {formatRow(props.grid.rowCentres[item.row] ?? 0)}
              </span>
              <span class="drilldown-top-value">{props.scale.formatter(item.value)}</span>
            </div>
          )}
        </For>
      </Show>

      <Show when={rate()}>
        {(snapshot) => (
          <>
            <div class="drilldown-axis drilldown-rate-caption">
              <span>band × rate</span>
              <Show when={props.rateTarget}>
                <span>weight {formatRow(props.rateTarget!)}</span>
              </Show>
              <span>
                {formatRow(snapshot().rates[0])} –{" "}
                {formatRow(snapshot().rates[snapshot().rates.length - 1])}
              </span>
            </div>
            <div
              class="drilldown-rate"
              style={{ "--drilldown-rate-cols": `${snapshot().rates.length}` }}
              title="One frame's band × modulation-rate depths — 0 is steady"
            >
              <For each={snapshot().values}>
                {(value) => <i style={{ "--drilldown-fill": cellColor(rateRamp()!, value) }} />}
              </For>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
