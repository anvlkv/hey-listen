import type { ChannelPick } from "../../lib/waveform";
import { columnExtent, type Peaks } from "../../lib/waveform";

/**
 * The Timeline's **parallel channel lanes** (M23): the waveform area split into one
 * min/max lane per source channel, stacked and centred, each reading its own envelope
 * from `lib/waveform.ts`. Pure canvas painting — no stores or DOM — so `draw.ts` stays
 * the orchestrator. See `docs/roadmap.md` → M23 → "Parallel channel lanes".
 */

/** Fraction of a lane's half-height the envelope may use. */
const LANE_AMPLITUDE = 0.94;

/**
 * The channel lane under `y` (a canvas-relative pointer y), or `null` above the waveform.
 * Lanes split the area below the ruler equally, so this is the inverse of the lane split
 * in [`drawWaveformLanes`].
 */
export function laneAtY(y: number, top: number, height: number, channels: number): number | null {
  if (channels < 1 || height <= 0 || y < top) return null;
  const lane = Math.floor(((y - top) / height) * channels);
  return Math.max(0, Math.min(channels - 1, lane));
}

/** Where the lanes are drawn, and the samples they read. */
export interface WaveformLanes {
  /** Top of the waveform area (below the ruler). */
  top: number;
  /** Full height of the waveform area, split equally between the channels. */
  height: number;
  /** Plot origin, right of the channel rail. */
  left: number;
  right: number;
  samples: Float32Array;
  frames: number;
  channels: number;
  sampleRate: number;
  /** One envelope per channel, in channel order. */
  peaks: Peaks[];
}

/**
 * Paint one min/max lane per channel, each centred on its own midline.
 *
 * The **selected analysis channel** (`active`) draws in the full series colour; the other
 * lanes draw **dimmed**, so the lane an analyzer reads is obvious at a glance. Downmix
 * (`active === "mix"`) analyses every lane equally, so every lane stays at full strength.
 */
export function drawWaveformLanes(
  ctx: CanvasRenderingContext2D,
  lanes: WaveformLanes,
  style: { wave: string; dimmed: string; midline: string; active: ChannelPick },
  x2t: (x: number) => number,
): void {
  const { top, height, left, right, samples, frames, channels, sampleRate, peaks } = lanes;
  if (channels <= 0 || frames <= 0 || right <= left) return;
  const laneH = height / channels;
  ctx.lineWidth = 1;

  for (let c = 0; c < channels; c++) {
    const mid = top + laneH * (c + 0.5);
    const half = (laneH / 2) * LANE_AMPLITUDE;
    const selected = style.active === "mix" || style.active === c;

    ctx.strokeStyle = selected ? style.wave : style.dimmed;
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
    ctx.stroke();

    ctx.strokeStyle = style.midline;
    ctx.beginPath();
    ctx.moveTo(left, mid + 0.5);
    ctx.lineTo(right, mid + 0.5);
    ctx.stroke();
  }
}
