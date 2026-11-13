import type { CachedResultInput } from "../../bindings/CachedResultInput";
import type { SourceDescriptor } from "../../bindings/SourceDescriptor";
import { deepClone } from "../../lib/clone";
import { toSpec } from "../../lib/graph";
import { invoke } from "../../lib/ipc";
import { sharedParams } from "../analysis";
import { currentResults as cachedResults, toolOptions } from "../analyzer";
import { choice, deviceId, gain, mixMicDeviceId, mixSystemDeviceId, targetPid } from "../capture";
import { parseComparePanel } from "../compare/id";
import type { CompareViewDto } from "../compare/types";
import { filterActive, filterEnabled, graphLayout, FILTER_GRAPH, SYNTH_GRAPH } from "../graph";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { layoutJson, openCompareIds, openTools } from "../workbench";
import { projectLabel } from "./paths";
import { projectName } from "./signals";
import type { AnalysisSetupDto, CompareOpenDto, LayoutDto, SourceDescriptorDto } from "./types";

/**
 * Read the current stores into the `SOURCE` / `SETUP` / `LAYOUT` shapes the core
 * writes on save (see [`project-file-format.md`](../../../docs/project-file-format.md)).
 */

/** Fill a `SOURCE` descriptor's unused fields with null (the core defaults them too). */
function descriptor(
  fields: Partial<SourceDescriptor> & Pick<SourceDescriptor, "kind">,
): SourceDescriptor {
  return {
    path: null,
    deviceId: null,
    mixMicDeviceId: null,
    mixSystemDeviceId: null,
    targetPid: null,
    gain: 1,
    graph: null,
    ...fields,
  };
}

/** The project's current source descriptor, derived from the source + picker. */
export function currentDescriptor(): SourceDescriptorDto | null {
  const current = source();
  if (!current) return null;
  const pick = choice();
  if (pick === "file") return descriptor({ kind: "file", path: current.probe?.path ?? null });
  if (pick === "synth") {
    return descriptor({ kind: "synth", graph: toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges) });
  }
  return descriptor({
    kind: pick,
    deviceId: pick === "mic" || pick === "system" ? deviceId() : null,
    mixMicDeviceId: pick === "mix" ? mixMicDeviceId() : null,
    mixSystemDeviceId: pick === "mix" ? mixSystemDeviceId() : null,
    targetPid: pick === "process" ? targetPid() : null,
    gain: gain(),
  });
}

export function currentSetup(): AnalysisSetupDto {
  return {
    shared: sharedParams(),
    toolOptions: deepClone(toolOptions),
    openTools: openTools(),
    window: { startSecs: windowStart(), endSecs: windowEnd() },
    view: { startSecs: viewStart(), endSecs: viewEnd() },
    filterEnabled: filterEnabled(),
  };
}

export async function currentLayout(): Promise<LayoutDto> {
  // The core knows which tools are popped out of this project.
  const popouts = await invoke<string[]>("popout_tools").catch(() => []);
  return {
    dockview: layoutJson(),
    graphs: { filter: graphLayout("filter"), synth: graphLayout("synth") },
    popouts,
    // The **compiled** filter, so the CLI's `compare` conditions each side exactly like
    // the app (M25). `null` when no filter is applied. Older files lack the key and
    // compare unfiltered, with a warning.
    filterSpec: filterActive() ? toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges) : null,
  };
}

/**
 * The analyzer results to persist: the result cache's entries for the current source
 * and applied filter (`state/analyzer/cache.ts`). A project restores them on load, so
 * its tabs do not re-run the analyzers.
 */
export function currentResults(): CachedResultInput[] {
  return cachedResults();
}

/**
 * The comparisons open at save time, **one entry per pair** (a compare tab or a compare
 * popout). A compare panel is never in `LAYOUT`, so this is the only record of what to
 * snapshot; the core writes exactly these pairs' saved comparisons.
 */
export async function currentCompareOpen(): Promise<CompareOpenDto[]> {
  const open = new Map<string, CompareOpenDto>();
  for (const panelId of openCompareIds()) {
    const ref = parseComparePanel(panelId);
    if (ref) open.set(ref.id, ref);
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  for (const view of popouts) open.set(view.id, { tool: view.tool, id: view.id });
  return [...open.values()].sort((a, b) => `${a.tool}:${a.id}`.localeCompare(`${b.tool}:${b.id}`));
}

export function defaultFileName(): string {
  const base =
    projectLabel(projectName())
      .trim()
      .replace(/[^\w.-]+/g, "_") || "project";
  return `${base}.heyl`;
}
