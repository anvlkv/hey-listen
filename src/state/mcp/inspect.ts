import type { Note } from "../../bindings/Note";
import { deepClone } from "../../lib/clone";
import { sharedParams } from "../analysis";
import { toolOptions } from "../analyzer";
import { filterEnabled, filterError } from "../graph";
import { focusedNoteId, notesSorted } from "../notes";
import { outputDeviceId, outputGain } from "../output";
import { dirty, projectDisplayName, projectPath } from "../project";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { openTools } from "../workbench";

/** The observable project state an agent reads to follow the user. */
export function getState(target?: string) {
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
    filter: { enabled: filterEnabled(), error: filterError() },
    output: { gain: outputGain(), device: outputDeviceId() },
    notes: notesSorted().map(noteSummary),
    focusedNoteId: focusedNoteId(),
  };
}

/** A compact note summary for `get_state` (id/time/tool/title + the values line). */
function noteSummary(note: Note) {
  return {
    id: note.id,
    timeSecs: note.timeSecs,
    range: note.range,
    tool: note.tool,
    title: note.title,
    values: note.values?.text ?? null,
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
