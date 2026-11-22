import type { GraphScope } from "./types";

/**
 * Subsystem scopes (M40): a node whose kind wraps an inner graph owns a nested graph
 * edited in its own Workbench tab, addressed as `system:<parent>/<node>`.
 *
 * Pure string handling, so the editor, the sidebar and tests agree on one spelling.
 * A nested subsystem extends the parent's path: `system:system:filter/fb-3/gain-2`.
 */

/** A subsystem's scope, e.g. `system:filter/feedback-3`. */
export type SubsystemScope = `system:${string}`;

const PREFIX = "system:";

/**
 * Split a `<prefix><parent>/<node>` scope into its owning graph and node, or `null`.
 *
 * Every scope kind (`system:`, `table:`, …) is one prefix plus a parent path, so the
 * split lives here once and each scope module supplies only its prefix.
 */
export function parseScoped(
  scope: string,
  prefix: string,
): { parent: GraphScope; node: string } | null {
  if (!scope.startsWith(prefix)) return null;
  const rest = scope.slice(prefix.length);
  const cut = rest.lastIndexOf("/");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { parent: rest.slice(0, cut) as GraphScope, node: rest.slice(cut + 1) };
}

export function systemScope(parent: GraphScope, node: string): SubsystemScope {
  return `${PREFIX}${parent}/${node}` as SubsystemScope;
}

/** Split a subsystem scope into its owning graph and node, or `null`. */
export function parseSystemScope(scope: string): { parent: GraphScope; node: string } | null {
  return parseScoped(scope, PREFIX);
}
