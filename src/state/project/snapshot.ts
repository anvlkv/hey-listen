import type { SourceDescriptor } from "../../bindings/SourceDescriptor";
import { deepClone } from "../../lib/clone";
import { toSpec } from "../../lib/graph";
import { invoke } from "../../lib/ipc";
import { sharedParams } from "../analysis";
import { toolOptions } from "../analyzer";
import { choice, deviceId, gain, mixMicDeviceId, mixSystemDeviceId, targetPid } from "../capture";
import { filterEnabled, graphLayout, SYNTH_GRAPH } from "../graph";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { layoutJson, openTools } from "../workbench";
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
  };
}

export function defaultFileName(): string {
  const base =
    projectLabel(projectName())
      .trim()
      .replace(/[^\w.-]+/g, "_") || "project";
  return `${base}.heyl`;
}
