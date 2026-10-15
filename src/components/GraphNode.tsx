import { For, Show, untrack } from "solid-js";
import { Handle, Position, type NodeProps } from "@dschz/solid-flow";
import { createNumberDrag } from "../lib/dragNumber";
import { nodeKind, portLabel, type GraphKind, type ParamDef } from "../lib/graph";
import { updateParam, type GraphNodeData } from "../state/graph";

/** Vertical position of handle `index` of `count`, spread down the node side. */
function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/**
 * A fundsp graph node: a title, its inline numeric parameters, one connection handle
 * per declared port, and a **tiny label** beside each handle. Input handle ids are
 * `"0"`, `"1"`, … so edges carry the port index (see `lib/graph.ts` `handlePort`).
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
              <ParamInput
                graph={props.data.graph}
                nodeId={props.id}
                param={param}
                value={props.data.params[param.key] ?? param.default}
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

/** A node parameter: type it, or drag up/down to adjust (M7). */
function ParamInput(props: { graph: GraphKind; nodeId: string; param: ParamDef; value: number }) {
  const drag = createNumberDrag({
    value: () => props.value,
    onInput: (value) => updateParam(props.graph, props.nodeId, props.param.key, value),
    // The bounds come from the static registry (`ParamDef`), so snapshot them once
    // rather than tracking them.
    step: untrack(() => props.param.step),
    min: untrack(() => props.param.min),
    max: untrack(() => props.param.max),
  });

  return (
    <label class="graph-param">
      <span class="graph-param-label">{props.param.label}</span>
      <input
        class={`graph-param-input nodrag nopan num-drag${drag.dragging() ? " num-dragging" : ""}`}
        type="number"
        min={props.param.min}
        max={props.param.max}
        step={props.param.step}
        value={props.value}
        onChange={(event) =>
          updateParam(props.graph, props.nodeId, props.param.key, Number(event.currentTarget.value))
        }
        {...drag.handlers}
      />
      <Show when={props.param.unit}>
        <span class="graph-param-unit">{props.param.unit}</span>
      </Show>
    </label>
  );
}
