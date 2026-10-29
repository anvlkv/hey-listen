import { analyzerById, isAnalyzerId } from "../analyzer/lookup";
import type { AnalyzerId } from "../analyzer/types";

/**
 * Compare panel ids (M25).
 *
 * A compare view is a transient Workbench tab in the **owner** project, addressed as
 * `compare:<tool>`. It is one per tool per project (tab *or* popout), never in the
 * Sidebar, never a project window, and never saved. See `docs/comparison.md`.
 */

/** The compare panel id prefix. */
export const COMPARE_PREFIX = "compare:";

/** The panel id for `tool`'s comparison. */
export function comparePanelId(tool: AnalyzerId): string {
  return `${COMPARE_PREFIX}${tool}`;
}

/** The tool a panel id names, or `null` for an ordinary tool id. */
export function parseCompareTool(panelId: string): AnalyzerId | null {
  if (!panelId.startsWith(COMPARE_PREFIX)) return null;
  const tool = panelId.slice(COMPARE_PREFIX.length);
  return isAnalyzerId(tool) ? tool : null;
}

/** Whether a panel id is a compare view (even a malformed one). */
export function isCompareId(panelId: string): boolean {
  return panelId.startsWith(COMPARE_PREFIX);
}

/**
 * A comparison's chart family. It mirrors the Rust `Family` where the view cares
 * (the core computes the delta for every family, so MCP/CLI compare any tool).
 */
export type CompareFamily =
  | "series"
  | "spectrum"
  | "spectrogram"
  | "matrix"
  | "events"
  | "notes"
  | "modulation"
  | "waveform"
  | "scalar";

/** The family of a tool's result, derived from its chart view descriptor. */
export function compareFamily(tool: AnalyzerId): CompareFamily {
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
    default:
      return "scalar";
  }
}

/**
 * Whether M25's compare view can chart this tool. M25 covers **series, spectrum and
 * readouts**; the core delta and MCP/CLI work for every family. M25.A adds matrix,
 * events, `noteMetrics`, modulation and waveform.
 */
export function compareViewable(tool: AnalyzerId): boolean {
  return ["series", "spectrum", "scalar"].includes(compareFamily(tool));
}
