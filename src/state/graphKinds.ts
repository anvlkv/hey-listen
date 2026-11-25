/**
 * Anchor kinds (`input` / `output`): the graph's entry and exit points.
 *
 * A filter graph may carry several of each — one `input` per source channel it reads
 * (`Ch`, `-1` downmixing) and one `output` per channel it yields — so a read-only API
 * surface treats both as anchors, while the editor protects the last one of each kind and
 * makes a surplus one removable.
 *
 * A tiny module of its own so the graph handle registry can use it without importing
 * `state/graph.ts` (which imports the registry).
 */
export function isAnchorKind(kind: string): boolean {
  return kind === "input" || kind === "output";
}
