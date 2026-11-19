import { For, Show } from "solid-js";
import { Handle, Position, type NodeProps } from "@dschz/solid-flow";
import { nodeKind, portLabel } from "../lib/graph";
import { updateParam, type GraphNodeData } from "../state/graph";
import ParamField from "./graphEditor/ParamField";

/** Vertical position of handle `index` of `count`, spread down the node side. */
function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/**
 * A fundsp graph node: a title, its inline numeric parameters, one connection handle
 * per declared port, and a **tiny label** beside each handle. Input handle ids are
 * `"0"`, `"1"`, … so edges carry the port index (see `lib/graph/spec.ts` `handlePort`).
 */
export default function GraphNode(props: NodeProps<GraphNodeData, "graph">) {
  const def = () => nodeKind(props.data.kind);
  const inputs = () => def()?.inputs ?? 1;
  const outputs = () => def()?.outputs ?? 1;
  const isAnchor = () => props.data.kind === "input" || props.data.kind === "output";

  return (
    <div
      class="graph-node"
      classList={{ "graph-node-selected": props.selected, "graph-node-anchor": isAnchor() }}
      data-testid="graph.node"
      data-kind={props.data.kind}
      data-node-id={props.id}
    >
      <For each={Array.from({ length: inputs() })}>
        {(_, index) => (
          <>
            <Handle
              type="target"
              position={Position.Left}
              id={String(index())}
              style={{ top: handleTop(index(), inputs()) }}
            />
            <span
              class="graph-port graph-port-in"
              data-testid="graph.port"
              style={{ top: handleTop(index(), inputs()) }}
            >
              {portLabel(props.data.kind, "in", index(), inputs())}
            </span>
          </>
        )}
      </For>

      <div class="graph-node-title" title={def()?.hint}>
        {def()?.label ?? props.data.kind}
      </div>

      <Show when={!isAnchor() && (def()?.params.length ?? 0) > 0}>
        <div class="graph-node-params">
          <For each={def()?.params ?? []}>
            {(param) => (
              <ParamField
                param={param}
                value={props.data.params[param.key] ?? param.default}
                onInput={(value) => updateParam(props.data.graph, props.id, param.key, value)}
              />
            )}
          </For>
        </div>
      </Show>

      <For each={Array.from({ length: outputs() })}>
        {(_, index) => (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id={String(index())}
              style={{ top: handleTop(index(), outputs()) }}
            />
            <span
              class="graph-port graph-port-out"
              data-testid="graph.port"
              style={{ top: handleTop(index(), outputs()) }}
            >
              {portLabel(props.data.kind, "out", index(), outputs())}
            </span>
          </>
        )}
      </For>
    </div>
  );
}
