import { Match, Switch } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import SeriesView from "./SeriesView";
import MatrixView from "./MatrixView";
import ReadoutsView from "./ReadoutsView";
import RhythmView from "./RhythmView";
import {
  analyzerById,
  createAnalysis,
  type AnalyzerId,
  type AnyAnalysisResult,
} from "../../state/analyzer";

/**
 * The generic analyzer tab (M5): dispatches the tool's registry `view` to the right
 * body (series / matrix / readouts / events) under the shared [`AnalyzerTab`]
 * shell, so adding a tool is a registry entry rather than a new component. The
 * waveform / spectrum / spectrogram tools keep their bespoke charts and are mounted
 * directly by the Workbench.
 */
export default function AnalyzerView(props: { id: AnalyzerId }) {
  const def = () => analyzerById(props.id);
  const analysis = createAnalysis<AnyAnalysisResult>(props.id);

  return (
    <AnalyzerTab
      id={props.id}
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
      params={<ToolParamsForm id={props.id} />}
    >
      <Switch>
        <Match when={def().view.kind === "series"}>
          <SeriesView id={props.id} analysis={analysis} />
        </Match>
        <Match when={def().view.kind === "matrix"}>
          <MatrixView id={props.id} analysis={analysis} />
        </Match>
        <Match when={def().view.kind === "rhythm"}>
          <RhythmView id={props.id} analysis={analysis} />
        </Match>
        <Match when={def().view.kind === "readouts"}>
          <ReadoutsView analysis={analysis} />
        </Match>
      </Switch>
    </AnalyzerTab>
  );
}
