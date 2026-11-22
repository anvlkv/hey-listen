import "@dschz/solid-flow/styles";
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Background, Controls, MiniMap, SolidFlow, type NodeTypes } from "@dschz/solid-flow";
import { nodeKind, type GraphScope, type NodeKindDef } from "../lib/graph";
import { layoutGraph } from "../lib/graphLayout";
import { bezierPoints } from "../lib/graphEdges";
import {
  clearGraphWarning,
  graphFor,
  isAnchorKind,
  resetNode,
  setNodesPosition,
  setNodesPositions,
  spliceEdge,
  warnGraph,
  type GraphEdge,
} from "../state/graph";
import { dropSystemsUnder } from "../state/subsystems";
import { closeSystemsUnder } from "../state/workbench";
import { resolvedTheme, themeFlow } from "../state/themes";
import Button from "./Button";
import GraphNode from "./GraphNode";
import Tooltip from "./Tooltip";
import { connectionProblem, onConnected } from "./graphEditor/connections";
import DragPreview, { type DragPreviewState } from "./graphEditor/DragPreview";
import GraphPalette from "./graphEditor/GraphPalette";
import { FlowBridge, type FlowApi } from "./graphEditor/flowBridge";
import {
  canAddKind,
  canSplice,
  DROP_NODE_HEIGHT,
  DROP_NODE_WIDTH,
  dropTarget,
  edgeNear,
  handleCentre,
  placeNode,
} from "./graphEditor/placement";

const nodeTypes = { graph: GraphNode } satisfies NodeTypes;

/** Flow canvas theme matched to the app palette (belt-and-braces with `colorMode`).
 *  Its baseline (`--xy-*`) now lives in `state/themes/basePalettes.ts` as the base flow for the
 *  active theme's `base`; a theme's `flow` overlay is merged on top by [`themeFlow`]. */

/** The flow canvas inline theme for the active theme (reactive). */
const flowStyle = () => themeFlow() as JSX.CSSProperties;

/**
 * The shared fundsp graph editor (`solid-flow`), used by both the filter and synth
 * tabs. The graph's node/edge stores live in `state/graph.ts`, so switching or
 * closing the tab does not lose the graph.
 */
