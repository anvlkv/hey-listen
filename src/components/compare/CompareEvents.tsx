import { SolidUplot, type UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { createEffect, createMemo, createRoot, For, Show } from "solid-js";
import Readout from "../analyzer/Readout";
import { createUplotZoom } from "../analyzer/uplotZoom";
import { mirrorCursor, syncView } from "../analyzer/syncPlugins";
import { timeTooltip } from "../analyzer/chartCommon";
import { paddedYRange } from "../analyzer/range";
import { compareMarkers } from "./peerPlugins";
import ComparePlot from "./ComparePlot";
import { compareSides, liveMarkers } from "./sides";
import { timeAxis, valueAxis } from "./axes";
import { mergeSeries } from "./align";
import { pairingSets, pairingSummary, type EventKind, type PairingSet } from "./events";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import {
  analyzerById,
  type AnalyzerId,
  type RhythmResult,
  type RhythmView as RhythmViewConfig,
} from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, EventsDiffDto, Span } from "../../state/compare/types";

/**
 * The **rhythm** compare view (M25.A): A and B's onset-strength envelopes overlaid on
 * one absolute-time axis, with A's event markers above the midpoint and B's below.
 * Matched events are linked across the midpoint; an event present on one side only is
 * drawn dashed over the full height, because "A has an onset B does not" is the point
 * of the comparison. The event sets follow the tool (onsets / beats / downbeats).
 *
 * A differing grid shows the two envelopes side by side, never interpolated.
 */
export default function CompareEvents(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<RhythmResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): EventsDiffDto | null =>
    props.comparison.diff?.kind === "events" ? props.comparison.diff : null;
  const aligned = sides.aligned;

  const kinds = () => (analyzerById(props.tool).view as RhythmViewConfig).markers as EventKind[];
  const sets = (): PairingSet[] => {
    const d = diff();
    return d ? pairingSets(kinds(), d) : [];
  };

  const merged = createMemo(() => {
    const a = sides.resultA();
    const b = sides.resultB();
    if (!a || !b) return null;
    return mergeSeries(a.times, a.onsetStrength, b.times, b.onsetStrength);
  });

  const zoom = createUplotZoom("time");
  const Tooltip = timeTooltip((value) => value.toFixed(4));
  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        swapped: () => props.swapped,
        window: props.bWindow,
        axis: "time",
      }),
    );

  const envelopeDelta = () => diff()?.envelope ?? null;

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.events">
      <div class="analyzer-readouts" data-testid="compare.events.summary">
        <Readout label="Δ mean" value={formatDelta(envelopeDelta()?.stats.mean)} />
        <Readout label="max |Δ|" value={formatDelta(envelopeDelta()?.stats.maxAbs)} />
        <For each={sets()}>
          {(set) => <Readout label={set.label} value={pairingSummary(set.pairing)} />}
        </For>
        <div class="compare-event-legend">
          <span class="compare-event-legend-a">A above</span>
          <span class="compare-event-legend-b">B below</span>
          <span>linked = matched · dashed = one side only</span>
        </div>
      </div>

      <Show
        when={aligned() && merged()}
        fallback={
          <div class="compare-side-by-side" data-testid="compare.events.side">
            <EnvelopeSide
              label={props.swapped ? "B" : "A"}
              color={chartTheme().compareA}
              rhythm={sides.resultA()}
              markers={markers}
            />
            <EnvelopeSide
              label={props.swapped ? "A" : "B"}
              color={chartTheme().compareB}
              rhythm={sides.resultB()}
              markers={markers}
            />
          </div>
        }
      >
        {(data) => (
          <ComparePlot zoom={zoom}>
            <Show when={activeThemeId()} keyed>
              <SolidUplot
                autoResize
                pluginBus={analyzerBus}
                plugins={[
                  cursor(),
                  tooltip(Tooltip),
                  mirrorCursor("time"),
                  syncView("time"),
                  markers(),
                  eventPairMarkers(sets),
                ]}
                onCreate={zoom.onReady}
                data={[data().times, data().a, data().b] as uPlot.AlignedData}
                series={[
                  {},
                  {
                    label: props.swapped ? "B" : "A",
                    stroke: chartTheme().compareA,
                    width: 1,
                    fill: chartTheme().waveFill,
                  },
                  {
                    label: props.swapped ? "A" : "B",
                    stroke: chartTheme().compareB,
                    width: 1,
                  },
                ]}
                scales={{ x: { time: false }, y: { range: paddedYRange } }}
                axes={[timeAxis(), valueAxis("onset strength")]}
              />
            </Show>
          </ComparePlot>
        )}
      </Show>
    </div>
  );
}

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/** A dashed full-height / matched-half event rule set, read reactively. */
const eventPairMarkers =
  (sets: () => PairingSet[]): UplotPluginFactory<AnalyzerBus> =>
  () => {
    let current: PairingSet[] = [];
    let dispose: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              current = sets();
              u.redraw();
            });
            return root;
          });
        },
        draw: (u) => {
          if (!u.ctx) return;
          const { bbox } = u;
          const mid = bbox.top + bbox.height / 2;
          const bottom = bbox.top + bbox.height;
          const theme = chartTheme();
          for (const set of current) {
            // Matched pairs: each side's half-marker, plus a link across the midpoint.
            drawRules(
              u,
              set.pairing.pairs.map((pair) => pair.a),
              theme.compareA,
              set.width,
              bbox.top,
              mid,
            );
            drawRules(
              u,
              set.pairing.pairs.map((pair) => pair.b),
              theme.compareB,
              set.width,
              mid,
              bottom,
            );
            drawLinks(u, set, mid);
            // Unmatched events are the interesting ones: dashed over the full height.
            drawRules(
              u,
              set.pairing.onlyATimes,
              theme.compareA,
              set.width,
              bbox.top,
              bottom,
              [2, 3],
            );
            drawRules(
              u,
              set.pairing.onlyBTimes,
              theme.compareB,
              set.width,
              bbox.top,
              bottom,
              [2, 3],
            );
          }
        },
        destroy: () => dispose?.(),
      },
    };
  };

