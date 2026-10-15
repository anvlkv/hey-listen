import { createSignal } from "solid-js";
import type { AnalyzerId, AnyAnalysisResult } from "./types";

/**
 * The latest result per analyzer tool, kept by the mounted tabs so a note can capture
 * a **frozen values snapshot** from a live chart (`state/notes/`, M14). Not persisted
 * — the analyzers re-derive results on load.
 */
const [latestResults, setLatestResults] = createSignal<
  Partial<Record<AnalyzerId, AnyAnalysisResult>>
>({});

/** The most recent result for `tool`, or `null` (no tab has computed one yet). */
export function latestResult(tool: AnalyzerId): AnyAnalysisResult | null {
  return latestResults()[tool] ?? null;
}

/** Record (or clear) the latest result for a tool. */
export function setLatestResult(tool: AnalyzerId, result: AnyAnalysisResult | null) {
  setLatestResults((prev) => {
    if (result == null) {
      if (!(tool in prev)) return prev;
      const next = { ...prev };
      delete next[tool];
      return next;
    }
    return { ...prev, [tool]: result };
  });
}
