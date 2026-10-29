import { createSignal } from "solid-js";
import { invoke } from "../../lib/ipc";
import type { AnalyzerId } from "../analyzer";
import { compareViewable } from "./id";
import type { CompareTargetDto } from "./types";
import { openCompare } from "./views";

/**
 * The reference picker (M25).
 *
 * A comparison needs **two open projects**. The picker lists every other project
 * window (never a popout) with its display name, source shape and analysis window; a
 * project with no source is listed but disabled. With one project open, it explains
 * how to open another instead of pretending a comparison is possible.
 * See `docs/comparison.md` → "Entry points".
 */

/** The projects the picker can reference (refreshed on open). */
export const [compareTargets, setCompareTargets] = createSignal<CompareTargetDto[]>([]);

/** The tool whose reference is being picked, or `null` when the dialog is closed. */
export const [pickerTool, setPickerTool] = createSignal<AnalyzerId | null>(null);

/** A transient one-line notice (no analyzer focused, or no second project open). */
export const [compareNotice, setCompareNotice] = createSignal<string | null>(null);

let noticeTimer: number | undefined;

/** Show a transient notice, replacing any previous one. */
export function showCompareNotice(message: string) {
  setCompareNotice(message);
  if (noticeTimer != null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => setCompareNotice(null), 3_200);
}

/** Fetch the referenceable projects from the core. */
export async function refreshCompareTargets(): Promise<CompareTargetDto[]> {
  const targets = await invoke<CompareTargetDto[]>("compare_targets").catch((err) => {
    console.error("could not list the projects to compare", err);
    return [] as CompareTargetDto[];
  });
  setCompareTargets(targets);
  return targets;
}

/**
 * Open the picker for `tool` (or explain why it cannot open). This is the one entry
 * point behind both the tab menu and the native Analysis menu.
 */
export async function chooseCompareReference(tool: AnalyzerId) {
  if (!compareViewable(tool)) {
    showCompareNotice(
      "This tool's comparison chart arrives with M25.A — use compare_analysis or the CLI.",
    );
    return;
  }
  const targets = await refreshCompareTargets();
  if (targets.length === 0) {
    showCompareNotice(
      "A comparison needs two projects. Open another window (File → New Window), then compare again.",
    );
    return;
  }
  setPickerTool(tool);
}

/** Pick a target: open (or retarget) the comparison and close the dialog. */
export async function pickCompareTarget(tool: AnalyzerId, target: CompareTargetDto) {
  setPickerTool(null);
  if (!target.ready) {
    showCompareNotice(`“${target.name}” has no audio source yet.`);
    return;
  }
  await openCompare(tool, target.label);
}

/** A project's one-line shape label (`48 kHz · 1 ch · 12.4 s`). */
export function shapeLabel(source: CompareTargetDto["source"]): string {
  if (!source) return "no source";
  const rate =
    source.sampleRate >= 1000
      ? `${(source.sampleRate / 1000).toFixed(1)} kHz`
      : `${source.sampleRate} Hz`;
  const channels = source.channels === 2 ? "stereo" : `${source.channels} ch`;
  return `${rate} · ${channels} · ${source.duration.toFixed(1)} s`;
}

/** A target's analysis window label (`0.00–2.40 s`). */
export function targetWindowLabel(target: CompareTargetDto): string {
  if (!target.window) return "window —";
  const { start, end } = target.window;
  return `${start.toFixed(2)}–${end.toFixed(2)} s`;
}
