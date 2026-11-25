import { createMemo } from "solid-js";
import { computePeaks, type Peaks } from "../../lib/waveform";
import { filteredFrames, filteredPcm } from "../../state/filtered";
import { filterActive } from "../../state/graph";

/**
 * The lanes for the Timeline's waveform (canvas painting lives in
 * [`filteredWaveform.ts`](./filteredWaveform.ts)).
 *
 * The source lanes are always drawn, one per source channel. While a filter is applied,
 * the graph's **output channels** are drawn over them, one row each — so a graph that
 * splits the signal into several branches adds rows instead of replacing the source, and
 * turning the filter off takes those rows (and their selection entries) away again.
 */

/** One envelope per filter output channel, in channel order (`[]` when not applied). */
export function createFilteredLanes(): () => Peaks[] {
  return createMemo<Peaks[]>(() => {
    const f = filteredPcm();
    if (!filterActive() || !f) return [];
    const frames = filteredFrames(f);
    if (frames === 0) return [];
    const lanes: Peaks[] = [];
    for (let c = 0; c < f.channels; c++) {
      lanes.push(computePeaks(f.samples, frames, f.channels, c));
    }
    return lanes;
  });
}

/** How many leading lane rows are the filter graph's outputs (0 while it is not applied). */
export function laneFilterOutputs(): number {
  return filterActive() ? Math.max(0, filteredPcm()?.channels ?? 0) : 0;
}

/**
 * How many lanes the waveform area is split into: one per source channel, plus any filter
 * output rows beyond them. The rail, the canvas and click-to-select all read this one
 * count, so the lane a click picks is always the lane that is drawn.
 */
export function laneChannels(sourceChannels: number): number {
  return Math.max(1, sourceChannels, laneFilterOutputs());
}
