import { Match, Switch, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import AnalyzerView from "./analyzer/AnalyzerView";
import SpectrogramTab from "./analyzer/SpectrogramTab";
import SpectrumTab from "./analyzer/SpectrumTab";
import WaveformTab from "./analyzer/WaveformTab";
import CompareTab from "./compare/CompareTab";
import FilterGraphTab from "./FilterGraphTab";
import SynthGraphTab from "./SynthGraphTab";
import SubsystemTab from "./graphEditor/SubsystemTab";
import TableTab from "./graphEditor/TableTab";
import type { AnalyzerId } from "../state/analyzer";
import { parseComparePanel } from "../state/compare/id";
import { parseSystemScope, type SubsystemScope } from "../state/subsystems";
import { parseTableScope, type TableScope } from "../state/tables";
import {
  compareOffset,
  openCompareSaved,
  setCompareOffset,
  setReference,
  viewFor,
} from "../state/compare/views";
import type { ToolId } from "../state/workbench";

/** Analyzers that keep a bespoke chart; the rest use the generic [`AnalyzerView`]. */
const SPECIAL_ANALYZER_VIEWS: Partial<Record<AnalyzerId, Component>> = {
  waveform: WaveformTab,
  spectrum: SpectrumTab,
  spectrogram: SpectrogramTab,
};

/**
 * Renders a single Workbench tool (graph editor or analyzer) as a component. Used
 * both by the Workbench (inside dockview panels) and by a popout window (which
 * shows just this tool).
 *
 * A **compare** panel's id is `compare:<tool>:<id>` (M23 Phase 3): it renders the
 * comparison bound to this project's reference for that pair. The dispatch is a
 * `<Switch>` rather than early returns: a component body runs **once**, so an early
 * return would freeze the choice instead of reacting to the id.
 */
export default function ToolContent(props: { id: ToolId | string }) {
  const compare = () => parseComparePanel(props.id);

  return (
    <Switch fallback={<AnalyzerView id={props.id as AnalyzerId} />}>
      <Match when={parseSystemScope(props.id)}>
        <SubsystemTab scope={props.id as SubsystemScope} />
      </Match>
      <Match when={parseTableScope(props.id)}>
        <TableTab scope={props.id as TableScope} />
      </Match>
      <Match when={compare()}>
        {(ref) => (
          <CompareTab
            tool={ref().tool}
            id={ref().id}
            binding={() => viewFor(ref().tool, ref().id)?.binding ?? null}
            onBindingChange={(next) => {
              if (next.kind === "saved") void openCompareSaved(ref().tool, ref().id);
              else setReference(ref().tool, ref().id, next.reference);
            }}
            offset={() => compareOffset(ref().tool, ref().id)}
            onOffset={(seconds) => setCompareOffset(ref().tool, ref().id, seconds)}
          />
        )}
      </Match>
      <Match when={props.id === "filter"}>
        <FilterGraphTab />
      </Match>
      <Match when={props.id === "synth"}>
        <SynthGraphTab />
      </Match>
      <Match when={SPECIAL_ANALYZER_VIEWS[props.id as AnalyzerId]}>
        {(Special) => <Dynamic component={Special()} />}
      </Match>
    </Switch>
  );
}
