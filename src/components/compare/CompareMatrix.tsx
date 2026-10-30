import { createMemo, createSignal, For, Show } from "solid-js";
import Readout from "../analyzer/Readout";
import { buildHeatmapImage } from "../analyzer/chartCanvas";
import type { PlotBox } from "../analyzer/chartGeometry";
import {
  formatHz,
  analyzerById,
  type AnalyzerId,
  type MatrixView as MatrixViewConfig,
} from "../../state/analyzer";
import { chartTheme } from "../../state/themes";
import { compareFamily } from "../../state/compare/id";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, MatrixDiffDto, Span } from "../../state/compare/types";
import CompareCanvas from "./CompareCanvas";
import { compareSides } from "./sides";
import {
  blitRange,
  deltaLimit,
  deltaSpan,
  divergingColor,
  gridValue,
  isSpectrogramGrid,
  sharedRange,
  type GridResult,
} from "./matrix";

type Mode = "a" | "b" | "delta";

const MODES: { id: Mode; label: string }[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "delta", label: "Δ" },
];

/**
 * The **matrix / spectrogram** compare view (M25.A): a segmented **A / B / Δ** control.
 * A and B paint through the active theme's heatmap ramp (on a range shared by both, so
 * switching sides never rescales); Δ paints through a **diverging** ramp centred on
 * zero, with its legend under the readouts.
 *
 * A differing grid shows the two heatmaps side by side instead — no interpolation, and
 * no Δ. The canvas is read-only: a compare view never edits notes or the timeline.
 */
