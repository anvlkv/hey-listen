import { createSignal } from "solid-js";
import type { MismatchDto, Span } from "./types";

/**
 * A compare view's **notices** (M25): the small facts a comparison has to report — a
 * saved reference, a closed one, a failed run, a delta that only covers the common span,
 * a clipped waveform, and settings that differ.
 *
 * They are transient UI state: never written to the project file, never persisted. Each
 * one is dismissible **per comparison id**, so dismissing today's warning does not hide a
 * new one on the same view; a re-targeted view starts clean ([`resetNotices`]).
 *
 * The copy lives here too, so the badge and the notice strip have one source for it.
 */

/** One kind of notice a comparison can raise. */
export type NoticeKind = "saved" | "closed" | "error" | "span" | "clipped" | "mismatch";

/** The reference is the project's saved snapshot rather than a live project. */
export const SAVED_REFERENCE_NOTE =
  "Saved reference — the reference from the last saved comparison. Pick a live project to reconnect.";

/** The reference project's window is gone; the last result stays on screen. */
export const REFERENCE_CLOSED_NOTE =
  "Reference project closed — showing the last result. Live updates are stopped.";

/** The delta covers the common span only, and the reference is sampled onto A's buckets. */
export const CLIPPED_NOTE =
  "The windows differ — the delta is clipped to the shorter window, and the other envelope is sampled at this side's bucket times.";

/** The shifted windows share no span at all, so there is nothing to diff. */
export const NO_MEETING_NOTE = "The shifted windows do not meet — adjust the fine-tune offset";

/** The dismiss button's accessible name, per notice kind. */
const DISMISS_LABELS: Record<NoticeKind, string> = {
  saved: "Dismiss the saved-reference notice",
  closed: "Dismiss the reference-closed notice",
  error: "Dismiss the error notice",
  span: "Dismiss the common-span notice",
  clipped: "Dismiss the clipping notice",
  mismatch: "Dismiss the differing-settings notice",
};

export function dismissLabel(kind: NoticeKind): string {
  return DISMISS_LABELS[kind];
}

/** Comparison id → the notice kinds the user has dismissed on it. */
const [dismissed, setDismissed] = createSignal<Record<string, NoticeKind[]>>({});

export function isDismissed(id: string, kind: NoticeKind): boolean {
  return dismissed()[id]?.includes(kind) ?? false;
}

export function dismissNotice(id: string, kind: NoticeKind) {
  setDismissed((all) => {
    const current = all[id] ?? [];
    if (current.includes(kind)) return all;
    return { ...all, [id]: [...current, kind] };
  });
}

/** Forget a comparison's dismissals, so a re-targeted view gets a fresh notice surface. */
export function resetNotices(id: string) {
  setDismissed((all) => {
    if (!all[id]) return all;
    const next = { ...all };
    delete next[id];
    return next;
  });
}

/** One comparison's notice surface, keyed by its id. */
export interface CompareNoticeState {
  isDismissed: (kind: NoticeKind) => boolean;
  dismiss: (kind: NoticeKind) => void;
  /** Dismiss several at once (the strip's "Dismiss all"). */
  dismissAll: (kinds: readonly NoticeKind[]) => void;
}

export function compareNotices(id: string): CompareNoticeState {
  return {
    isDismissed: (kind) => isDismissed(id, kind),
    dismiss: (kind) => dismissNotice(id, kind),
    dismissAll: (kinds) => kinds.forEach((kind) => dismissNotice(id, kind)),
  };
}

/**
 * The badge tooltip and the mismatch notice's summary: **one line**, never a dump. The
 * per-key detail is [`mismatchDetail`], rendered once in the strip.
 */
export function mismatchSummary(mismatches: readonly MismatchDto[]): string {
  const count = mismatches.length;
  if (count === 0) return "The two results share a grid, so B − A is computed.";
  const settings = count === 1 ? "setting differs" : "settings differ";
  return `${count} ${settings} — open to see ${count === 1 ? "it" : "them"}`;
}

/** One `key: a → b` line per differing setting. */
export function mismatchDetail(mismatches: readonly MismatchDto[]): string[] {
  return mismatches.map(
    (mismatch) => `${mismatch.key}: ${formatValue(mismatch.a)} → ${formatValue(mismatch.b)}`,
  );
}

/**
 * The common-span line: the delta covers only the part both shifted windows share.
 * `span` is `null` when they do not meet at all.
 */
export function commonSpanNote(span: Span | null): string {
  if (!span) return NO_MEETING_NOTE;
  return `Delta over the common span ${spanLabel(span)}`;
}

/** A span in source seconds (`0.50–1.20 s`) — the compare surfaces' one spelling of it. */
export function spanLabel(span: Span): string {
  return `${span.start.toFixed(2)}–${span.end.toFixed(2)} s`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("–");
  if (value == null) return "—";
  return String(value);
}
