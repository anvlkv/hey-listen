import "@dschz/solid-flow/styles";
import { createSignal, type JSX } from "solid-js";
import { Background, Controls, MiniMap, SolidFlow, type NodeTypes } from "@dschz/solid-flow";
import { nodeKind, type GraphKind, type NodeKindDef } from "../lib/graph";
import {
  clearGraphWarning,
  graphFor,
  hasKind,
  isAnchorKind,
  setNodesPosition,
  spliceEdge,
  warnGraph,
} from "../state/graph";
import { resolvedTheme, themeFlow } from "../state/themes";
import GraphNode from "./GraphNode";
import { connectionProblem, onConnected } from "./graphEditor/connections";
import GraphPalette from "./graphEditor/GraphPalette";
import { FlowBridge, type FlowApi } from "./graphEditor/flowBridge";
import { canSplice, edgeNear, placeNode } from "./graphEditor/placement";

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
export default function GraphEditor(props: { graph: GraphKind; children?: JSX.Element }) {
  // The flow instance, captured via `FlowBridge` on mount (user gestures only fire
  // after that), so nothing reactive is lost by keeping it in a plain variable.
  let flow: FlowApi | undefined;
  let canvasEl!: HTMLDivElement;
  /** The kind currently being dragged from the palette (`null` when idle). */
  const [dragging, setDragging] = createSignal<string | null>(null);

  const handle = () => graphFor(props.graph);

  const canAdd = (def: NodeKindDef) =>
    def.kind !== "input" && def.kind !== "output" ? true : !hasKind(props.graph, def.kind);

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
    placeNode(
      props.graph,
      flow,
      handle(),
      def,
      flow.screenToFlowPosition({ x: clientX, y: clientY }),
    );
  }

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">{props.children}</div>
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
                nodes.filter((node) => !isAnchorKind(node.data.kind)).map((node) => node.id),
              );
              handle().setNodes((current) => current.filter((node) => !ids.has(node.id)));
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
            onDraggingChange={setDragging}
          />
          <Background variant="dots" />
          <Controls position="top-right" />
          <MiniMap />
        </SolidFlow>
      </div>
    </div>
  );
}
