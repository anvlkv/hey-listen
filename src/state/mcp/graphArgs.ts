import { invoke } from "../../lib/ipc";
import type { GraphSpec } from "../../lib/graph";
import { optionalStr } from "./args";

/**
 * The graph an agent sent: a `graphFile` path, inline DOT text, or a legacy JSON
 * `GraphSpec`. `undefined` means the call did not supply a graph at all.
 */
export async function graphSpecArg(args: Record<string, unknown>): Promise<GraphSpec | undefined> {
  const path = optionalStr(args, "graphFile");
  if (path) return invoke<GraphSpec>("graph_read_file", { path });
  if (!("graph" in args)) return undefined;
  const graph = args.graph;
  if (graph === null) return { nodes: [], edges: [] };
  if (typeof graph === "string") return invoke<GraphSpec>("graph_from_dot", { dot: graph });
  return graph as GraphSpec;
}
