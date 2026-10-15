import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { Note } from "../../bindings/Note";
import type { NoteValues } from "../../bindings/NoteValues";
import {
  analyzerById,
  isAnalyzerId,
  latestResult,
  toolOptions,
  type AnalyzerId,
  type AnyAnalysisResult,
} from "../analyzer";
import { sharedParams } from "../analysis";
import { windowEnd, windowStart } from "../timeline";
import { valuesText } from "./format";

/** The frozen snapshot for a tool's chart at `timeSecs`, or `null` without a result. */
export function captureValues(
  tool: AnalyzerId,
  timeSecs: number,
  capturedMs: number,
): NoteValues | null {
  const result = latestResult(tool);
  return result ? snapshot(tool, result, timeSecs, capturedMs) : null;
}

/** Build a `NoteValues` snapshot from a live result (the readout at the note's time). */
export function noteValuesFor(args: {
  tool: AnalyzerId;
  result: AnyAnalysisResult;
  timeSecs: number;
  window: AnalysisWindow;
  params: NoteValues["params"];
  options: Record<string, number>;
  capturedMs: number;
}): NoteValues {
  const def = analyzerById(args.tool);
  return {
    tool: args.tool,
    label: `${def.title} @ ${args.timeSecs.toFixed(3)} s`,
    text: valuesText(def.id, args.result, args.timeSecs),
    window: args.window,
    params: args.params,
    options: args.options,
    capturedMs: args.capturedMs,
  };
}

/** The frozen snapshot's **current** readout (live from the chart), or `null`. */
export function liveValues(note: Note): NoteValues | null {
  if (!note.tool || !isAnalyzerId(note.tool)) return null;
  // A note anchored outside the current window has no *current* readout — the chart
  // cannot show that time at all, so the row falls back to the frozen snapshot alone.
  if (note.timeSecs < windowStart() || note.timeSecs > windowEnd()) return null;
  const tool = note.tool;
  const result = latestResult(tool);
  return result
    ? snapshot(tool, result, note.timeSecs, note.values?.capturedMs ?? Date.now())
    : null;
}

/**
 * Build a snapshot, catching a formatter failure so it can never escape into the note
 * store. Both the capture path (creating / editing a note) and the live-readout path
 * (the row's values line) route through here: the snapshot is a *subtitle*, so losing
 * it must never cost the user their note or blank the rail.
 */
function snapshot(
  tool: AnalyzerId,
  result: AnyAnalysisResult,
  timeSecs: number,
  capturedMs: number,
): NoteValues | null {
  try {
    return noteValuesFor({
      tool,
      result,
      timeSecs,
      window: { startSecs: windowStart(), endSecs: windowEnd() },
      params: sharedParams(),
      options: { ...toolOptions[tool] },
      capturedMs,
    });
  } catch (err) {
    console.error(`could not read ${tool}'s values at ${timeSecs} s`, err);
    return null;
  }
}

/** True when the live readout's **values line** differs from the frozen snapshot. */
export function noteValuesStale(note: Note): boolean {
  if (!note.values) return false;
  const live = liveValues(note);
  return live != null && live.text !== note.values.text;
}
