import { createSignal } from "solid-js";
import type { ChannelPick } from "../lib/waveform";

/**
 * Shared analysis params (ADR-6): one frontend store the Timeline and every
 * analyzer tab read, so signal conditioning stays consistent across the app.
 * Frame / spectral params (FFT size, hop/overlap, window function, frequency
 * range) land here in M4.
 */

/**
 * Which channel of the source to analyse: `"mix"` downmixes every channel to
 * mono, a number selects a 0-based channel. See `docs/data-model.md`.
 */
export const [channel, setChannel] = createSignal<ChannelPick>("mix");

/** The pick clamped to a source's channel count (out-of-range falls back to the mix). */
export function channelFor(channels: number): ChannelPick {
  const pick = channel();
  return typeof pick === "number" && pick >= 0 && pick < channels ? pick : "mix";
}

export interface ChannelOption {
  value: ChannelPick;
  label: string;
}

/** Selector options for a source: downmix first, then one entry per channel. */
export function channelOptions(channels: number): ChannelOption[] {
  const options: ChannelOption[] = [{ value: "mix", label: "Downmix (mono)" }];
  for (let i = 0; i < channels; i++) {
    const label = channels === 2 ? (i === 0 ? "Left" : "Right") : `Channel ${i + 1}`;
    options.push({ value: i, label });
  }
  return options;
}
