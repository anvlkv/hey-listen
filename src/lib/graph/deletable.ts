/** The node shape the layout helpers need (structural, so no store import cycle). */
interface LayoutNode {
  data: { kind: string };
  deletable?: boolean;
}

/** Which anchors a graph may lose: the last one of each kind is protected. */
export interface SurplusAnchors {
  inputs: boolean;
  outputs: boolean;
}

// `deletable` is **editor-local**: `GraphEditor` derives it from the anchor counts (a
// surplus Input/Output can be removed, the last of each cannot). It must not be persisted
// or synced, because a window with the editor mounted would write a different value than
// one without — and the shared layout then ping-pongs between the two.

/** The same node without its editor-local `deletable` flag. */
export function withoutDeletable<T extends LayoutNode>(node: T): T {
  const copy = { ...node };
  delete copy.deletable;
  return copy;
}

/** The same node with `deletable` derived from the graph's shape. */
export function withDeletable<T extends LayoutNode>(node: T, surplus: SurplusAnchors): T {
  if (node.data.kind === "input") return { ...node, deletable: surplus.inputs };
  if (node.data.kind === "output") return { ...node, deletable: surplus.outputs };
  return withoutDeletable(node);
}

/** Whether a graph has a removable (surplus) anchor of each kind. */
export function surplusAnchors(nodes: readonly LayoutNode[]): SurplusAnchors {
  const count = (kind: string) => nodes.filter((node) => node.data.kind === kind).length;
  return { inputs: count("input") > 1, outputs: count("output") > 1 };
}
