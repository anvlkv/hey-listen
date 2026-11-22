import { createMemo, For, Show } from "solid-js";
import { Handle, Position, type NodeProps } from "@dschz/solid-flow";
import { graphThumbnail } from "../lib/graph/thumbnail";
import { nodeKind, portLabel } from "../lib/graph";
import { updateParam, type GraphNodeData } from "../state/graph";
import { systemScope } from "../state/subsystems";
import { openSystem } from "../state/workbench";
import ParamField from "./graphEditor/ParamField";
import SnoopTrace from "./graphEditor/SnoopTrace";

/** Vertical position of handle `index` of `count`, spread down the node side. */
function handleTop(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/** The mini-map's node box, in the thumbnail's SVG units. */
const THUMB_BOX_W = 12;
const THUMB_BOX_H = 7;

/** The preview's coarse role for a kind: anchor, source, or processor. */
function thumbRole(kind: string): "anchor" | "source" | "process" {
  if (kind === "input" || kind === "output") return "anchor";
  const category = nodeKind(kind)?.category;
  return category === "generator" || category === "control" ? "source" : "process";
}

/**
 * A fundsp graph node: a title, its inline numeric parameters, one connection handle
 * per declared port, and a **tiny label** beside each handle. Input handle ids are
 * `"0"`, `"1"`, … so edges carry the port index (see `lib/graph/spec.ts` `handlePort`).
 */
export default function GraphNode(props: NodeProps<GraphNodeData, "graph">) {
  const def = () => nodeKind(props.data.kind);
  const inputs = () => def()?.inputPorts.length ?? 1;
  const outputs = () => def()?.outputPorts.length ?? 1;
  const isAnchor = () => props.data.kind === "input" || props.data.kind === "output";
  const isSystem = () => def()?.subsystem === true;
  const thumb = createMemo(() => graphThumbnail(props.data.subgraph));
  const systemNodes = () => props.data.subgraph?.nodes.length ?? 0;

  return (
    <div
      class="graph-node"
      classList={{
        "graph-node-selected": props.selected,
        "graph-node-anchor": isAnchor(),
        "graph-node-compact": isSystem() || props.data.kind === "snoop",
      }}
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
              {portLabel(props.data.kind, "in", index())}
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

      <Show when={isSystem()}>
        <div class="graph-node-system">
          <svg
            class="graph-node-thumb"
            data-testid="graph.subsystem.thumbnail"
            viewBox={`0 0 ${thumb().width} ${thumb().height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Subsystem preview"
          >
            <For each={thumb().links}>
              {(link) => (
                <line
                  class="graph-thumb-link"
                  x1={link.x1}
                  y1={link.y1}
                  x2={link.x2}
                  y2={link.y2}
                />
              )}
            </For>
            <For each={thumb().nodes}>
              {(node) => (
                <rect
                  class="graph-thumb-node"
                  classList={{
                    "graph-thumb-anchor": thumbRole(node.kind) === "anchor",
                    "graph-thumb-source": thumbRole(node.kind) === "source",
                  }}
                  x={node.x - THUMB_BOX_W / 2}
                  y={node.y - THUMB_BOX_H / 2}
                  width={THUMB_BOX_W}
                  height={THUMB_BOX_H}
                  rx="1.5"
                />
              )}
            </For>
          </svg>
          <button
            type="button"
            class="graph-node-open nodrag"
            data-testid="graph.subsystem.open"
            title="Open this subsystem in its own tab"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openSystem(systemScope(props.data.graph, props.id));
            }}
          >
            {systemNodes()} node{systemNodes() === 1 ? "" : "s"} · Open
          </button>
        </div>
      </Show>

      <Show when={props.data.kind === "snoop"}>
        <SnoopTrace scope={props.data.graph} node={props.id} />
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
              {portLabel(props.data.kind, "out", index())}
            </span>
          </>
        )}
      </For>
    </div>
  );
}
