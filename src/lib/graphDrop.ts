import type { GraphKind, NodeKindDef } from "./graph";
import { bezierPoints, distanceToPolyline, type Point } from "./graphEdges";

/**
 * Pure drop-target geometry for the graph editors' palette drag (M22).
 *
 * The drag **preview** and the real drop both resolve through [`dropTarget`], so what the
 * user sees is exactly what happens: a plain placement, a splice into the nearest
 * connector, or `null` (not allowed). Kept free of the graph stores so it can be
 * unit-tested; `components/graphEditor/placement.ts` wires it to the store and the
 * `solid-flow` instance.
 */

/** Half a node's nominal size, so a dropped node is centred on the cursor. */
export const NODE_HALF_WIDTH = 70;
export const NODE_HALF_HEIGHT = 27;
/** The outline size the drop preview shows (a node's nominal box). */
export const DROP_NODE_WIDTH = NODE_HALF_WIDTH * 2;
export const DROP_NODE_HEIGHT = NODE_HALF_HEIGHT * 2;
/** How close (in flow units) a drop must land to a connector to splice in. */
const SPLICE_RADIUS = 26;

/** The slice of the graph handle the drop needs (the real `GraphHandle` satisfies it). */
export interface DropHandle {
  nodes: readonly { data: { kind: string } }[];
  edges: readonly {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }[];
}

/** A handle's measured box, as `solid-flow` reports it. */
export interface DropPort {
  id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of the flow API the drop needs (the real `FlowApi` satisfies it). */
export interface DropFlow {
  getInternalNode(id: string):
    | {
        internals: {
          positionAbsolute: { x: number; y: number };
          handleBounds?: {
            source?: readonly DropPort[] | null;
            target?: readonly DropPort[] | null;
          } | null;
        };
      }
    | undefined;
}

/** Where a palette node will land: its top-left corner, and the connector to splice into. */
export interface DropTarget {
  position: Point;
  edge: DropHandle["edges"][number] | null;
}

/** Whether `def` may still be added (the `input`/`output` anchors are unique). */
export function kindAvailable(graph: GraphKind, nodes: DropHandle["nodes"], kind: string): boolean {
  if (graph === "synth" && kind === "input") return false;
  if (kind !== "input" && kind !== "output") return true;
  return !nodes.some((node) => node.data.kind === kind);
}

/** The flow-coordinate centre of a handle, or null if the node isn't measured yet. */
export function handleCentre(
  flow: DropFlow | undefined,
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

/** The connector nearest `point` (within the splice radius), or null. */
export function edgeNear(
  handle: DropHandle,
  flow: DropFlow | undefined,
  point: Point,
): DropTarget["edge"] | null {
  let best: DropTarget["edge"] | null = null;
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
 * Resolve a palette drop. `null` means the drop is invalid — the node kind is unavailable
 * (a second anchor, or an `input` in a synth) — and the preview reads as not-allowed.
 *
 * A brand-new node has no edges and cannot create a cycle, so the splice rule reduces to
 * "it has both an input and an output".
 */
export function dropTarget(
  graph: GraphKind,
  handle: DropHandle,
  flow: DropFlow | undefined,
  def: NodeKindDef,
  point: Point,
): DropTarget | null {
  if (!kindAvailable(graph, handle.nodes, def.kind)) return null;
  const near = edgeNear(handle, flow, point);
  const splicable = def.inputs >= 1 && def.outputs >= 1;
  return {
    position: { x: point.x - NODE_HALF_WIDTH, y: point.y - NODE_HALF_HEIGHT },
    edge: near && splicable ? near : null,
  };
}
