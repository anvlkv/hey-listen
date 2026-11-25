import type { Peaks } from "../../lib/waveform";
import { filteredFrames, filteredPcm } from "../../state/filtered";
import { filterActive } from "../../state/graph";
import { drawWaveformLanes, type WaveformStyle } from "./waveformLanes";

/**
 * Painting the filter graph's output lanes on the Timeline.
 *
 * The source lanes stay as the **background** — one row per source channel — and the
 * graph's outputs are painted **over** them, one row per output channel, in the theme's
 * filtered colour. The overlaid pass is *cased* (see `WaveformStyle.casing`): a wider
 * stroke in the lane background cuts the source waveform where the filter's crosses it,
 * so the two read as two signals in either theme instead of one line hiding the other.
 * Turning the filter off removes the overlay (and the rows it added).
 */

/** Where the waveform is painted. */
export interface WaveformArea {
  top: number;
  height: number;
  left: number;
  right: number;
  /** Source sample rate (filtered frames align 1:1 with the raw waveform). */
  sampleRate: number;
}

/**
 * Paint one lane row per filter output channel, over the source lanes. Returns `false`
 * when no filtered audio is ready, so the caller leaves the source alone.
 */
export function drawFilteredLanes(
  ctx: CanvasRenderingContext2D,
  area: WaveformArea,
  style: WaveformStyle,
  lanes: Peaks[],
  rows: number,
  x2t: (x: number) => number,
): boolean {
  const f = filteredPcm();
  if (!filterActive() || !f || lanes.length === 0) return false;
  drawWaveformLanes(
    ctx,
    {
      ...area,
      rows,
      samples: f.samples,
      frames: filteredFrames(f),
      channels: f.channels,
      peaks: lanes,
    },
    style,
    x2t,
  );
  return true;
}
