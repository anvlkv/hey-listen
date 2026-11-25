import type { ChannelPick } from "../../lib/waveform";
import { columnExtent, type Peaks } from "../../lib/waveform";

/**
 * The Timeline's **parallel channel lanes** (M23): the waveform area split into one
 * min/max row per lane, stacked and centred, each reading its own envelope from
 * `lib/waveform.ts`. Pure canvas painting — no stores or DOM — so `draw.ts` stays the
 * orchestrator.
 */

/** Fraction of a lane's half-height the envelope may use. */
const LANE_AMPLITUDE = 0.94;

/** Alpha of a lane that is not the analysis pick: slightly dull, still readable. */
const UNSELECTED_ALPHA = 0.55;

/** Width (CSS px) of the casing a pass laid over another waveform draws under itself. */
const CASING_WIDTH = 3;

/**
 * The lane row under `y` (a canvas-relative pointer y), or `null` above the waveform.
 * Rows split the area below the ruler equally, so this is the inverse of the split in
 * [`drawWaveformLanes`].
 */
export function laneAtY(y: number, top: number, height: number, rows: number): number | null {
  if (rows < 1 || height <= 0 || y < top) return null;
  const lane = Math.floor(((y - top) / height) * rows);
  return Math.max(0, Math.min(rows - 1, lane));
}

/** Where the lanes are drawn, and the samples they read. */
export interface WaveformLanes {
  /** Top of the waveform area (below the ruler). */
  top: number;
  /** Full height of the waveform area, split equally between the rows. */
  height: number;
  /** Plot origin, right of the channel rail. */
  left: number;
  right: number;
  /**
   * Lane rows the height is split into. At least the buffer's channel count: a filter
   * graph may declare more outputs than the source has channels, and the source lanes
   * stay drawn underneath.
   */
  rows: number;
  samples: Float32Array;
  frames: number;
  /** Interleaved channel count of `samples` (the stride, not the row count). */
  channels: number;
  sampleRate: number;
  /** One envelope per channel, in channel order. */
  peaks: Peaks[];
}

/** How one pass over the lanes is painted. */
export interface WaveformStyle {
  /** The lane's own waveform. */
  wave: string;
  /** Each row's centre line; omit it on a second pass over already-drawn rows. */
  midline?: string;
  /**
   * A wider stroke in the lane background's colour, drawn under the envelope, so a pass
   * laid over another waveform stays readable in either theme.
   */
  casing?: string;
  /** The shared analysis channel pick, which decides which lane stays at full strength. */
  active: ChannelPick;
}

/**
 * Paint one min/max lane per channel, each centred on its own midline row.
 *
 * The **selected analysis channel** (`active`) draws at full strength; the other lanes
 * draw **slightly dull**, so the lane an analyzer reads is obvious at a glance. Downmix
 * (`active === "mix"`) analyses every lane equally, so every lane stays at full strength.
 */
export function drawWaveformLanes(
  ctx: CanvasRenderingContext2D,
  lanes: WaveformLanes,
  style: WaveformStyle,
  x2t: (x: number) => number,
): void {
  const { top, height, left, right, samples, frames, channels, sampleRate, peaks, rows } = lanes;
  if (channels <= 0 || frames <= 0 || right <= left || rows <= 0) return;
  const laneH = height / rows;
  ctx.lineWidth = 1;

  // Centre lines for **every** row first, so a row the source does not fill (a filter
  // output beyond the source's channels) still reads as a lane.
  if (style.midline) {
    ctx.strokeStyle = style.midline;
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      const mid = top + laneH * (row + 0.5);
      ctx.moveTo(left, mid + 0.5);
      ctx.lineTo(right, mid + 0.5);
    }
    ctx.stroke();
  }

  for (let c = 0; c < channels; c++) {
    const mid = top + laneH * (c + 0.5);
    const half = (laneH / 2) * LANE_AMPLITUDE;
    const selected = style.active === "mix" || style.active === c;
    ctx.globalAlpha = selected ? 1 : UNSELECTED_ALPHA;

    // Build the envelope once and stroke it twice: a wide casing in the lane's own
    // background, then the waveform on top of it.
    ctx.beginPath();
    for (let x = left; x < right; x++) {
      const f0 = x2t(x) * sampleRate;
      const f1 = x2t(x + 1) * sampleRate;
      const [lo, hi] = columnExtent(peaks[c] ?? null, samples, frames, channels, f0, f1, c);
      const yHi = mid - hi * half;
      const yLo = mid - lo * half;
      ctx.moveTo(x + 0.5, Math.min(yHi, yLo));
      ctx.lineTo(x + 0.5, Math.max(yHi, yLo) + 0.5);
    }
    if (style.casing) {
      ctx.strokeStyle = style.casing;
      ctx.lineWidth = CASING_WIDTH;
      ctx.stroke();
    }
    ctx.strokeStyle = style.wave;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
