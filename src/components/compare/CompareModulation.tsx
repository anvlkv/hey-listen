import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { createSignal, For, Show } from "solid-js";
import Readout from "../analyzer/Readout";
import ZoomControls from "../analyzer/ZoomControls";
import { createUplotZoom } from "../analyzer/uplotZoom";
import { mirrorCursor, syncView } from "../analyzer/syncPlugins";
import {
  formatRate,
  MOD_Y_RANGE,
  ModulationTooltip,
  rateAxisValues,
  visibleLevels,
} from "../analyzer/modulationCommon";
import { compareMarkers } from "./peerPlugins";
import { compareSides, liveMarkers } from "./sides";
import { rateAxis, valueAxis } from "./axes";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import type { AnalyzerId, ModulationResult } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, ModulationDiffDto, Span } from "../../state/compare/types";

type Band = "am" | "fm";

/** The AM or FM column of a modulation result (gaps where the spectrum is absent). */
function lineOf(result: ModulationResult | undefined, band: Band, bins: number): (number | null)[] {
  const db = band === "am" ? result?.amDb : result?.fmDb;
  if (!db || db.length !== bins) return new Array<number | null>(bins).fill(null);
  return visibleLevels(db);
}

/**
 * The **modulation** compare view (M25.A): A and B's AM (or FM) spectra on one
 * modulation-rate axis, with B's rate cursor drawn as a read-only rule. A segmented
 * **AM / FM** control picks the line; the Δ readouts cover both. It joins the `"mod"`
 * sync group, never the time group — its x-axis is a rate, not time.
 *
 * A differing rate grid shows each side's spectrum separately, never interpolated.
 */
export default function CompareModulation(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  const [band, setBand] = createSignal<Band>("am");
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<ModulationResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): ModulationDiffDto | null =>
    props.comparison.diff?.kind === "modulation" ? props.comparison.diff : null;
  const aligned = () => sides.aligned() && !!diff();

  const zoom = createUplotZoom("mod");
  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        swapped: () => props.swapped,
        window: props.bWindow,
        axis: "rate",
      }),
    );

  const rateHz = () => diff()?.rateHz ?? sides.resultA()?.modFreqs ?? [];
  const data = (): uPlot.AlignedData => {
    const rates = rateHz();
    return [
      rates,
      lineOf(sides.resultA(), band(), rates.length),
      lineOf(sides.resultB(), band(), rates.length),
    ];
  };
  const plottable = () => {
    const [rates, a, b] = data();
    return rates.length >= 2 && (a.some((v) => v != null) || b.some((v) => v != null));
  };

  const lineDelta = () => (band() === "am" ? diff()?.am : diff()?.fm);

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.modulation">
      <div class="analyzer-readouts">
        <Readout label="Δ AM mean" value={db(diff()?.am.stats.mean)} />
        <Readout label="Δ AM max" value={db(diff()?.am.stats.maxAbs)} />
        <Readout label="Δ FM mean" value={db(diff()?.fm.stats.mean)} />
        <Readout label="Δ FM max" value={db(diff()?.fm.stats.maxAbs)} />
        <div class="compare-segmented" data-testid="compare.modulation.mode">
          <For each={["am", "fm"] as Band[]}>
            {(item) => (
              <button
                type="button"
                class={`compare-segment ${band() === item ? "on" : ""}`}
                aria-pressed={band() === item}
                data-testid={`compare.modulation.mode.${item}`}
                onClick={() => setBand(item)}
              >
                {item.toUpperCase()}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show
        when={aligned() && plottable()}
        fallback={
          <Show
            when={!aligned()}
            fallback={
              <div class="analyzer-empty" data-testid="compare.modulation.empty">
                No modulation above the floor in this window — widen it or choose material with a
                changing level or pitch.
              </div>
            }
          >
            <div class="compare-side-by-side" data-testid="compare.modulation.side">
              <ModSide
                label={props.swapped ? "B" : "A"}
                result={sides.resultA()}
                band={band()}
                markers={markers}
              />
              <ModSide
                label={props.swapped ? "A" : "B"}
                result={sides.resultB()}
                band={band()}
                markers={markers}
              />
            </div>
          </Show>
        }
      >
        <div class="analyzer-plot">
          <ZoomControls
            onZoomIn={zoom.zoomIn}
            onZoomOut={zoom.zoomOut}
            onFit={zoom.fit}
            label={
              zoom.range()
                ? `${formatRate(zoom.range()![0])} – ${formatRate(zoom.range()![1])}`
                : ""
            }
          />
          <Show when={`${activeThemeId()}|${band()}`} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[
                cursor(),
                tooltip(ModulationTooltip),
                mirrorCursor("mod"),
                syncView("mod"),
                markers(),
              ]}
              onCreate={zoom.onReady}
              data={data()}
              series={[
                {},
                { label: props.swapped ? "B" : "A", stroke: chartTheme().compareA, width: 1.4 },
                { label: props.swapped ? "A" : "B", stroke: chartTheme().compareB, width: 1.4 },
              ]}
              scales={{ x: { time: false }, y: { range: () => MOD_Y_RANGE } }}
              axes={[{ ...rateAxis(), values: rateAxisValues }, valueAxis("relative level (dB)")]}
            />
          </Show>
        </div>
      </Show>

      <Show when={lineDelta()}>
        {(line) => (
          <div class="analyzer-hint" data-testid="compare.modulation.delta">
            {band().toUpperCase()} Δ: mean {db(line().stats.mean)} · max |Δ|{" "}
            {db(line().stats.maxAbs)} · {line().stats.matched} bins
          </div>
        )}
      </Show>
    </div>
  );
}

/** One side's own modulation spectrum, used when the rate grids differ. */
function ModSide(props: {
  label: string;
  band: Band;
  result: ModulationResult | undefined;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  const rates = () => props.result?.modFreqs ?? [];
  const data = (): uPlot.AlignedData => [rates(), lineOf(props.result, props.band, rates().length)];
  return (
    <div class="compare-side">
      <div class="compare-side-label">{props.label}</div>
      <Show
        when={rates().length >= 2}
        fallback={<div class="analyzer-empty">This project has no modulation spectrum.</div>}
      >
        <Show when={activeThemeId()} keyed>
          <SolidUplot
            autoResize
            pluginBus={analyzerBus}
            plugins={[cursor(), props.markers()]}
            data={data()}
            series={[
              {},
              {
                label: `${props.label} ${props.band.toUpperCase()}`,
                stroke: props.label === "A" ? chartTheme().compareA : chartTheme().compareB,
                width: 1.2,
              },
            ]}
            scales={{ x: { time: false }, y: { range: () => MOD_Y_RANGE } }}
            axes={[{ ...rateAxis(), values: rateAxisValues }, valueAxis("relative level (dB)")]}
          />
        </Show>
      </Show>
    </div>
  );
}

function db(value: number | null | undefined): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
}
