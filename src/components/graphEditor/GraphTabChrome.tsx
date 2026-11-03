import { Show, type Accessor } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { graphWarning, outputConnected, resetGraph } from "../../state/graph";
import type { GraphKind } from "../../lib/graph";

/**
 * The chrome the two graph tabs (`FilterGraphTab` / `SynthGraphTab`) share: the
 * output-connected warning, the rejected-connection message, the core error, and the
 * clear-graph button. Keeping one copy is what stops the two tabs from drifting (and
 * stops the clone gate from flagging the duplicate).
 */

/** "Output is not connected", plus the transient rejected-connection warning. */
export function GraphNotices(props: { graph: GraphKind; silent: string }) {
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
export function ClearGraphButton(props: { graph: GraphKind }) {
  return (
    <Tooltip label="Remove every node and link from this graph">
      <Button
        class="graph-btn icon-btn"
        data-testid="graph.clear"
        aria-label="Clear graph"
        onClick={() => resetGraph(props.graph)}
      >
        <Icon name="trash" />
      </Button>
    </Tooltip>
  );
}
