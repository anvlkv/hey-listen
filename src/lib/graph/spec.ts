import { nodeKind } from "./palette";
import type {
  GraphSpec,
  SpecInputEdge,
  SpecInputNode,
  SpecOutputEdge,
  SpecOutputNode,
} from "./types";

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
      // A subsystem node carries its nested graph; every other kind writes `null`.
      return {
        id: node.id,
        kind: node.data.kind,
        params,
        subgraph: node.data.subgraph ?? null,
      };
    }),
    edges: edges.map((edge) => ({
      from: edge.source,
      fromPort: handlePort(edge.sourceHandle),
      to: edge.target,
      toPort: handlePort(edge.targetHandle),
    })),
  };
}

/**
 * Restore editor nodes/edges from a spec — the reverse of [`toSpec`], used when a
 * DOT file or an MCP `GraphSpec` replaces a graph. Node **positions** are not part
 * of the interchange, so imported nodes land on a simple grid and the editor's
 * **Layout** button re-derives the real one.
 */
export function fromSpec(spec: GraphSpec): {
  nodes: SpecOutputNode[];
  edges: SpecOutputEdge[];
} {
  const nodes = spec.nodes.map((node, index) => {
    const def = nodeKind(node.kind);
    const params = def
      ? Object.fromEntries(
          def.params.map((param, i) => [param.key, node.params[i] ?? param.default]),
        )
      : {};
    return {
      id: node.id,
      position: { x: 40 + (index % 4) * 220, y: 60 + Math.floor(index / 4) * 160 },
      data: {
        kind: node.kind,
        params,
        ...(node.subgraph ? { subgraph: node.subgraph } : {}),
      },
    };
  });
  const edges = spec.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.from,
    target: edge.to,
    sourceHandle: String(edge.fromPort),
    targetHandle: String(edge.toPort),
  }));
  return { nodes, edges };
}