export default function CompareMatrix(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  const [mode, setMode] = createSignal<Mode>("a");
  const family = () => compareFamily(props.tool);
  const spectrogram = () => family() === "spectrogram";

  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<GridResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): MatrixDiffDto | null =>
    props.comparison.diff?.kind === "matrix" ? props.comparison.diff : null;
  const aligned = () => sides.aligned() && !!sides.resultA() && !!sides.resultB();

  /** The axis span both windows cover, so A and B share one time axis. */
  const span = (): Span => ({
    start: Math.min(sides.a().window.start, sides.b().window.start),
    end: Math.max(sides.a().window.end, sides.b().window.end),
  });

  /** The shared colour range, so switching A/B never changes the ramp's meaning. */
  const range = createMemo(() => {
    const a = sides.resultA();
    const b = sides.resultB();
    return a && b ? sharedRange(a, b) : null;
  });

  const imageOf = (result: GridResult | undefined) => {
    const shared = range();
    if (!result || !shared || result.frames === 0 || result.bins === 0) return null;
    const span = Math.max(shared.hi - shared.lo, 1e-3);
    return buildHeatmapImage(result.frames, result.bins, shared.lo, span, (x, row) =>
      gridValue(result, x, row),
    );
  };
  const imageA = createMemo(() => imageOf(sides.resultA()));
  const imageB = createMemo(() => imageOf(sides.resultB()));

  const deltaImage = createMemo<HTMLCanvasElement | null>(() => {
    const d = diff();
    if (!d || d.times.length === 0 || d.bins === 0) return null;
    const limit = deltaLimit(d.values);
    return buildHeatmapImage(
      d.times.length,
      d.bins,
      -limit,
      2 * limit,
      (x, row) => d.values[x * d.bins + row],
      // The image's `t` is 0…1; the ramp takes a signed −1…+1 Δ.
      (t) => divergingColor(t * 2 - 1),
    );
  });

  /** Paint one grid over its own window, clipped to the axis span. */
  const paintGrid = (
    ctx: CanvasRenderingContext2D,
    box: PlotBox,
    at: Span,
    image: HTMLCanvasElement,
    result: GridResult,
  ) => {
    const start = result.windowStart;
    blitRange(ctx, box, at, image, {
      start,
      end: start + Math.max(result.duration, 1e-9),
    });
    drawBands(ctx, box, result);
  };

  const paintDelta = (
    ctx: CanvasRenderingContext2D,
    box: PlotBox,
    at: Span,
    d: MatrixDiffDto,
    image: HTMLCanvasElement,
  ) => {
    const covered = deltaSpan(d);
    if (!covered) return;
    blitRange(ctx, box, at, image, covered);
    if (sides.resultA()) drawBands(ctx, box, sides.resultA()!);
  };

  /** Band labels down the left edge (Hz for a spectrogram, the tool's band labels). */
  const drawBands = (ctx: CanvasRenderingContext2D, box: PlotBox, result: GridResult) => {
    if (result.bins === 0) return;
    const config = analyzerById(props.tool).view as MatrixViewConfig;
    ctx.save();
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = chartTheme().axis;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const band = Math.min(result.bins - 1, Math.round(frac * (result.bins - 1)));
      const y = box.y + box.height - frac * box.height;
      const label = spectrogram()
        ? formatHz(isSpectrogramGrid(result) ? (result.freqs[band] ?? 0) : 0)
        : config.formatBand(band);
      ctx.fillText(label, box.x - 6, y);
    }
    ctx.restore();
  };

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.matrix">
      <div class="analyzer-readouts">
        <Readout label="Δ mean" value={formatDelta(diff()?.stats.mean)} />
        <Readout label="max |Δ|" value={formatDelta(diff()?.stats.maxAbs)} />
        <Readout label="Grid" value={diff() ? `${diff()!.times.length} × ${diff()!.bins}` : "—"} />
        <Readout label="Pairs" value={diff() ? `${diff()!.stats.matched}` : "—"} />
        <Show when={aligned()}>
          <div class="compare-segmented" data-testid="compare.matrix.mode">
            <For each={MODES}>
              {(item) => (
                <button
                  type="button"
                  class={`compare-segment ${mode() === item.id ? "on" : ""}`}
                  aria-pressed={mode() === item.id}
                  data-testid={`compare.matrix.mode.${item.id}`}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={aligned() && sides.resultA() && sides.resultB()}>
        <Show
          when={mode() === "delta" ? deltaImage() : mode() === "a" ? imageA() : imageB()}
          fallback={<div class="analyzer-empty">No {mode() === "delta" ? "delta" : "values"}.</div>}
        >
          <CompareCanvas
            span={span}
            live={props.live}
            bWindow={props.bWindow}
            swapped={props.swapped}
            paint={(ctx, box, at) => {
              const d = diff();
              const image =
                mode() === "delta" ? deltaImage() : mode() === "a" ? imageA() : imageB();
              if (!image) return;
              if (mode() === "delta" && d) paintDelta(ctx, box, at, d, image);
              else {
                const result = mode() === "a" ? sides.resultA() : sides.resultB();
                if (result) paintGrid(ctx, box, at, image, result);
              }
            }}
          />
        </Show>
        <Show when={mode() === "delta" && diff()}>
          <div class="compare-diverging-legend" data-testid="compare.matrix.legend">
            <span>−{formatLimit(deltaLimit(diff()!.values))}</span>
            <div
              class="compare-diverging-ramp"
              style={{
                background: `linear-gradient(90deg, ${chartTheme().compareA}, ${
                  chartTheme().spectroBackground
                }, ${chartTheme().compareB})`,
              }}
            />
            <span>+{formatLimit(deltaLimit(diff()!.values))}</span>
            <span class="compare-diverging-note">B − A</span>
          </div>
        </Show>
      </Show>

      <Show when={!aligned()}>
        <div class="compare-side-by-side" data-testid="compare.matrix.side">
          <div class="compare-side-note">Grids differ — A and B are drawn separately; no Δ.</div>
          <GridSide
            label={props.swapped ? "B" : "A"}
            result={sides.resultA()}
            live={props.live}
            paintGrid={paintGrid}
            image={imageA()}
            span={sides.a().window}
          />
          <GridSide
            label={props.swapped ? "A" : "B"}
            result={sides.resultB()}
            live={props.live}
            paintGrid={paintGrid}
            image={imageB()}
            span={sides.b().window}
          />
        </div>
      </Show>
    </div>
  );
}

/** One side's own heatmap, used when the grids differ (never interpolated). */
function GridSide(props: {
  label: string;
  result: GridResult | undefined;
  image: HTMLCanvasElement | null;
  span: Span;
  live: CompareLiveHandle;
  paintGrid: (
    ctx: CanvasRenderingContext2D,
    box: PlotBox,
    at: Span,
    image: HTMLCanvasElement,
    result: GridResult,
  ) => void;
}) {
  return (
    <div class="compare-side">
      <div class="compare-side-label">{props.label}</div>
      <Show
        when={props.result && props.image}
        fallback={<div class="analyzer-empty">This project has no grid for the window.</div>}
      >
        <CompareCanvas
          span={() => props.span}
          live={props.live}
          paint={(ctx, box, at) => {
            if (props.image && props.result) {
              props.paintGrid(ctx, box, at, props.image, props.result);
            }
          }}
        />
      </Show>
    </div>
  );
}

function formatDelta(value: number | null | undefined): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatLimit(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}
