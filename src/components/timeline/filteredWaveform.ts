import type { Peaks } from "../../lib/waveform";
import { columnExtent } from "../../lib/waveform";
import { channel } from "../../state/analysis";
import { filteredFrames, filteredPcm } from "../../state/filtered";
import { filterActive } from "../../state/graph";
import { drawWaveformLanes } from "./waveformLanes";

/**
 * Painting the Timeline's **filtered** waveform.
 *
 * A filter graph may declare several output channels — one lane per branch. When it
 * does, those outputs replace the source lanes (there is no one source lane per output
 * to tint). A single output stays a translucent **tint overlay** over the raw source
 * lanes, so its effect reads as a tint on the signal rather than a replacement.
 */

/** The filtered overlay's opacity: 85% opaque, so it **blends with** the raw waveform. */
const FILTERED_OVERLAY_ALPHA = 0.85;

/** Where the waveform is painted. */
export interface WaveformArea {
  top: number;
  height: number;
  left: number;
  right: number;
  /** Source sample rate (filtered frames align 1:1 with the raw waveform). */
  sampleRate: number;
}

/** Lane colours for the filtered waveform. */
export interface WaveformStyle {
  wave: string;
  dimmed: string;
  midline: string;
}

/**
 * Paint one lane per filter output channel, each selectable like a source channel.
 * Returns `false` when the filter has 0–1 outputs, so the caller draws the raw lanes
 * instead.
 */
export function drawFilteredLanes(
  ctx: CanvasRenderingContext2D,
  area: WaveformArea,
  style: WaveformStyle,
  lanes: Peaks[],
  x2t: (x: number) => number,
): boolean {
  const f = filteredPcm();
  if (!filterActive() || !f || f.channels <= 1 || lanes.length <= 1) return false;
  drawWaveformLanes(
    ctx,
    {
      top: area.top,
      height: area.height,
      left: area.left,
      right: area.right,
      samples: f.samples,
      frames: filteredFrames(f),
      channels: f.channels,
      sampleRate: area.sampleRate,
      peaks: lanes,
    },
    { wave: style.wave, dimmed: style.dimmed, midline: style.midline, active: channel() },
    x2t,
  );
  return true;
}

/** Paint a single-output filter's envelope as a tint over the raw source lanes. */
export function drawFilteredOverlay(
  ctx: CanvasRenderingContext2D,
  area: WaveformArea,
  peaks: Peaks | null,
  wave: string,
  x2t: (x: number) => number,
): void {
  const f = filteredPcm();
  if (!filterActive() || !f || f.channels !== 1 || !peaks) return;
  const frames = filteredFrames(f);
  if (frames === 0) return;

  const mid = area.top + area.height / 2;
  const half = (area.height / 2) * 0.94;
  ctx.globalAlpha = FILTERED_OVERLAY_ALPHA;
  ctx.strokeStyle = wave;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = area.left; x < area.right; x++) {
    const f0 = x2t(x) * area.sampleRate;
    const f1 = x2t(x + 1) * area.sampleRate;
    const [flo, fhi] = columnExtent(peaks, f.samples, frames, 1, f0, f1, 0);
    const fyHi = mid - fhi * half;
    const fyLo = mid - flo * half;
    ctx.moveTo(x + 0.5, Math.min(fyHi, fyLo));
    ctx.lineTo(x + 0.5, Math.max(fyHi, fyLo) + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
