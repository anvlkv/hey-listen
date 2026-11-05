import type { CachedResultInput } from "../../bindings/CachedResultInput";
import type { SourceDescriptor } from "../../bindings/SourceDescriptor";
import { deepClone } from "../../lib/clone";
import { toSpec } from "../../lib/graph";
import { invoke } from "../../lib/ipc";
import { sharedParams } from "../analysis";
import { currentResults as cachedResults, isAnalyzerId, toolOptions } from "../analyzer";
import type { AnalyzerId } from "../analyzer";
import { choice, deviceId, gain, mixMicDeviceId, mixSystemDeviceId, targetPid } from "../capture";
import { parseCompareTool } from "../compare/id";
import type { CompareViewDto } from "../compare/types";
import { filterActive, filterEnabled, graphLayout, FILTER_GRAPH, SYNTH_GRAPH } from "../graph";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { layoutJson, openCompareIds, openTools } from "../workbench";
import { projectLabel } from "./paths";
import { projectName } from "./signals";
import type { AnalysisSetupDto, LayoutDto, SourceDescriptorDto } from "./types";

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
 * The comparison tools open at save time: compare **tabs** plus compare **popouts**
 * (both save their reference snapshot; a compare panel is never in `LAYOUT`).
 */
export async function currentCompareOpen(): Promise<AnalyzerId[]> {
  const tools = new Set<AnalyzerId>();
  for (const id of openCompareIds()) {
    const tool = parseCompareTool(id);
    if (tool) tools.add(tool);
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  for (const view of popouts) {
    if (isAnalyzerId(view.tool)) tools.add(view.tool);
  }
  return [...tools].sort();
}

export function defaultFileName(): string {
  const base =
    projectLabel(projectName())
      .trim()
      .replace(/[^\w.-]+/g, "_") || "project";
  return `${base}.heyl`;
}
