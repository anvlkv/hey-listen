import { handlePort, type GraphKind } from "../../lib/graph";
import { clearGraphWarning, graphFor } from "../../state/graph";

/** Whether `to` is reachable from `from` following existing edges. */
export function reaches(graph: GraphKind, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of graphFor(graph).edges) {
      if (edge.source === node) stack.push(edge.target);
    }
  }
  return false;
}

/**
 * Why a proposed connection is invalid, or `null` if it is fine.
 *
 * Mirrors the core's rules (`audio/graph/`): one source per input, no self-links,
 * no cycles.
 */
export function connectionProblem(
  graph: GraphKind,
  source: string,
  target: string,
  targetHandle?: string | null,
): string | null {
  if (source === target) return "A node cannot connect to itself.";
  const port = handlePort(targetHandle);
  const occupied = graphFor(graph).edges.some(
    (edge) => edge.target === target && handlePort(edge.targetHandle) === port,
  );
  if (occupied) return "That input already has a connection — each input takes one source.";
  if (reaches(graph, target, source)) return "That connection would create a loop.";
  return null;
}

/** Add a new edge to our store unless the library already mirrored it (idempotent). */
export function onConnected(
  graph: GraphKind,
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
) {
  clearGraphWarning();
  const handle = graphFor(graph);
  const exists = handle.edges.some(
    (edge) =>
      edge.id === id ||
      (edge.source === source &&
        edge.target === target &&
        handlePort(edge.sourceHandle) === handlePort(sourceHandle) &&
        handlePort(edge.targetHandle) === handlePort(targetHandle)),
  );
  if (!exists) {
    handle.setEdges((edges) => [
      ...edges,
      {
        id,
        source,
        target,
        sourceHandle: sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
      },
    ]);
  }
}
