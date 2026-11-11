import { createMemo, Show, type Accessor } from "solid-js";
import ChartLegend from "./chartLegend";
import HeatmapPanel, {
  companionTimeRange,
  timeHeatmapAxis,
  type HeatmapAxis,
  type PaintHeatmap,
} from "./HeatmapPanel";
import { buildHeatmapImage, paintFrameGrid } from "./chartCanvas";
import { resolveHeatmapScale } from "./heatmapScale";
import { bandIndexValues, Y_AXIS_SPACE } from "./axisFormat";
import { chartTheme } from "../../state/themes";
import type { CandidateGrid } from "../../bindings/CandidateGrid";
import type { PitchResult, SeriesResult } from "../../state/analyzer";
import type { UplotZoom } from "./uplotZoom";
import { cursorTimeMarks } from "./verticalMarkers";
import { frameTimeExtent } from "./chartGeometry";

/** The detector's grid plus the frame times it is aligned with. */
interface CandidateFrames {
  grid: CandidateGrid;
  /** The first `frames` frame times, in source seconds. */
  times: number[];
  frames: number;
}

/**
 * The pYIN candidate drill-down (M36): the detector's per-frame pitch-candidate
 * probabilities as a time × semitone-bin heatmap under the f0 track, so a stretch
 * where several candidates compete is visible instead of only the f0 that won.
 *
 * `CandidateGrid.values` is frame-major (`frames × bins`) and aligned with the pitch
 * result's `times`; the frame count is derived from the payload. Only pYIN reports
 * candidates, so YIN/autocorrelation results — and stored results from before the
 * field existed — render nothing. The panel is read-only: it follows the timeline
 * chart's visible range and the shared `"time"` cursor, and publishes neither.
 */
export default function PitchCandidatesPanel(props: {
  result: Accessor<SeriesResult | null>;
  zoom: UplotZoom;
}) {
  const grid = createMemo<CandidateFrames | null>(() => {
    const result = props.result() as Partial<PitchResult> | null;
    const payload = result?.candidates;
    const times = result?.times;
    if (!payload || !times || payload.bins <= 0) return null;
    const frames = Math.floor(payload.values.length / payload.bins);
    const complete =
      frames > 0 &&
      payload.freqs.length >= payload.bins &&
      times.length >= frames &&
      payload.values.length >= frames * payload.bins;
    return complete ? { grid: payload, times: times.slice(0, frames), frames } : null;
  });

  /** One fixed 0…1 domain: every cell is a probability, so colours stay comparable. */
  const panel = createMemo(() => {
    const payload = grid();
    if (!payload) return null;
    const { grid: candidates, frames } = payload;
    const scale = resolveHeatmapScale({ min: 0, max: 1, unit: null });
    const image = buildHeatmapImage(
      frames,
      candidates.bins,
      0,
      1,
      (frame, bin) => scale.position(candidates.values[frame * candidates.bins + bin]),
      scale.ramp,
    );
    return image ? { scale, image } : null;
  });

  /** The grid's own time extent, or `null` without a grid. */
  const extent = (): [number, number] | null => {
    const payload = grid();
    return payload ? frameTimeExtent(payload.times, payload.frames) : null;
  };

  /** The timeline chart's visible range, so the panel's time axis aligns with it. */
  const visible = (): [number, number] => companionTimeRange(extent(), props.zoom.range);

  /** Blit the visible slice of the candidate grid; a view past it clips to background. */
  const paint: PaintHeatmap = (ctx, box, source, u) => {
    const payload = grid();
    if (!payload) return;
    paintFrameGrid(ctx, source, box, u, payload.times, payload.frames, payload.grid.bins);
  };

  /** The semitone-bin centres, kept as memo accessors so a new result relabels the ticks. */
  const freqs = createMemo(() => grid()?.grid.freqs ?? []);
  const bins = createMemo(() => grid()?.grid.bins ?? 0);

  const yAxis = (): HeatmapAxis => ({
    range: () => [-0.5, bins() - 0.5],
    label: "semitone (Hz)",
    values: bandIndexValues(freqs, bins),
    space: Y_AXIS_SPACE,
  });

  return (
    <Show when={panel()}>
      {(ready) => (
        <div class="pitch-candidates">
          <HeatmapPanel
            testid="pitchCandidates.panel"
            title={() => "Pitch candidates · time × semitone"}
            image={() => panel()?.image ?? null}
            paint={paint}
            x={timeHeatmapAxis(visible)}
            y={yAxis()}
            marks={cursorTimeMarks}
            scale={ready().scale}
            scaleLabel="candidate probability (0–1 per frame)"
          />
          <ChartLegend
            entries={[{ label: "shared cursor", color: chartTheme().mirror, kind: "dashed" }]}
            note="each cell is the detector's probability for that semitone in that frame — brighter means a stronger competing candidate"
          />
        </div>
      )}
    </Show>
  );
}
