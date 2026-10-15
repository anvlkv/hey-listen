import { handlePort, type GraphKind, type NodeKindDef } from "../../lib/graph";
import { bezierPoints, distanceToPolyline, type Point } from "../../lib/graphEdges";
import { addNodeAt, spliceEdge, type GraphEdge, type GraphHandle } from "../../state/graph";
import { reaches } from "./connections";
import type { FlowApi } from "./flowBridge";

/** Half a node's nominal size, so a dropped node is centred on the cursor. */
const NODE_HALF_WIDTH = 70;
const NODE_HALF_HEIGHT = 27;
/** How close (in flow units) a drop must land to a connector to splice in. */
const SPLICE_RADIUS = 26;

/** The flow-coordinate centre of a handle, or null if the node isn't measured yet. */
export function handleCentre(
  flow: FlowApi | undefined,
  nodeId: string,
  type: "source" | "target",
  handleId: string | null | undefined,
): Point | null {
  const internal = flow?.getInternalNode(nodeId);
  if (!internal) return null;
  const bounds =
    type === "source"
      ? internal.internals.handleBounds?.source
      : internal.internals.handleBounds?.target;
  const wanted = handleId ?? "0";
  const found = bounds?.find((candidate) => (candidate.id ?? "0") === wanted) ?? bounds?.[0];
  if (!found) return null;
  return {
    x: internal.internals.positionAbsolute.x + found.x + found.width / 2,
    y: internal.internals.positionAbsolute.y + found.y + found.height / 2,
  };
}

/** The connector nearest `point` (within [`SPLICE_RADIUS`]), or null. */
export function edgeNear(
  handle: GraphHandle,
  flow: FlowApi | undefined,
  point: Point,
): GraphEdge | null {
  let best: GraphEdge | null = null;
  let bestDistance = SPLICE_RADIUS;
  for (const edge of handle.edges) {
    const source = handleCentre(flow, edge.source, "source", edge.sourceHandle);
    const target = handleCentre(flow, edge.target, "target", edge.targetHandle);
    if (!source || !target) continue;
    const distance = distanceToPolyline(point, bezierPoints(source, target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edge;
    }
  }
  return best;
}

/**
 * Whether `nodeId` can be spliced into `edge` — it must have both an input and an
 * output, neither port 0 may be taken, and the new `source → node → target` path
 * must not create a cycle.
 */
export function canSplice(
  graph: GraphKind,
  handle: GraphHandle,
  def: NodeKindDef,
  nodeId: string,
  edge: GraphEdge,
): boolean {
  if (def.inputs < 1 || def.outputs < 1) return false;
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
  graph: GraphKind,
  flow: FlowApi | undefined,
  handle: GraphHandle,
  def: NodeKindDef,
  point: Point,
) {
  const node = addNodeAt(graph, def, {
    x: point.x - NODE_HALF_WIDTH,
    y: point.y - NODE_HALF_HEIGHT,
  });
  const edge = edgeNear(handle, flow, point);
  if (edge && canSplice(graph, handle, def, node.id, edge)) spliceEdge(graph, edge, node.id);
}
