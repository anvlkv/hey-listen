import { createMemo, For, Show } from "solid-js";
import { duration, level, span } from "../analyzer/noteMetricsFormat";
import type { PlotBox } from "../analyzer/chartGeometry";
import { chartTheme } from "../../state/themes";
import type { NoteMetric } from "../../bindings/NoteMetric";
import type { NoteMetricsResult, AnalyzerId } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, NotesDiffDto, Span } from "../../state/compare/types";
import CompareCanvas from "./CompareCanvas";
import { compareSides } from "./sides";
import { noteRows, rowLabel } from "./notes";

/** The key that marks a note start as having a counterpart on the other side. */
const key = (secs: number) => secs.toFixed(5);

/**
 * The `noteMetrics` compare view (M25.A): A's detected notes above the midpoint and
 * B's below, matched pairs linked, one-side-only notes outlined dashed. The table below
 * is the detail — one row per matched pair (with A, B and Δ) plus a row for every note
 * only one project has.
 *
 * These are **detected audio notes**, not the project's annotations (`docs/notes.md`).
 */
export default function CompareNotes(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<NoteMetricsResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const axisSpan = () => ({
    start: Math.min(sides.a().window.start, sides.b().window.start),
    end: Math.max(sides.a().window.end, sides.b().window.end),
  });
  const notesA = (): NoteMetric[] => sides.resultA()?.notes ?? [];
  const notesB = (): NoteMetric[] => sides.resultB()?.notes ?? [];

  const diff = (): NotesDiffDto | null =>
    props.comparison.diff?.kind === "notes" ? props.comparison.diff : null;
  const rows = createMemo(() => {
    const d = diff();
    return d ? noteRows(d) : [];
  });

  const matchedA = () => new Set(diff()?.pairs.map((pair) => key(pair.aStart)) ?? []);
  const matchedB = () => new Set(diff()?.pairs.map((pair) => key(pair.bStart)) ?? []);

  const paint = (
    ctx: CanvasRenderingContext2D,
    box: PlotBox,
    at: { start: number; end: number },
  ) => {
    const xOf = (secs: number) => box.x + ((secs - at.start) / (at.end - at.start)) * box.width;
    const mid = box.y + box.height / 2;
    const theme = chartTheme();
    drawBlocks(ctx, box, mid, notesA(), xOf, theme.compareA, matchedA(), true);
    drawBlocks(ctx, box, mid, notesB(), xOf, theme.compareB, matchedB(), false);

    ctx.save();
    ctx.strokeStyle = theme.compareDelta;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const pair of diff()?.pairs ?? []) {
      const xa = xOf(pair.aStart);
      const xb = xOf(pair.bStart);
      ctx.moveTo(xa, mid - 4);
      ctx.lineTo(xb, mid + 4);
    }
    ctx.stroke();
    ctx.restore();

    // The midpoint rule separates A's half from B's.
    ctx.save();
    ctx.strokeStyle = theme.midline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(mid) + 0.5);
    ctx.lineTo(box.x + box.width, Math.round(mid) + 0.5);
    ctx.stroke();
    ctx.restore();
  };

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.notes">
      <div class="analyzer-readouts">
        <span class="compare-legend-a">Matched {diff()?.matched ?? "—"}</span>
        <span class="compare-legend-b">Only A {diff()?.onlyA ?? "—"}</span>
        <span class="compare-legend-b">Only B {diff()?.onlyB ?? "—"}</span>
        <span>
          mean |Δt|{" "}
          {diff()?.meanAbsDt == null ? "—" : `${(diff()!.meanAbsDt! * 1000).toFixed(1)} ms`}
        </span>
        <span class="compare-side-note">A above · B below · dashed = one side only</span>
      </div>

      <CompareCanvas
        testid="compare.notes.chart"
        span={axisSpan}
        live={props.live}
        bWindow={props.bWindow}
        swapped={props.swapped}
        paint={(ctx, box, at) => paint(ctx, box, at)}
      />

      <div class="note-metrics-scroll">
        <table class="note-metrics-table compare-notes-table" data-testid="compare.notes.table">
          <thead>
            <tr>
              <th>#</th>
              <th>A start</th>
              <th>B start</th>
              <th>Δt</th>
              <th>A duration</th>
              <th>B duration</th>
              <th>Δduration</th>
              <th>A RMS</th>
              <th>B RMS</th>
              <th>Δ RMS</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row, index) => (
                <tr
                  classList={{ "is-reference": row.kind !== "pair" }}
                  data-testid={`compare.notes.row.${index()}`}
                >
                  <td>{rowLabel(row, index())}</td>
                  <td>{row.aStart == null ? "—" : span(row.aStart)}</td>
                  <td>{row.bStart == null ? "—" : span(row.bStart)}</td>
                  <td>{row.dt == null ? "—" : ms(row.dt)}</td>
                  <td>{row.aDuration == null ? "—" : duration(row.aDuration)}</td>
                  <td>{row.bDuration == null ? "—" : duration(row.bDuration)}</td>
                  <td>{row.durationDelta == null ? "—" : ms(row.durationDelta)}</td>
                  <td>{row.aRmsDb == null ? "—" : level(row.aRmsDb)}</td>
                  <td>{row.bRmsDb == null ? "—" : level(row.bRmsDb)}</td>
                  <td>{row.rmsDeltaDb == null ? "—" : signed(row.rmsDeltaDb, " dB")}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={rows().length === 0}>
          <div class="analyzer-empty" data-testid="compare.notes.empty">
            No detected notes to compare in this window — lower <strong>Gate</strong> or widen the
            window.
          </div>
        </Show>
      </div>
    </div>
  );
}

/** One side's note blocks (half the plot height), dashed when unmatched. */
function drawBlocks(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  mid: number,
  notes: NoteMetric[],
  xOf: (secs: number) => number,
  color: string,
  matched: Set<string>,
  upper: boolean,
) {
  const top = upper ? box.y + 4 : mid + 6;
  const height = box.height / 2 - 10;
  ctx.save();
  for (const note of notes) {
    const isMatched = matched.has(key(note.startSecs));
    const x0 = xOf(note.startSecs);
    const x1 = xOf(note.endSecs);
    const left = Math.max(box.x, Math.min(x0, x1));
    const right = Math.min(box.x + box.width, Math.max(x0, x1));
    if (right < box.x || left > box.x + box.width) continue;
    const width = Math.max(2, right - left);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isMatched ? color : chartTheme().compareDelta;
    ctx.setLineDash(isMatched ? [] : [3, 2]);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, width, height);
  }
  ctx.restore();
}

/** A signed delta in milliseconds (Δt and Δduration are seconds). */
function ms(value: number): string {
  const rounded = value * 1000;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)} ms`;
}

function signed(value: number, unit: string): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${unit}`;
}
