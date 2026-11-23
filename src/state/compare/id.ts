import { analyzerById, isAnalyzerId } from "../analyzer/lookup";
import type { AnalyzerId } from "../analyzer/types";

/**
 * Compare panel ids (M23 Phase 3).
 *
 * A compare view is a transient Workbench tab in the **owner** project, addressed as
 * `compare:<tool>:<id>`. The id — not the tool — is the key, because several distinct
 * comparisons (one per reference pair) can be open for one analyzer. It is never in the
 * Sidebar, never a project window, and never part of the saved layout.
 */

/** The compare panel id prefix. */
export const COMPARE_PREFIX = "compare:";

/** One comparison, addressed by its tool and its stable id. */
export interface CompareRef {
  tool: AnalyzerId;
  id: string;
}

/** The panel id for comparison `id` of `tool`. */
export function comparePanelId(tool: AnalyzerId, id: string): string {
  return `${COMPARE_PREFIX}${tool}:${id}`;
}

/** The comparison a panel id names, or `null` for an ordinary / malformed id. */
export function parseComparePanel(panelId: string): CompareRef | null {
  if (!panelId.startsWith(COMPARE_PREFIX)) return null;
  const rest = panelId.slice(COMPARE_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const tool = rest.slice(0, separator);
  const id = rest.slice(separator + 1);
  if (!id || !isAnalyzerId(tool)) return null;
  return { tool, id };
}

/** Whether a panel id is a compare view (even a malformed one). */
export function isCompareId(panelId: string): boolean {
  return panelId.startsWith(COMPARE_PREFIX);
}

/** A per-process counter for [`newCompareId`]'s no-`crypto` fallback. */
let compareCounter = 0;

/**
 * A fresh id for a **new** live comparison.
 *
 * The core upserts the comparison's snapshot by this id, so several pairs of one tool
 * stay distinct; a saved comparison reuses its snapshot's own `id` instead, so a
 * restored tab addresses the same pair.
 */
export function newCompareId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `cmp-${uuid}`;
  compareCounter += 1;
  return `cmp-${Date.now().toString(36)}-${compareCounter.toString(36)}`;
}

/**
 * A comparison's **display** family: the Rust result `Family` plus the two view-only
 * splits (`modulation`, `waveform`), with `scalar` for the readouts. Derived from
 * `AnalyzerView["kind"]`; the core computes the delta for every `Family`, so MCP/CLI
 * compare any tool. Do not confuse it with `Family` (the wire shape).
 *
 * A family is the shape the **delta** has, which is not always the shape the tool's own
 * chart draws: `masking` is a spectrum view because its delta is the spectrum delta over
 * SMR (`masking_delta`), and `loudness` is a series because its delta is the sone track.
 * When a view kind and its delta disagree, the delta wins — the compare chart must read
 * the same curve the Δ line measures.
 */
export type CompareViewFamily =
  | "series"
  | "spectrum"
  | "spectrogram"
  | "matrix"
  | "events"
  | "notes"
  | "modulation"
  | "waveform"
  | "scalar";

/** The display family of a tool's result, derived from its chart view descriptor. */
export function compareViewFamily(tool: AnalyzerId): CompareViewFamily {
  switch (analyzerById(tool).view.kind) {
    case "series":
      return "series";
    case "spectrum":
      return "spectrum";
    case "spectrogram":
      return "spectrogram";
    case "matrix":
      return "matrix";
    case "rhythm":
      return "events";
    case "noteMetrics":
      return "notes";
    case "modulation":
      return "modulation";
    case "waveform":
      return "waveform";
    // A masking result is a spectrum, and the core diffs its SMR curve.
    case "masking":
      return "spectrum";
    // Loudness draws one sone track; the core diffs that same track.
    case "loudness":
      return "series";
    default:
      return "scalar";
  }
}
