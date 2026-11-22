import { handlePort, type GraphScope, type NodeKindDef } from "../../lib/graph";
import { dropTarget, kindAvailable, type DropFlow, type DropTarget } from "../../lib/graphDrop";
import {
  addNodeAt,
  graphFor,
  spliceEdge,
  type GraphEdge,
  type GraphHandle,
} from "../../state/graph";
import { reaches } from "./connections";

export {
  DROP_NODE_HEIGHT,
  DROP_NODE_WIDTH,
  dropTarget,
  edgeNear,
  handleCentre,
} from "../../lib/graphDrop";

/** Whether `def` may still be added to the editor's graph (anchors are unique). */
export function canAddKind(graph: GraphScope, def: NodeKindDef): boolean {
  return kindAvailable(graph, graphFor(graph).nodes, def.kind);
}

/**
 * Whether `nodeId` can be spliced into `edge` — it must have both an input and an
 * output, neither port 0 may be taken, and the new `source → node → target` path
 * must not create a cycle.
 */
export function canSplice(
  graph: GraphScope,
  handle: GraphHandle,
  def: NodeKindDef,
  nodeId: string,
  edge: GraphEdge,
): boolean {
  if (def.inputPorts.length < 1 || def.outputPorts.length < 1) return false;
  if (edge.source === nodeId || edge.target === nodeId) return false;
  const edges = handle.edges;
  const inletFree = !edges.some((e) => e.target === nodeId && handlePort(e.targetHandle) === 0);
  const outletFree = !edges.some((e) => e.source === nodeId && handlePort(e.sourceHandle) === 0);
  if (!inletFree || !outletFree) return false;
  if (reaches(graph, nodeId, edge.source)) return false;
  if (reaches(graph, edge.target, nodeId)) return false;
  return true;
}

/** Add `def` centred on `point`, splicing it into the nearest connector if any. */
export function placeNode(
  graph: GraphScope,
  flow: DropFlow | undefined,
  def: NodeKindDef,
  point: { x: number; y: number },
) {
  const target: DropTarget | null = dropTarget(graph, graphFor(graph), flow, def, point);
  if (!target) return;
  const node = addNodeAt(graph, def, target.position);
  if (target.edge) spliceEdge(graph, target.edge as GraphEdge, node.id);
}
