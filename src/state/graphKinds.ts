/**
 * Anchor kinds (`input` / `output`): undeletable and unique in a graph.
 *
 * A tiny module of its own so the graph handle registry can use it without importing
 * `state/graph.ts` (which imports the registry).
 */
export function isAnchorKind(kind: string): boolean {
  return kind === "input" || kind === "output";
}
