import "@dschz/solid-flow/styles";
import { For, Show, type JSX } from "solid-js";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  SolidFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@dschz/solid-flow";
import { handlePort, paletteFor, type GraphKind, type NodeKindDef } from "../lib/graph";
import {
  addNode,
  clearGraphWarning,
  graphFor,
  hasKind,
  setNodesPosition,
  warnGraph,
} from "../state/graph";
import GraphNode from "./GraphNode";

const nodeTypes = { graph: GraphNode } as unknown as NodeTypes;

/** Dark theme for the flow, matched to the app palette (belt-and-braces with `colorMode`). */
const FLOW_STYLE = {
  "--xy-background-color": "#1f1f1f",
  "--xy-background-pattern-dots-color": "#3a3a3a",
  "--xy-edge-stroke": "#5898ff",
  "--xy-edge-stroke-width": "1.5",
  "--xy-edge-stroke-selected": "#9cc0ff",
  "--xy-handle-background-color": "#6ea8ff",
  "--xy-handle-border-color": "#1f1f1f",
  "--xy-connectionline-stroke": "#6ea8ff",
  "--xy-connectionline-stroke-width": "1.5",
  "--xy-controls-button-background-color": "#2b2b2b",
  "--xy-controls-button-background-color-hover": "#3e3e3e",
  "--xy-controls-button-color": "#e6e6e6",
  "--xy-controls-button-color-hover": "#ffffff",
  "--xy-controls-button-border-color": "#3c3c3c",
  "--xy-minimap-background-color": "#1a1a1a",
  "--xy-minimap-mask-background-color": "rgba(20, 20, 20, 0.65)",
  "--xy-minimap-mask-stroke-color": "#5898ff",
  "--xy-edge-label-background-color": "#2b2b2b",
  "--xy-edge-label-color": "#e6e6e6",
} as JSX.CSSProperties;

/** Whether `to` is reachable from `from` following existing edges. */
function reaches(graph: GraphKind, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of graphFor(graph).edges) {
      if (edge.source === node) stack.push(edge.target);
    }
  }
  return false;
}

/**
 * Why a proposed connection is invalid, or `null` if it is fine.
 *
 * Mirrors the core's rules (`audio/graph.rs`): one source per input, no self-links,
 * no cycles.
 */
function connectionProblem(
  graph: GraphKind,
  source: string,
  target: string,
  targetHandle?: string | null,
): string | null {
  if (source === target) return "A node cannot connect to itself.";
  const port = handlePort(targetHandle);
  const occupied = graphFor(graph).edges.some(
    (edge) => edge.target === target && handlePort(edge.targetHandle) === port,
  );
  if (occupied) return "That input already has a connection — each input takes one source.";
  if (reaches(graph, target, source)) return "That connection would create a loop.";
  return null;
}

/** Add a new edge to our store unless the library already mirrored it (idempotent). */
function onConnected(
  graph: GraphKind,
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
) {
  clearGraphWarning();
  const handle = graphFor(graph);
  const exists = handle.edges.some(
    (edge) =>
      edge.id === id ||
      (edge.source === source &&
        edge.target === target &&
        handlePort(edge.sourceHandle) === handlePort(sourceHandle) &&
        handlePort(edge.targetHandle) === handlePort(targetHandle)),
  );
  if (!exists) {
    handle.setEdges((edges) => [
      ...edges,
      {
        id,
        source,
        target,
        sourceHandle: sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
      },
    ]);
  }
}

/**
 * The shared fundsp graph editor (`solid-flow`), used by both the filter and synth
 * tabs. The graph's node/edge stores live in `state/graph.ts`, so switching or
 * closing the tab does not lose the graph.
 */
export default function GraphEditor(props: { graph: GraphKind; children?: JSX.Element }) {
  const handle = () => graphFor(props.graph);

  const canAdd = (def: NodeKindDef) =>
    def.kind !== "input" && def.kind !== "output" ? true : !hasKind(props.graph, def.kind);

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">{props.children}</div>
      <div class="graph-canvas">
        <SolidFlow
          id={`graph-${props.graph}`}
          nodes={handle().nodes as unknown as Node[]}
          edges={handle().edges as unknown as Edge[]}
          nodeTypes={nodeTypes}
          colorMode="dark"
          style={FLOW_STYLE}
          fitView
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          isValidConnection={(connection) => {
            const problem = connectionProblem(
              props.graph,
              connection.source,
              connection.target,
              connection.targetHandle,
            );
            if (problem) {
              warnGraph(problem);
              return false;
            }
            return true;
          }}
          onConnect={(connection) =>
            onConnected(
              props.graph,
              connection.id,
              connection.source,
              connection.target,
              connection.sourceHandle,
              connection.targetHandle,
            )
          }
          onDelete={({ nodes, edges }) => {
            // Mirror deletions (idempotent — the library may already have done it).
            if (edges.length) {
              const ids = new Set(edges.map((edge) => edge.id));
              handle().setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
            }
            if (nodes.length) {
              const ids = new Set(nodes.map((node) => node.id));
              handle().setNodes((current) => current.filter((node) => !ids.has(node.id)));
            }
          }}
          onNodeDragStop={({ targetNode }) => {
            if (targetNode) setNodesPosition(props.graph, targetNode.id, { ...targetNode.position });
          }}
        >
          <Panel position="top-left" class="graph-palette">
            <For each={paletteFor(props.graph)}>
              {(group) => (
                <div class="graph-palette-group">
                  <div class="graph-palette-title">{group.category}</div>
                  <div class="graph-palette-buttons">
                    <For each={group.kinds}>
                      {(def) => (
                        <Show when={canAdd(def)}>
                          <button
                            type="button"
                            class="graph-palette-btn"
                            title={`Add ${def.label}`}
                            onClick={() => addNode(props.graph, def)}
                          >
                            + {def.label}
                          </button>
                        </Show>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Panel>
          <Background variant="dots" />
          <Controls />
          <Show when={props.graph === "synth"}>
            <MiniMap />
          </Show>
        </SolidFlow>
      </div>
    </div>
  );
}
