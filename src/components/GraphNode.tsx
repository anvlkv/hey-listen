import { For, Show } from "solid-js";
import { Handle, Position, type NodeProps } from "@dschz/solid-flow";
import { nodeKind } from "../lib/graph";
import { updateParam, type GraphNodeData } from "../state/graph";

/** Vertical position of handle `index` of `count`, spread down the node side. */
function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/**
 * A fundsp graph node: a title, its inline numeric parameters, and one connection
 * handle per declared port. Input handle ids are `"0"`, `"1"`, … so edges carry the
 * port index (see `lib/graph.ts` `handlePort`).
 */
export default function GraphNode(props: NodeProps<GraphNodeData, "graph">) {
  const def = () => nodeKind(props.data.kind);
  const inputs = () => def()?.inputs ?? 1;
  const outputs = () => def()?.outputs ?? 1;
  const isAnchor = () => props.data.kind === "input" || props.data.kind === "output";

  return (
    <div class="graph-node" classList={{ "graph-node-selected": props.selected, "graph-node-anchor": isAnchor() }}>
      <For each={Array.from({ length: inputs() })}>
        {(_, index) => (
          <Handle
            type="target"
            position={Position.Left}
            id={String(index())}
            style={{ top: handleTop(index(), inputs()) }}
          />
        )}
      </For>

      <div class="graph-node-title" title={def()?.hint}>
        {def()?.label ?? props.data.kind}
      </div>

      <Show when={!isAnchor() && (def()?.params.length ?? 0) > 0}>
        <div class="graph-node-params">
          <For each={def()?.params ?? []}>
            {(param) => (
              <label class="graph-param">
                <span class="graph-param-label">{param.label}</span>
                <input
                  class="graph-param-input nodrag nopan"
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={props.data.params[param.key] ?? param.default}
                  onChange={(event) =>
                    updateParam(
                      props.data.graph,
                      props.id,
                      param.key,
                      Number(event.currentTarget.value),
                    )
                  }
                />
                <Show when={param.unit}>
                  <span class="graph-param-unit">{param.unit}</span>
                </Show>
              </label>
            )}
          </For>
        </div>
      </Show>

      <For each={Array.from({ length: outputs() })}>
        {(_, index) => (
          <Handle
            type="source"
            position={Position.Right}
            id={String(index())}
            style={{ top: handleTop(index(), outputs()) }}
          />
        )}
      </For>
    </div>
  );
}