export default function GraphEditor(props: { graph: GraphScope; children?: JSX.Element }) {
  // The flow instance, captured via `FlowBridge` on mount (user gestures only fire
  // after that), so nothing reactive is lost by keeping it in a plain variable.
  let flow: FlowApi | undefined;
  let canvasEl!: HTMLDivElement;
  /** The kind currently being dragged from the palette (`null` when idle). */
  const [dragging, setDragging] = createSignal<string | null>(null);
  /** The in-progress palette drag, in client coordinates. */
  const [drag, setDrag] = createSignal<{ def: NodeKindDef; x: number; y: number } | null>(null);
  /** The canvas rect captured when the drag moves (the preview's coordinate space). */
  const [canvasRect, setCanvasRect] = createSignal<DOMRect | null>(null);
  /** The node context menu, in canvas coordinates (null when closed). */
  const [menu, setMenu] = createSignal<{ id: string; x: number; y: number } | null>(null);

  const handle = () => graphFor(props.graph);

  /** Canvas-local path of a connector, for the splice preview highlight. */
  function connectorPath(edge: GraphEdge, rect: DOMRect, api: FlowApi): string | null {
    const from = handleCentre(api, edge.source, "source", edge.sourceHandle);
    const to = handleCentre(api, edge.target, "target", edge.targetHandle);
    if (!from || !to) return null;
    return bezierPoints(from, to)
      .map((point, index) => {
        const screen = api.flowToScreenPosition(point);
        const x = (screen.x - rect.left).toFixed(1);
        const y = (screen.y - rect.top).toFixed(1);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }

  /** What the drag would do if released now (the same answer the drop uses). */
  const preview = createMemo<DragPreviewState | null>(() => {
    const state = drag();
    const rect = canvasRect();
    const api = flow;
    if (!state || !rect || !api) return null;
    const ghost = { x: state.x, y: state.y };
    const label = state.def.label;
    const inside =
      state.x >= rect.left &&
      state.x <= rect.right &&
      state.y >= rect.top &&
      state.y <= rect.bottom;
    if (!inside) {
      return {
        label,
        ghost,
        valid: false,
        hint: "Drop on the canvas",
        position: null,
        splice: false,
        splicePath: null,
      };
    }
    const point = api.screenToFlowPosition({ x: state.x, y: state.y });
    const target = dropTarget(props.graph, handle(), api, state.def, point);
    if (!target) {
      // `dropTarget` refuses only an unavailable kind: a second anchor, or a synth input.
      return {
        label,
        ghost,
        valid: false,
        hint:
          state.def.kind === "input" && props.graph === "synth"
            ? "Synths have no Input node"
            : "Only one Input and Output",
        position: null,
        splice: false,
        splicePath: null,
      };
    }
    const screen = api.flowToScreenPosition(target.position);
    return {
      label,
      ghost,
      valid: true,
      hint: null,
      position: { x: screen.x - rect.left, y: screen.y - rect.top },
      splice: target.edge != null,
      splicePath: target.edge ? connectorPath(target.edge, rect, api) : null,
    };
  });

  // Mirror the drop's validity on the pointer, so an invalid drop reads as not-allowed.
  createEffect(() => {
    if (typeof document === "undefined") return;
    const state = dragging() ? preview() : null;
    document.body.style.cursor = state ? (state.valid ? "grabbing" : "not-allowed") : "";
  });
  onCleanup(() => {
    if (typeof document !== "undefined") document.body.style.cursor = "";
  });

  /** The selection, but only while its node still exists and is inspectable. */
  const canAdd = (def: NodeKindDef) => canAddKind(props.graph, def);

  /** Add a palette node dropped at a screen point, splicing it in if near a connector. */
  function onDropPaletteNode(def: NodeKindDef, clientX: number, clientY: number) {
    const rect = canvasEl?.getBoundingClientRect();
    if (!flow || !rect) return;
    const overCanvas =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (!overCanvas || !canAdd(def)) return;
    clearGraphWarning();
    placeNode(props.graph, flow, def, flow.screenToFlowPosition({ x: clientX, y: clientY }));
  }

  /** Lay the graph out left-to-right with dagre, then fit the canvas to it. */
  function autoLayout() {
    const api = flow;
    if (!api) return;
    const nodes = handle().nodes;
    const positions = layoutGraph(
      nodes.map((node) => {
        const measured = api.getInternalNode(node.id)?.measured;
        return {
          id: node.id,
          width: measured?.width ?? DROP_NODE_WIDTH,
          height: measured?.height ?? DROP_NODE_HEIGHT,
        };
      }),
      handle().edges.map((edge) => ({ source: edge.source, target: edge.target })),
    );
    setNodesPositions(props.graph, positions);
    // Let the store settle before fitting: `fitView` measures the new bounds.
    requestAnimationFrame(() => void api.fitView({ padding: 0.12, duration: 200 }));
  }

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">
        {props.children}
        <Tooltip label="Lay the graph out left to right">
          <Button class="graph-btn" data-testid="graph.layout" onClick={autoLayout}>
            Layout
          </Button>
        </Tooltip>
      </div>
      <div class="graph-body">
        <div
          ref={(node) => (canvasEl = node)}
          class="graph-canvas"
          classList={{ "graph-canvas-dragging": dragging() !== null }}
          data-testid="graph.canvas"
        >
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
            // Left-drag on empty canvas draws a selection box (nodes *and* connectors);
            // panning stays on the middle/right button so it cannot swallow the box.
            selectionOnDrag
            panOnDrag={[1, 2]}
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
            onNodeContextMenu={({ node, event }) => {
              const def = nodeKind(node.data.kind);
              // Anchors have no parameters; nothing to reset.
              if (!def || def.params.length === 0) return;
              event.preventDefault();
              const rect = canvasEl?.getBoundingClientRect();
              if (!rect) return;
              setMenu({ id: node.id, x: event.clientX - rect.left, y: event.clientY - rect.top });
            }}
            onPaneClick={() => setMenu(null)}
            onNodeClick={() => setMenu(null)}
            onEdgeClick={() => setMenu(null)}
            onDelete={({ nodes, edges }) => {
              // Mirror deletions (idempotent — the library may already have done it).
              // Input/Output anchors are undeletable (`deletable: false`); skip them
              // anyway so a stray event can never remove an anchor.
              if (edges.length) {
                const ids = new Set(edges.map((edge) => edge.id));
                handle().setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
              }
              if (nodes.length) {
                const deletable = nodes.filter((node) => !isAnchorKind(node.data.kind));
                const ids = new Set(deletable.map((node) => node.id));
                handle().setNodes((current) => current.filter((node) => !ids.has(node.id)));
                // A deleted subsystem node takes its nested graph (and the tabs under
                // it) with it. Undo restores both, because this goes through the same
                // project snapshot as any other graph edit.
                dropSystemsUnder(props.graph, ids);
                closeSystemsUnder(props.graph, ids);
                const open = menu();
                if (open && ids.has(open.id)) setMenu(null);
              }
            }}
            onNodeDragStop={({ targetNode }) => {
              if (!targetNode) return;
              setNodesPosition(props.graph, targetNode.id, { ...targetNode.position });
              // Dropping an existing node onto a connector splices it in (splitting the
              // edge), matching the palette drag-and-drop behaviour.
              const def = nodeKind(targetNode.data.kind);
              if (!def) return;
              const measured = flow?.getInternalNode(targetNode.id)?.measured;
              const centre = {
                x: targetNode.position.x + (measured?.width ?? 0) / 2,
                y: targetNode.position.y + (measured?.height ?? 0) / 2,
              };
              const edge = edgeNear(handle(), flow, centre);
              if (edge && canSplice(props.graph, handle(), def, targetNode.id, edge)) {
                spliceEdge(props.graph, edge, targetNode.id);
              }
            }}
          >
            <FlowBridge ready={(api) => (flow = api)} />
            <GraphPalette
              graph={props.graph}
              canAdd={canAdd}
              onDrop={onDropPaletteNode}
              onDragMove={(def, x, y) => setDrag({ def, x, y })}
              onDraggingChange={(kind) => {
                // The canvas box cannot move during a pointer drag, so measure it once
                // here instead of on every pointer move (and keep the preview's memo to
                // one signal write per move).
                if (kind != null) setCanvasRect(canvasEl?.getBoundingClientRect() ?? null);
                setDragging(kind);
                if (kind == null) setDrag(null);
              }}
            />
            <DragPreview state={preview()} />
            <Background variant="dots" />
            <Controls position="top-right" />
            <MiniMap />
          </SolidFlow>
          <Show when={menu()}>
            {(current) => (
              <div
                class="graph-node-menu"
                role="menu"
                style={{ left: `${current().x}px`, top: `${current().y}px` }}
              >
                <button
                  type="button"
                  role="menuitem"
                  class="graph-node-menu-item"
                  data-testid="graph.node.reset"
                  onClick={() => {
                    resetNode(props.graph, current().id);
                    setMenu(null);
                  }}
                >
                  Reset node
                </button>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
