import type { EventsDiffDto, EventPairingDto } from "../../state/compare/types";

/**
 * Pairing helpers for the rhythm compare view (M25.A): which event sets a tool shows,
 * and the one-line matched / only-A / only-B summary the readouts use.
 */

/** An event list kind a rhythm tool draws. */
export type EventKind = "onsets" | "beats" | "downbeats";

/** One event set as the compare chart draws it. */
export interface PairingSet {
  kind: EventKind;
  label: string;
  pairing: EventPairingDto;
  /** Downbeats are drawn heavier than beats / onsets, as in the analyzer view. */
  width: number;
}

const LABELS: Record<EventKind, string> = {
  onsets: "Onsets",
  beats: "Beats",
  downbeats: "Downbeats",
};

const WIDTHS: Record<EventKind, number> = { onsets: 1, beats: 1, downbeats: 2 };

/** The event sets a tool's chart shows, in the order its markers declare them. */
export function pairingSets(kinds: readonly EventKind[], diff: EventsDiffDto): PairingSet[] {
  return kinds.map((kind) => ({
    kind,
    label: LABELS[kind],
    pairing: diff[kind],
    width: WIDTHS[kind],
  }));
}

/** `3 matched · 1 only A · 2 only B` (plus the mean |Δt| when anything matched). */
export function pairingSummary(pairing: EventPairingDto): string {
  const mean =
    pairing.meanAbsDt == null ? "" : ` · mean |Δt| ${(pairing.meanAbsDt * 1000).toFixed(1)} ms`;
  return `${pairing.matched} matched · ${pairing.onlyA} only A · ${pairing.onlyB} only B${mean}`;
}
