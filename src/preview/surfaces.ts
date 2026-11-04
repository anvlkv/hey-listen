/**
 * The preview surface matrix.
 *
 * A **surface** is one distinct UI state or view the app can render: the empty
 * project, a project with audio, the annotations rail, the two graph editors, the
 * comparison and popout chrome, the About dialog, and **one analyzer per chart view
 * kind** — the analyzer tabs share a renderer, so auditing every tool would repeat
 * the same DOM.
 *
 * The list is the single source for both the preview shell (`?fixture=<id>`) and the
 * Lighthouse runner; it derives its analyzer picks from `ANALYZERS`, so a new view
 * kind joins the matrix without a second list to edit.
 */

import { ANALYZERS } from "../state/analyzer/defs";
import type { AnalyzerDef, AnalyzerSection } from "../state/analyzer/types";

/** What kind of page a surface is (drives the report grouping). */
export type SurfaceKind = "state" | "analyzer" | "graph" | "compare" | "window" | "dialog";

export interface PreviewSurface {
  /** The `?fixture=` value. */
  id: string;
  title: string;
  kind: SurfaceKind;
  /** The Sidebar section, for analyzer surfaces. */
  section?: AnalyzerSection;
}

/** One representative analyzer per `AnalyzerView["kind"]`, in registry order. */
function analyzerSurfaces(): PreviewSurface[] {
  const seen = new Set<string>();
  const picks: PreviewSurface[] = [];
  for (const def of ANALYZERS) {
    const kind = def.view.kind;
    if (seen.has(kind)) continue;
    seen.add(kind);
    picks.push(surfaceFor(def));
  }
  return picks;
}

function surfaceFor(def: AnalyzerDef): PreviewSurface {
  return {
    id: def.id,
    title: `${def.title} — ${def.view.kind}`,
    kind: "analyzer",
    section: def.section,
  };
}

/** Every surface, in report order: shell states, analyzers, chrome, dialogs. */
export const PREVIEW_SURFACES: PreviewSurface[] = [
  { id: "empty", title: "Empty project", kind: "state" },
  { id: "source", title: "Project with audio", kind: "state" },
  { id: "annotations", title: "Annotations rail", kind: "state" },
  ...analyzerSurfaces(),
  { id: "filter", title: "Filter graph editor", kind: "graph" },
  { id: "synth", title: "Synth graph editor", kind: "graph" },
  { id: "compare", title: "Comparison (readouts)", kind: "compare" },
  { id: "compareSeries", title: "Comparison (series)", kind: "compare" },
  { id: "popout", title: "Popout analyzer window", kind: "window" },
  { id: "about", title: "About dialog", kind: "dialog" },
];

/** The surface for a fixture id (a manually requested analyzer is allowed too). */
export function previewSurface(id: string): PreviewSurface | undefined {
  const surface = PREVIEW_SURFACES.find((item) => item.id === id);
  if (surface) return surface;
  const def = ANALYZERS.find((item) => item.id === id);
  return def ? surfaceFor(def) : undefined;
}
