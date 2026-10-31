import type { Note } from "../../bindings/Note";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import { deepClone } from "../../lib/clone";
import { invoke } from "../../lib/ipc";
import { noteExcerpt } from "../../lib/note";
import { sharedParams } from "../analysis";
import { toolOptions } from "../analyzer";
import { filterEnabled, filterError } from "../graph";
import { focusedNoteId, notesSorted } from "../notes";
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
    notes: notesSorted().map(noteSummary),
    focusedNoteId: focusedNoteId(),
  };
}

/**
 * A compact note summary for `get_state` / `list_notes`: identity, anchor, the frozen
 * values line, and a one-line body excerpt (the full body needs `get_note`).
 */
export function noteSummary(note: Note) {
  return {
    id: note.id,
    timeSecs: note.timeSecs,
    range: note.range,
    tool: note.tool,
    title: note.title,
    values: note.values?.text ?? null,
    body: noteExcerpt(note.body),
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
