import { ANALYZERS } from "./defs";
import type { AnalyzerDef, AnalyzerId, AnalyzerSection } from "./types";

export function analyzerById(id: AnalyzerId): AnalyzerDef {
  const def = ANALYZERS.find((item) => item.id === id);
  if (!def) throw new Error(`unknown analyzer: ${id}`);
  return def;
}

export function isAnalyzerId(id: string): id is AnalyzerId {
  return ANALYZERS.some((item) => item.id === id);
}

export function analyzersInSection(section: AnalyzerSection): AnalyzerDef[] {
  return ANALYZERS.filter((item) => item.section === section);
}

/** True if the tool matches the search query by title, description, or keyword. */
export function matchesQuery(def: AnalyzerDef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [def.title, def.description, ...def.keywords].join(" ").toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}
