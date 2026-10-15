import { nodeKind } from "./palette";
import type { GraphSpec, SpecInputEdge, SpecInputNode } from "./types";

/** A handle id as a port index (`"0"`/`"1"` → 0/1; missing → 0). */
export function handlePort(handle: string | null | undefined): number {
  const port = Number(handle);
  return Number.isInteger(port) && port >= 0 ? port : 0;
}

/** Convert editor nodes/edges into the IPC graph spec (positional params). */
export function toSpec(
  nodes: readonly SpecInputNode[],
  edges: readonly SpecInputEdge[],
): GraphSpec {
  return {
    nodes: nodes.map((node) => {
      const def = nodeKind(node.data.kind);
      const params = def
        ? def.params.map((param) => node.data.params[param.key] ?? param.default)
        : [];
      return { id: node.id, kind: node.data.kind, params };
    }),
    edges: edges.map((edge) => ({
      from: edge.source,
      fromPort: handlePort(edge.sourceHandle),
      to: edge.target,
      toPort: handlePort(edge.targetHandle),
    })),
  };
}
