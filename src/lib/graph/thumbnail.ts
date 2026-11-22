import type { GraphSpec } from "./types";

/**
 * A tiny block diagram of a graph's **structure**, for the subsystem node's preview
 * (the parent node shows what its tab holds without rendering audio).
 *
 * Columns are a longest-path depth from the graph's sources, so `input → a → b →
 * output` reads left to right. Positions are absolute within `width × height`.
 */

interface ThumbnailNode {
  x: number;
  y: number;
}

interface ThumbnailLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface GraphThumbnail {
  width: number;
  height: number;
  nodes: ThumbnailNode[];
  links: ThumbnailLink[];
}

const PAD = 5;
const DOT_R = 2;

export function graphThumbnail(
  spec: GraphSpec | null | undefined,
  width = 96,
  height = 40,
): GraphThumbnail {
  const nodes = (spec?.nodes ?? []).slice(0, 24);
  const edges = spec?.edges ?? [];
  if (nodes.length === 0) return { width, height, nodes: [], links: [] };

  const depth = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  // Relax the longest path; a graph the editor allows is acyclic, so |V| passes suffice.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = (depth.get(edge.from) ?? 0) + 1;
      if (next > (depth.get(edge.to) ?? 0)) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node.id]);
  }
  const maxColumn = Math.max(...columns.keys());

  const position = new Map<string, ThumbnailNode>();
  for (const [column, ids] of columns) {
    const x =
      maxColumn === 0 ? width / 2 : PAD + (column / maxColumn) * (width - PAD * 2 - DOT_R * 2);
    ids.forEach((id, row) => {
      const y =
        ids.length === 1
          ? height / 2
          : PAD + DOT_R + (row / (ids.length - 1)) * (height - (PAD + DOT_R) * 2);
      position.set(id, { x, y });
    });
  }

  const links: ThumbnailLink[] = [];
  for (const edge of edges) {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from && to) links.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  return {
    width,
    height,
    nodes: nodes.map((node) => position.get(node.id) as ThumbnailNode),
    links,
  };
}
