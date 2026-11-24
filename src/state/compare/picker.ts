import { createSignal } from "solid-js";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import { invoke } from "../../lib/ipc";
import type { AnalyzerId } from "../analyzer";
import { dockApi } from "../workbench";
import { comparePanelId } from "./id";
import type { CompareTargetDto } from "./types";
import {
  fetchSaved,
  openCompare,
  openCompareSaved,
  savedInfo,
  setReference,
  setSavedReference,
} from "./views";

/**
 * The reference picker (M23 Phase 3).
 *
 * A comparison needs **two open projects** — or *one* project plus one of its **saved
 * comparisons**. The picker lists every other project window (never a popout) with its
 * display name, source shape and analysis window; a project with no source is listed
 * but disabled. A saved comparison is offered per pair (`Saved: <name>`), even with one
 * project open. Picking a reference opens a **new** compare tab, unless the picker was
 * opened from an existing comparison (a retarget).
 * points".
 */

/** The projects the picker can reference (refreshed on open). */
export const [compareTargets, setCompareTargets] = createSignal<CompareTargetDto[]>([]);

/** The project's saved comparisons, one per pair (refreshed on open). */
export const [compareSaved, setCompareSaved] = createSignal<SavedComparisonInfo[]>([]);

/** The tool whose reference is being picked, or `null` when the dialog is closed. */
export const [pickerTool, setPickerTool] = createSignal<AnalyzerId | null>(null);

/** The comparison being retargeted, or `null` when the picker opens a new tab. */
export const [pickerId, setPickerId] = createSignal<string | null>(null);

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

/** Fetch every saved comparison of `tool` (one per pair) and cache it for the picker. */
export async function refreshCompareSaved(tool: AnalyzerId): Promise<SavedComparisonInfo[]> {
  const saved = await fetchSaved(tool);
  setCompareSaved(saved);
  return saved;
}

/** Close the picker, forgetting which comparison it would retarget. */
export function closeComparePicker() {
  setPickerTool(null);
  setPickerId(null);
}

/**
 * Open the picker for `tool` (or explain why it cannot open).
 *
 * With an `id` the picker retargets that open comparison; without one it opens a **new**
 * tab. This is the one entry point behind the tab menu, the native Analysis menu and the
 * analyzer toolbar.
 */
export async function chooseCompareReference(tool: AnalyzerId, id: string | null = null) {
  const [targets, saved] = await Promise.all([refreshCompareTargets(), refreshCompareSaved(tool)]);
  if (targets.length === 0 && saved.length === 0) {
    showCompareNotice(
      "A comparison needs two projects (or a saved comparison). Open another window (File → New Window), then compare again.",
    );
    return;
  }
  setPickerId(id);
  setPickerTool(tool);
}

/**
 * Bring a retargeted comparison to the front.
 *
 * dockview unmounts a hidden panel, and an unmounted compare view never mounts its
 * comparison effect — so a reference changed from the **tab context menu** (where the
 * tab may be behind its analyzer) would leave the view blank until the user clicked it.
 * A new tab (`openCompare` / `openCompareSaved`) activates itself; a retarget must too.
 */
function activateCompareTab(tool: AnalyzerId, id: string) {
  dockApi()?.getPanel(comparePanelId(tool, id))?.api.setActive();
}

/** Pick a target: open (or retarget) the comparison and close the dialog. */
export async function pickCompareTarget(tool: AnalyzerId, target: CompareTargetDto) {
  const id = pickerId();
  closeComparePicker();
  if (!target.ready) {
    showCompareNotice(`“${target.name}” has no audio source yet.`);
    return;
  }
  if (id) {
    setReference(tool, id, target.label);
    activateCompareTab(tool, id);
  } else {
    await openCompare(tool, target.label);
  }
}

/** Pick one of the tool's saved comparisons: open (or retarget) it at that snapshot. */
export async function pickSavedComparison(tool: AnalyzerId, info: SavedComparisonInfo) {
  const id = pickerId();
  closeComparePicker();
  if (id) {
    setSavedReference(tool, id, info);
    activateCompareTab(tool, id);
  } else {
    await openCompareSaved(tool, undefined, info);
  }
}

/**
 * The open project that **is** the saved reference's project, or `null`.
 *
 * Both sides are absolute paths as the core recorded them, so they compare as plain
 * strings. This lives here rather than in `views.ts` because `picker.ts` already imports
 * `views.ts`; the other direction would close a module cycle.
 */
export function openReferenceTarget(tool: AnalyzerId, id: string): CompareTargetDto | null {
  const path = savedInfo(tool, id)?.referencePath;
  if (!path) return null;
  return compareTargets().find((target) => target.path === path) ?? null;
}

/**
 * Refresh a saved comparison from the reference project that is now open, by binding the
 * view to it: it re-runs as a live comparison, which also refreshes the snapshot, its
 * stored audio and the result. Returns whether a target matched; never opens a tab.
 */
export async function updateFromOpenReference(tool: AnalyzerId, id: string): Promise<boolean> {
  const target = openReferenceTarget(tool, id);
  if (!target) return false;
  setReference(tool, id, target.label);
  return true;
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

/** A saved snapshot's window label (`0.00–2.40 s`). */
export function savedWindowLabel(saved: SavedComparisonInfo): string {
  const { start, end } = saved.window;
  return `${start.toFixed(2)}–${end.toFixed(2)} s`;
}
