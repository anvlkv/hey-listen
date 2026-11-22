/**
 * Anchor kinds (`input` / `output`): the graph's entry and exit points.
 *
 * An `input` is unique; a read-only API surface treats both as anchors, while the editor
 * protects only the last `output` (a filter graph may declare several channels).
 *
 * A tiny module of its own so the graph handle registry can use it without importing
 * `state/graph.ts` (which imports the registry).
 */
export function isAnchorKind(kind: string): boolean {
  return kind === "input" || kind === "output";
}
