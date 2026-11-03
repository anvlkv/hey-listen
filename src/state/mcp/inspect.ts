import type { Annotation } from "../../bindings/Annotation";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import { deepClone } from "../../lib/clone";
import { invoke } from "../../lib/ipc";
import { annotationExcerpt } from "../../lib/annotation";
import { sharedParams } from "../analysis";
import { toolOptions } from "../analyzer";
import { filterEnabled, filterError } from "../graph";
import { selectedAnnotationId, annotationsSorted } from "../annotations";
import { outputDeviceId, outputGain } from "../output";
import { dirty, projectDisplayName, projectPath } from "../project";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { openTools } from "../workbench";
import { openCompareTabs } from "../compare/views";
import type { CompareViewDto } from "../compare/types";

/** The observable project state an agent reads to follow the user. */
export async function getState(target?: string) {
  // Compare views are **transient** (M25): they are reported separately, never as
  // `openTools`, because they are not project content. A saved reference's offset is
  // read from the core's snapshot (M25.C) — a compare popout reports no offset of its own.
  const [popouts, saved] = await Promise.all([
    invoke<CompareViewDto[]>("compare_popouts").catch(() => []),
    invoke<SavedComparisonInfo[]>("compare_saved", {}).catch(() => []),
  ]);
  const offsets = new Map<string, number>(saved.map((info) => [info.tool, info.bOffset]));
  return {
    project: {
      name: projectDisplayName(),
      path: projectPath(),
      dirty: dirty(),
      // Which project window this call is looking at (multi-project addressing).
      window: target ?? null,
    },
    source: sourceSummary(),
    window: { start: windowStart(), end: windowEnd() },
    view: { start: viewStart(), end: viewEnd() },
    params: sharedParams(),
    toolOptions: deepClone(toolOptions),
    openTools: openTools(),
    compare: [
      ...openCompareTabs(),
      ...popouts.map((view) => ({ ...view, offset: offsets.get(view.tool) ?? 0 })),
    ],
    filter: { enabled: filterEnabled(), error: filterError() },
    output: { gain: outputGain(), device: outputDeviceId() },
    annotations: annotationsSorted().map(annotationSummary),
    selectedAnnotationId: selectedAnnotationId(),
  };
}

/**
 * A compact annotation summary for `get_state` / `list_annotations`: identity, anchor, the frozen
 * values line, and a one-line body excerpt (the full body needs `get_annotation`).
 */
export function annotationSummary(annotation: Annotation) {
  return {
    id: annotation.id,
    timeSecs: annotation.timeSecs,
    range: annotation.range,
    tool: annotation.tool,
    title: annotation.title,
    values: annotation.values?.text ?? null,
    body: annotationExcerpt(annotation.body),
  };
}

/** The source's shape, or `null` when there is none. */
export function sourceSummary() {
  const current = source();
  if (!current) return null;
  return {
    name: current.name,
    sampleRate: current.sampleRate,
    channels: current.channels,
    frames: current.frames,
    duration: current.duration,
    live: current.live ?? false,
  };
}
