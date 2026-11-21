import { graphlib, layout } from "@dagrejs/dagre";

/** A node and the box dagre should reserve for it. */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

/** One directed connection, by node id. */
export interface LayoutEdge {
  source: string;
  target: string;
}

/** Direction and spacing for [`layoutGraph`]. */
export interface LayoutOptions {
  rankdir?: "LR" | "TB";
  nodesep?: number;
  ranksep?: number;
}

/**
 * Lay the graph out with dagre and return each node's **top-left** position.
 *
 * The flow stores top-left positions; dagre reports box centres, so the box is
 * subtracted back here. The graph editors are left-to-right by convention (the filter
 * seed is `Input → … → Output`), so `LR` is the default.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Record<string, { x: number; y: number }> {
  const graph = new graphlib.Graph();
  graph.setGraph({
    rankdir: options.rankdir ?? "LR",
    nodesep: options.nodesep ?? 24,
    ranksep: options.ranksep ?? 72,
    marginx: 16,
    marginy: 16,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const placed = graph.node(node.id) as { x: number; y: number };
    positions[node.id] = { x: placed.x - node.width / 2, y: placed.y - node.height / 2 };
  }
  return positions;
}
