/**
 * fundsp graph model shared by the filter and synth editors.
 *
 * The model mirrors fundsp's `Net`: nodes are pushed, then their **inputs** are
 * connected (each input takes exactly one source), and the graph's result is read
 * from the single **Output** node. The filter graph also has an **Input** node.
 *
 * The palette here must stay in sync with the Rust compiler
 * (`src-tauri/src/audio/graph/` → `make_unit` / `kind_arity`); the compiler rejects
 * unknown kinds and impossible wiring, so drift surfaces as a `graph-error`.
 *
 * Split into a directory (M15): the node-kind table is large, so each palette group
 * lives under `kinds/` and this module re-exports the whole public API, keeping the
 * `../lib/graph` import path unchanged.
 */
export type { GraphKind, NodeKindDef, ParamDef } from "./types";
export { defaultParams, nodeKind, paletteFor } from "./palette";
export { portLabel } from "./ports";
export { handlePort, toSpec } from "./spec";
