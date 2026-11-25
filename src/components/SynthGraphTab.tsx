import GraphEditor from "./GraphEditor";
import { ClearGraphButton, GraphFileButtons, GraphNotices } from "./graphEditor/GraphTabChrome";
import { SYNTH_GRAPH } from "../state/graph";

/**
 * Synth graph tab: build a fundsp synth in `solid-flow` (`generators → … → Output`).
 *
 * The tab is a **pure graph editor** (M43): its Length, Render and Live controls live in
 * the Sources rail, so the graph is edited here and rendered from there. A popout (a view
 * of the same shared graph) keeps just this editing chrome too.
 */
export default function SynthGraphTab() {
  const nodes = () => SYNTH_GRAPH.nodes.length;

  return (
    <GraphEditor graph="synth">
      <span class="graph-toolbar-title">Synth graph</span>
      <span class="graph-toolbar-hint" data-testid="graph.hint">
        {nodes()} node{nodes() === 1 ? "" : "s"}
      </span>
      <GraphNotices graph="synth" silent="Output is not connected — the render is silent" />
      <GraphFileButtons graph="synth" />
      <ClearGraphButton graph="synth" />
    </GraphEditor>
  );
}
