import { parseScoped, type GraphScope } from "../lib/graph";

/**
 * Table scopes: a node with a **variadic table** (`wave_synth` harmonics, `sequence`
 * notes) owns rows edited in its own Workbench tab, addressed as
 * `table:<parent>/<node>`.
 *
 * Pure string handling (the split is [`parseScoped`](lib/graph/scope.ts), shared with
 * subsystem scopes), so the card, the tab and the node-deletion cleanup agree on one
 * spelling. A nested node extends the parent's path, exactly like `system:` scopes.
 */

/** A table editor's scope, e.g. `table:synth/wave_synth-4`. */
export type TableScope = `table:${string}`;

const PREFIX = "table:";

export function tableScope(parent: GraphScope, node: string): TableScope {
  return `${PREFIX}${parent}/${node}` as TableScope;
}

/** Split a table scope into its owning graph and node, or `null`. */
export function parseTableScope(scope: string): { parent: GraphScope; node: string } | null {
  return parseScoped(scope, PREFIX);
}
