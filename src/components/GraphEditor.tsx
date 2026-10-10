import "@dschz/solid-flow/styles";
import { createSignal, For, Show, type JSX } from "solid-js";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  SolidFlow,
  type NodeTypes,
} from "@dschz/solid-flow";
import { handlePort, paletteFor, type GraphKind, type NodeKindDef } from "../lib/graph";
import {
  addNode,
  clearGraphWarning,
  graphFor,
  hasKind,
  isAnchorKind,
  setNodesPosition,
  warnGraph,
} from "../state/graph";
import { resolvedTheme } from "../state/settings";
import GraphNode from "./GraphNode";
import ScrollArea from "./ScrollArea";

const nodeTypes = { graph: GraphNode } satisfies NodeTypes;

/** Inline styling for the palette search box, matched to the active theme. */
const SEARCH_STYLE_DARK: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  height: "24px",
  padding: "0 6px",
  font: "inherit",
  "font-size": "11px",
  color: "#e6e6e6",
  background: "#1f1f1f",
  border: "1px solid #3c3c3c",
  "border-radius": "4px",
};

const SEARCH_STYLE_LIGHT: JSX.CSSProperties = {
  ...SEARCH_STYLE_DARK,
  color: "#1f2328",
  background: "#ffffff",
  border: "1px solid #d8dce2",
};

/** Flow canvas theme matched to the app palette (belt-and-braces with `colorMode`). */
const FLOW_STYLE_DARK = {
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

/** Light variant of [`FLOW_STYLE_DARK`]: same variables, light values. */
const FLOW_STYLE_LIGHT = {
  "--xy-background-color": "#ffffff",
  "--xy-background-pattern-dots-color": "#d0d4da",
  "--xy-edge-stroke": "#2f6fd0",
  "--xy-edge-stroke-width": "1.5",
  "--xy-edge-stroke-selected": "#1b4fa0",
  "--xy-handle-background-color": "#2f6fd0",
  "--xy-handle-border-color": "#ffffff",
  "--xy-connectionline-stroke": "#2f6fd0",
  "--xy-connectionline-stroke-width": "1.5",
  "--xy-controls-button-background-color": "#ffffff",
  "--xy-controls-button-background-color-hover": "#eef0f4",
  "--xy-controls-button-color": "#1f2328",
  "--xy-controls-button-color-hover": "#000000",
  "--xy-controls-button-border-color": "#d8dce2",
  "--xy-minimap-background-color": "#f0f1f4",
  "--xy-minimap-mask-background-color": "rgba(160, 168, 178, 0.35)",
  "--xy-minimap-mask-stroke-color": "#2f6fd0",
  "--xy-edge-label-background-color": "#ffffff",
  "--xy-edge-label-color": "#1f2328",
} as JSX.CSSProperties;

/** The flow canvas inline theme for the active [`resolvedTheme`] (reactive). */
const flowStyle = () => (resolvedTheme() === "light" ? FLOW_STYLE_LIGHT : FLOW_STYLE_DARK);
/** The palette search-box inline theme for the active [`resolvedTheme`] (reactive). */
const searchStyle = () => (resolvedTheme() === "light" ? SEARCH_STYLE_LIGHT : SEARCH_STYLE_DARK);

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
  const [query, setQuery] = createSignal("");
  const [collapsed, setCollapsed] = createSignal(false);

  const canAdd = (def: NodeKindDef) =>
    def.kind !== "input" && def.kind !== "output" ? true : !hasKind(props.graph, def.kind);

  /** The palette, filtered by the search box (matches label or kind name). */
  const groups = () => {
    const needle = query().trim().toLowerCase();
    return paletteFor(props.graph)
      .map((group) => ({
        ...group,
        kinds: needle
          ? group.kinds.filter(
              (def) =>
                def.label.toLowerCase().includes(needle) ||
                def.kind.toLowerCase().includes(needle),
            )
          : group.kinds,
      }))
      .filter((group) => group.kinds.length > 0);
  };

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">{props.children}</div>
      <div class="graph-canvas">
        <SolidFlow
          id={`graph-${props.graph}`}
          nodes={handle().nodes}
          edges={handle().edges}
          nodeTypes={nodeTypes}
          colorMode={resolvedTheme()}
          style={flowStyle()}
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
            // Input/Output anchors are undeletable (`deletable: false`); skip them
            // anyway so a stray event can never remove an anchor.
            if (edges.length) {
              const ids = new Set(edges.map((edge) => edge.id));
              handle().setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
            }
            if (nodes.length) {
              const ids = new Set(
                nodes
                  .filter((node) => !isAnchorKind(node.data.kind))
                  .map((node) => node.id),
              );
              handle().setNodes((current) => current.filter((node) => !ids.has(node.id)));
            }
          }}
          onNodeDragStop={({ targetNode }) => {
            if (targetNode) setNodesPosition(props.graph, targetNode.id, { ...targetNode.position });
          }}
        >
          <Panel
            position="top-left"
            class="graph-palette"
            style={{ "max-height": "calc(100% - 16px)", "overflow": "hidden" }}
          >
            <div class="graph-palette-head">
              <button
                type="button"
                class="graph-palette-toggle"
                aria-expanded={!collapsed()}
                title={collapsed() ? "Expand node palette" : "Collapse node palette"}
                onClick={() => setCollapsed(!collapsed())}
              >
                {collapsed() ? "▸" : "▾"} Nodes
              </button>
            </div>
            <Show when={!collapsed()}>
            <input
              type="text"
              class="graph-palette-search nodrag nopan"
              placeholder="Search nodes…"
              aria-label="Search nodes"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              style={searchStyle()}
            />
            <ScrollArea class="graph-palette-scroll">
            <For each={groups()}>
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
                            title={def.hint ? `${def.label} — ${def.hint}` : `Add ${def.label}`}
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
            <Show when={groups().length === 0}>
              <div class="graph-palette-title">No matching nodes</div>
            </Show>
            </ScrollArea>
            </Show>
          </Panel>
          <Background variant="dots" />
          <Controls position="top-right" />
          <MiniMap />
        </SolidFlow>
      </div>
    </div>
  );
}
