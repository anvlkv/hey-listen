import { type Component } from "solid-js";
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
 */
export default function ToolContent(props: { id: ToolId }) {
  if (props.id === "filter") return <FilterGraphTab />;
  if (props.id === "synth") return <SynthGraphTab />;
  const Special = SPECIAL_ANALYZER_VIEWS[props.id as AnalyzerId];
  if (Special) return <Special />;
  return <AnalyzerView id={props.id as AnalyzerId} />;
}
