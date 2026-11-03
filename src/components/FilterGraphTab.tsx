import { Show } from "solid-js";
import GraphEditor from "./GraphEditor";
import { ClearGraphButton, GraphError, GraphNotices } from "./graphEditor/GraphTabChrome";
import { FILTER_GRAPH, filterActive, filterApplying, filterError } from "../state/graph";

/**
 * Filter graph tab: builds the fundsp net applied to the signal **before** preview
 * playback and analysis. Wire `Input → …filters… → Output`; the graph is pushed to
 * the Rust core (debounced) whenever it changes, and bypassed by the Toolbar toggle.
 */
export default function FilterGraphTab() {
  const nodes = () => FILTER_GRAPH.nodes.length;
  const links = () => FILTER_GRAPH.edges.length;

  return (
    <GraphEditor graph="filter">
      <span class="graph-toolbar-title">Filter graph</span>
      <span class="graph-toolbar-hint" data-testid="graph.hint">
        {nodes()} node{nodes() === 1 ? "" : "s"} · {links()} link{links() === 1 ? "" : "s"} ·{" "}
        {filterActive() ? "applied before preview & analysis" : "bypassed"}
      </span>
      <GraphNotices graph="filter" silent="Output is not connected — the graph is silent" />
      <Show when={filterApplying()}>
        <span class="graph-status">applying…</span>
      </Show>
      <GraphError message={filterError} />
      <ClearGraphButton graph="filter" />
    </GraphEditor>
  );
}
