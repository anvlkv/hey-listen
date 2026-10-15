import type { GraphSpec } from "../../bindings/GraphSpec";

/** The two graph editors (each its own Workbench tab). */
export type GraphKind = "filter" | "synth";

/** One editable numeric parameter of a node kind. */
export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** The palette groups a node kind can belong to. */
export type NodeCategory =
  | "io"
  | "mixer"
  | "math"
  | "processor"
  | "filtercv"
  | "dynamics"
  | "modulation"
  | "reverb"
  | "control"
  | "generator";

/** A node kind offered in the palette. */
export interface NodeKindDef {
  kind: string;
  label: string;
  category: NodeCategory;
  /** Visible input handles (one connection each). */
  inputs: number;
  outputs: number;
  params: ParamDef[];
  /** Only offered in filter graphs (the signal entry point). */
  filterOnly?: boolean;
  /** Only offered in synth graphs (sound generators). */
  synthOnly?: boolean;
  /** A short, plain-language description of what the node does (tooltip). */
  hint?: string;
}

/**
 * A graph as it crosses IPC to the Rust core. The shape is generated from the Rust
 * `GraphSpec`/`GraphNode`/`GraphEdge` via ts-rs (`src/bindings/`), so the editor and
 * the core share one definition.
 */
export type { GraphSpec };

/**
 * Minimal structural shape of an editor node/edge, so `toSpec` does not depend on
 * the solid-flow store types (avoids a cycle with `state/graph.ts`).
 */
export interface SpecInputNode {
  id: string;
  data: { kind: string; params: Record<string, number> };
}

export interface SpecInputEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
