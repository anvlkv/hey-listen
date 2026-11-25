import { Show } from "solid-js";
import GraphEditor from "./GraphEditor";
import SelectField from "./SelectField";
import Tooltip from "./Tooltip";
import {
  ClearGraphButton,
  GraphError,
  GraphFileButtons,
  GraphNotices,
} from "./graphEditor/GraphTabChrome";
import { channel, channelOptions, setChannel } from "../state/analysis";
import {
  FILTER_GRAPH,
  filterActive,
  filterApplying,
  filterError,
  filterOutputs,
} from "../state/graph";

/**
 * Filter graph tab: builds the fundsp net applied to the signal **before** preview
 * playback and analysis. Wire `Input → …filters… → Output`; the graph is pushed to
 * the Rust core (debounced) whenever it changes, and bypassed by the Toolbar toggle.
 */
export default function FilterGraphTab() {
  const nodes = () => FILTER_GRAPH.nodes.length;
  const links = () => FILTER_GRAPH.edges.length;
  const outputs = () => filterOutputs();
  const channelPicks = () => channelOptions(outputs(), outputs());

  return (
    <GraphEditor graph="filter">
      <span class="graph-toolbar-title">Filter graph</span>
      <span class="graph-toolbar-hint" data-testid="graph.hint">
        {nodes()} node{nodes() === 1 ? "" : "s"} · {links()} link{links() === 1 ? "" : "s"} ·{" "}
        {filterActive() ? "applied before preview & analysis" : "bypassed"}
      </span>
      <GraphNotices graph="filter" silent="Output is not connected — the graph is silent" />
      <Show when={outputs() > 1}>
        <Tooltip label="A graph with several Output nodes plays and is analysed one output at a time">
          <label class="graph-field" data-testid="graph.channel">
            <span>Output</span>
            <SelectField
              class="graph-channel-select"
              ariaLabel="Filter output"
              options={channelPicks()}
              value={channel()}
              onChange={(pick) => setChannel(pick)}
            />
          </label>
        </Tooltip>
      </Show>
      <Show when={filterApplying()}>
        <span class="graph-status">applying…</span>
      </Show>
      <GraphError message={filterError} />
      <GraphFileButtons graph="filter" />
      <ClearGraphButton graph="filter" />
    </GraphEditor>
  );
}
