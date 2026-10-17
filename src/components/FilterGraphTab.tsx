import { Show } from "solid-js";
import Button from "./Button";
import GraphEditor from "./GraphEditor";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import {
  FILTER_GRAPH,
  filterActive,
  filterApplying,
  filterError,
  graphWarning,
  outputConnected,
  resetGraph,
} from "../state/graph";

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
      <Show when={!outputConnected("filter")}>
        <span class="graph-warn" data-testid="graph.warning">
          Output is not connected — the graph is silent
        </span>
      </Show>
      <Show when={graphWarning()}>
        {(message) => (
          <span class="graph-warn" data-testid="graph.connection.warning" title={message()}>
            {message()}
          </span>
        )}
      </Show>
      <Show when={filterApplying()}>
        <span class="graph-status">applying…</span>
      </Show>
      <Show when={filterError()}>
        {(message) => (
          <span class="graph-error" data-testid="graph.error" title={message()}>
            {message()}
          </span>
        )}
      </Show>
      <Tooltip label="Remove every node and link from this graph">
        <Button
          class="graph-btn icon-btn"
          data-testid="graph.clear"
          aria-label="Clear graph"
          onClick={() => resetGraph("filter")}
        >
          <Icon name="trash" />
        </Button>
      </Tooltip>
    </GraphEditor>
  );
}
