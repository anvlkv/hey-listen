import { columnExtent, type Peaks } from "../../lib/waveform";

/**
 * The Timeline's **parallel channel lanes** (M23): the waveform area split into one
 * min/max lane per source channel, stacked and centred, each reading its own envelope
 * from `lib/waveform.ts`. Pure canvas painting — no stores or DOM — so `draw.ts` stays
 * the orchestrator. See `docs/roadmap.md` → M23 → "Parallel channel lanes".
 */

/** Fraction of a lane's half-height the envelope may use. */
const LANE_AMPLITUDE = 0.94;

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

/** Paint one min/max lane per channel, each centred on its own midline. */
export function drawWaveformLanes(
  ctx: CanvasRenderingContext2D,
  lanes: WaveformLanes,
  style: { wave: string; midline: string },
  x2t: (x: number) => number,
): void {
  const { top, height, left, right, samples, frames, channels, sampleRate, peaks } = lanes;
  if (channels <= 0 || frames <= 0 || right <= left) return;
  const laneH = height / channels;
  ctx.lineWidth = 1;

  for (let c = 0; c < channels; c++) {
    const mid = top + laneH * (c + 0.5);
    const half = (laneH / 2) * LANE_AMPLITUDE;

    ctx.strokeStyle = style.wave;
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
