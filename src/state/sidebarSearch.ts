import { createMemo, createSignal } from "solid-js";
import { ANALYZER_SECTIONS, analyzersInSection, matchesQuery } from "./analyzer";
import type { AnalyzerSection } from "./analyzer/types";

/**
 * The Sidebar's analyzer search, shared by the two surfaces that answer it.
 *
 * The Sidebar filters its cards with the query; the **Activity bar** marks the sections
 * that hold a match while another section is showing, so a search never hides its hits
 * behind an inactive tab. Living here (rather than in `Sidebar.tsx`) also keeps the query
 * alive while the rail is collapsed — the component unmounts, the search does not.
 */
export const [analyzerQuery, setAnalyzerQuery] = createSignal("");

/** Matching analyzers per section for the current query (empty while the search is idle). */
export const sectionMatchCounts = createMemo<Partial<Record<AnalyzerSection, number>>>(() => {
  const query = analyzerQuery();
  const counts: Partial<Record<AnalyzerSection, number>> = {};
  if (query.trim() === "") return counts;
  for (const section of ANALYZER_SECTIONS) {
    const count = analyzersInSection(section.id).filter((def) => matchesQuery(def, query)).length;
    if (count > 0) counts[section.id] = count;
  }
  return counts;
});
