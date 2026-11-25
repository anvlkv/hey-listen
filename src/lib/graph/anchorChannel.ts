import type { NodeKindDef } from "./types";

/** The minimal node shape the channel scan needs (avoids a store import cycle). */
interface ChannelNode {
  data: { kind: string; params: Record<string, number> };
}

/** A kind's `Ch` param, or `undefined` for a kind that has none. */
function channelParam(def: NodeKindDef, kind: string) {
  return def.kind === kind ? def.params.find((param) => param.key === "channel") : undefined;
}

/** The channels already taken by `def`'s siblings. */
function takenChannels(param: { default: number }, nodes: readonly ChannelNode[]): Set<number> {
  return new Set(nodes.map((node) => Math.round(node.data.params.channel ?? param.default)));
}

/**
 * The next free `Ch` for a new `output` node, or `null` for any other kind.
 *
 * Adding a second Output therefore lands on channel 1 instead of colliding with channel
 * 0 — the core rejects two Outputs on one channel (`DuplicateOutput`), and the Timeline
 * draws one lane per output channel.
 */
export function nextOutputChannel(def: NodeKindDef, nodes: readonly ChannelNode[]): number | null {
  const param = channelParam(def, "output");
  if (!param) return null;
  const used = takenChannels(
    param,
    nodes.filter((node) => node.data.kind === "output"),
  );
  for (let channel = Math.ceil(param.min); channel <= param.max; channel++) {
    if (!used.has(channel)) return channel;
  }
  return Math.round(param.max);
}

/**
 * The next free **source** channel for a new `input` node, or `null` when it would be the
 * graph's only Input.
 *
 * That first Input keeps the catalog default (`-1`, the downmix), so a plain filter graph
 * still reads the whole source. A second Input takes source channel 0, a third channel 1,
 * … — parallel branches that each read one channel.
 */
export function nextInputChannel(def: NodeKindDef, nodes: readonly ChannelNode[]): number | null {
  const param = channelParam(def, "input");
  if (!param) return null;
  const others = nodes.filter((node) => node.data.kind === "input");
  if (others.length === 0) return null;
  const used = takenChannels(param, others);
  for (let channel = 0; channel <= param.max; channel++) {
    if (!used.has(channel)) return channel;
  }
  return Math.round(param.max);
}
