import { Match, Switch, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import AnalyzerView from "./analyzer/AnalyzerView";
import SpectrogramTab from "./analyzer/SpectrogramTab";
import SpectrumTab from "./analyzer/SpectrumTab";
import WaveformTab from "./analyzer/WaveformTab";
import FilterGraphTab from "./FilterGraphTab";
import SynthGraphTab from "./SynthGraphTab";
import type { AnalyzerId } from "../state/analyzer";
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
 * The dispatch is a `<Switch>` rather than early returns: a component body runs
 * **once**, so an early return would freeze the choice instead of reacting to the id.
 */
export default function ToolContent(props: { id: ToolId }) {
  return (
    <Switch fallback={<AnalyzerView id={props.id as AnalyzerId} />}>
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
