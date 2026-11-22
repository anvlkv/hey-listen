import type { GraphScope } from "../lib/graph";

/**
 * Wavetable scopes: a node with a **variadic table** (`wave_synth`) owns rows edited in
 * its own Workbench tab, addressed as `wavetable:<parent>/<node>`.
 *
 * Pure string handling, so the card, the tab and the node-deletion cleanup agree on one
 * spelling. A nested node extends the parent's path, exactly like `system:` scopes.
 */

/** A wavetable editor's scope, e.g. `wavetable:synth/wave_synth-4`. */
export type WavetableScope = `wavetable:${string}`;

const PREFIX = "wavetable:";

export function wavetableScope(parent: GraphScope, node: string): WavetableScope {
  return `${PREFIX}${parent}/${node}` as WavetableScope;
}

/** Split a wavetable scope into its owning graph and node, or `null`. */
export function parseWavetableScope(scope: string): { parent: GraphScope; node: string } | null {
  if (!scope.startsWith(PREFIX)) return null;
  const rest = scope.slice(PREFIX.length);
  const cut = rest.lastIndexOf("/");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { parent: rest.slice(0, cut) as GraphScope, node: rest.slice(cut + 1) };
}
