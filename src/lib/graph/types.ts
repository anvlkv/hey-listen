import type { GraphSpec } from "../../bindings/GraphSpec";
import type { NodeCategory } from "../../bindings/NodeCategory";
import type { NodeDef } from "../../bindings/NodeDef";
import type { NodeParam } from "../../bindings/NodeParam";

/** The two built-in graph editors (each its own Workbench tab). */
export type GraphKind = "filter" | "synth";

/**
 * A graph scope: one of the built-in editors, or a **subsystem** (`system:<parent>/<node>`).
 * A subsystem is a node's nested graph, edited in its own Workbench tab; it has an
 * `input` and an `output` anchor like a filter graph.
 */
export type GraphScope = GraphKind | `system:${string}`;

/**
 * The node catalog is generated from Rust (`src-tauri/src/audio/graph/nodes`) by
 * `cargo test` into `src/bindings/nodeCatalog.json`; these aliases keep the editor's
 * existing names while the one table stays the source of truth.
 */
export type ParamDef = NodeParam;
export type NodeKindDef = NodeDef;

export type { NodeCategory, NodeDef, NodeParam };

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
  data: {
    kind: string;
    params: Record<string, number>;
    subgraph?: GraphSpec | null;
    /** A variadic table's rows, row-major (see `lib/graph/table.ts`). */
    table?: number[];
  };
}

export interface SpecInputEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** A node restored from a spec (an imported graph), before the store owns it. */
export interface SpecOutputNode {
  id: string;
  position: { x: number; y: number };
  data: {
    kind: string;
    params: Record<string, number>;
    subgraph?: GraphSpec | null;
  };
}

/** An edge restored from a spec. */
export interface SpecOutputEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}
