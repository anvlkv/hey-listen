import { createMemo } from "solid-js";
import { computePeaks, type Peaks } from "../../lib/waveform";
import { filteredFrames, filteredPcm } from "../../state/filtered";
import { filterActive, filterOutputs } from "../../state/graph";

/**
 * Envelopes for the Timeline's filtered waveform (canvas painting lives in
 * [`draw.ts`](./draw.ts)).
 *
 * A filter graph may declare several output channels — one lane per branch. A single
 * output stays a **tint overlay** over the raw source lanes, so its effect reads as a
 * tint rather than a replacement; several outputs replace the lanes, because there is
 * no one source lane per output to tint.
 */

/** One envelope per filter output channel, in channel order (`[]` when not multi). */
export function createFilteredLanes(): () => Peaks[] {
  return createMemo<Peaks[]>(() => {
    const f = filteredPcm();
    if (!filterActive() || !f || f.channels <= 1) return [];
    const frames = filteredFrames(f);
    if (frames === 0) return [];
    const lanes: Peaks[] = [];
    for (let c = 0; c < f.channels; c++) {
      lanes.push(computePeaks(f.samples, frames, f.channels, c));
    }
    return lanes;
  });
}

/** Envelope of a **single-output** filter, drawn as an overlay over the raw lanes. */
export function createFilteredOverlay(): () => Peaks | null {
  return createMemo<Peaks | null>(() => {
    const f = filteredPcm();
    if (!filterActive() || !f || f.channels !== 1) return null;
    const frames = filteredFrames(f);
    if (frames === 0) return null;
    return computePeaks(f.samples, frames, 1, 0);
  });
}

/**
 * How many lanes the waveform area is split into: one per filter **output channel** when
 * the active graph declares several (even for a mono source), otherwise one per source
 * channel. The rail, the canvas and click-to-select all read this one count.
 */
export function laneChannels(sourceChannels: number): number {
  const source = Math.max(1, sourceChannels);
  if (!filterActive()) return source;
  const outputs = Math.max(1, filterOutputs(), filteredPcm()?.channels ?? 0);
  return Math.max(source, outputs);
}
