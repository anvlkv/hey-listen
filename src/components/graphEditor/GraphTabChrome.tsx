import { Show, type Accessor } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { invoke } from "../../lib/ipc";
import type { GraphScope, GraphSpec } from "../../lib/graph";
import { toSpec } from "../../lib/graph";
import {
  graphLayout,
  graphWarning,
  loadSpec,
  outputConnected,
  resetGraph,
  warnGraph,
} from "../../state/graph";
import { resetSystems } from "../../state/workbench";

/**
 * The chrome the two graph tabs (`FilterGraphTab` / `SynthGraphTab`) share: the
 * output-connected warning, the rejected-connection message, the core error, and the
 * clear-graph button. Keeping one copy is what stops the two tabs from drifting (and
 * stops the clone gate from flagging the duplicate).
 */

/** "Output is not connected", plus the transient rejected-connection warning. */
export function GraphNotices(props: { graph: GraphScope; silent: string }) {
  return (
    <>
      <Show when={!outputConnected(props.graph)}>
        <span class="graph-warn" data-testid="graph.warning">
          {props.silent}
        </span>
      </Show>
      <Show when={graphWarning()}>
        {(message) => (
          <span class="graph-warn" data-testid="graph.connection.warning" title={message()}>
            {message()}
          </span>
        )}
      </Show>
    </>
  );
}

/** The core's graph error for this editor (validation or a failed apply/render). */
export function GraphError(props: { message: Accessor<string | null> }) {
  return (
    <Show when={props.message()}>
      {(message) => (
        <span class="graph-error" data-testid="graph.error" title={message()}>
          {message()}
        </span>
      )}
    </Show>
  );
}

/** Reset one graph editor to its seed. */
export function ClearGraphButton(props: { graph: GraphScope }) {
  return (
    <Tooltip label="Remove every node and link from this graph">
      <Button
        class="graph-btn icon-btn"
        data-testid="graph.clear"
        aria-label="Clear graph"
        onClick={() => {
          // Clearing a graph also clears the subsystems it contains.
          resetSystems(props.graph);
          resetGraph(props.graph);
        }}
      >
        <Icon name="trash" />
      </Button>
    </Tooltip>
  );
}

/** Import a `.dot` (or legacy JSON) graph file, replacing this editor's graph. */
export function ImportGraphButton(props: { graph: GraphScope }) {
  async function open() {
    try {
      const path = await invoke<string | null>("pick_graph_file");
      if (!path) return;
      const spec = await invoke<GraphSpec>("graph_read_file", { path });
      resetSystems(props.graph);
      loadSpec(props.graph, spec);
    } catch (err) {
      warnGraph(String(err));
    }
  }
  return (
    <Tooltip label="Import a DOT graph (.dot / .gv)">
      <Button
        class="graph-btn icon-btn"
        data-testid="graph.import"
        aria-label="Import graph"
        onClick={() => void open()}
      >
        <Icon name="file-import" />
      </Button>
    </Tooltip>
  );
}

/** Export this editor's graph as a shareable `.dot` file. */
export function ExportGraphButton(props: { graph: GraphScope }) {
  async function save() {
    try {
      const layout = graphLayout(props.graph);
      const path = await invoke<string | null>("pick_save_path", {
        kind: "dot",
        defaultName: `${props.graph}.dot`,
      });
      if (!path) return;
      await invoke("graph_write_dot", {
        spec: toSpec(layout.nodes, layout.edges),
        path,
      });
    } catch (err) {
      warnGraph(String(err));
    }
  }
  return (
    <Tooltip label="Export this graph as a DOT file">
      <Button
        class="graph-btn icon-btn"
        data-testid="graph.export"
        aria-label="Export graph"
        onClick={() => void save()}
      >
        <Icon name="file-export" />
      </Button>
    </Tooltip>
  );
}

/** The import/export pair both graph tabs show. */
export function GraphFileButtons(props: { graph: GraphScope }) {
  return (
    <>
      <ImportGraphButton graph={props.graph} />
      <ExportGraphButton graph={props.graph} />
    </>
  );
}
