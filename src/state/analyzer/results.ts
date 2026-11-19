import { createSignal } from "solid-js";
import type { ResultSummary } from "../../bindings/ResultSummary";
import type { AnalyzerId, AnyAnalysisResult } from "./types";

/**
 * The latest result per analyzer tool, kept by the mounted tabs so a note can capture
 * a **frozen values snapshot** from a live chart (`state/annotations/`, M14). The
 * project file persists the separate [result cache](cache.ts), which a load seeds, so a
 * reopened project does not re-run every analyzer.
 *
 * The result's **canonical summary** (M21) is kept beside it, because the snapshot's
 * structured items come from the summary of the run that produced the result (D-19).
 */
const [latestResults, setLatestResults] = createSignal<
  Partial<Record<AnalyzerId, AnyAnalysisResult>>
>({});
const [latestSummaries, setLatestSummaries] = createSignal<
  Partial<Record<AnalyzerId, ResultSummary>>
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

/**
 * The canonical summary of the latest **live run** for `tool`, or `null`. A result
 * adopted from the [cache](cache.ts) carries no summary — the project file stores only
 * the result — so the snapshot's items stay empty for it.
 */
export function latestSummary(tool: AnalyzerId): ResultSummary | null {
  return latestSummaries()[tool] ?? null;
}

/** Record (or clear) the latest summary for a tool. */
export function setLatestSummary(tool: AnalyzerId, summary: ResultSummary | null) {
  setLatestSummaries((prev) => {
    if (summary == null) {
      if (!(tool in prev)) return prev;
      const next = { ...prev };
      delete next[tool];
      return next;
    }
    return { ...prev, [tool]: summary };
  });
}