/** Vertical rules at the given source seconds between two canvas y positions. */
function drawRules(
  u: Uplot,
  times: number[],
  color: string,
  width: number,
  top: number,
  bottom: number,
  dash: number[] = [],
) {
  if (times.length === 0) return;
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (const time of times) {
    const x = u.valToPos(time, "x", true);
    if (!Number.isFinite(x)) continue;
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
  }
  ctx.stroke();
  ctx.restore();
}

/** A thin connector between a matched pair's two markers. */
function drawLinks(u: Uplot, set: PairingSet, mid: number) {
  if (set.pairing.pairs.length === 0) return;
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = chartTheme().compareDelta;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const pair of set.pairing.pairs) {
    const xa = u.valToPos(pair.a, "x", true);
    const xb = u.valToPos(pair.b, "x", true);
    if (!Number.isFinite(xa) || !Number.isFinite(xb)) continue;
    ctx.moveTo(xa, mid);
    ctx.lineTo(xb, mid);
  }
  ctx.stroke();
  ctx.restore();
}

/** One side's own envelope, used when the grids differ. */
function EnvelopeSide(props: {
  label: string;
  color: string;
  rhythm: RhythmResult | undefined;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  const Tooltip = timeTooltip((value) => value.toFixed(4));
  return (
    <div class="compare-side">
      <div class="compare-side-label" style={{ color: props.color }}>
        {props.label}
      </div>
      <Show
        when={props.rhythm}
        fallback={<div class="analyzer-empty">This project has no result for the window.</div>}
      >
        {(rhythm) => (
          <Show when={activeThemeId()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[cursor(), tooltip(Tooltip), props.markers()]}
              data={[rhythm().times, rhythm().onsetStrength]}
              series={[{}, { label: props.label, stroke: props.color, width: 1 }]}
              scales={{ x: { time: false }, y: { range: paddedYRange } }}
              axes={[timeAxis(), valueAxis("onset strength")]}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}

function formatDelta(value: number | null | undefined): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}
