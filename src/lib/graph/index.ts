/**
 * fundsp graph model shared by the filter and synth editors.
 *
 * The model mirrors fundsp's `Net`: nodes are pushed, then their **inputs** are
 * connected (each input takes exactly one source), and the graph's result is read
 * from the single **Output** node. The filter graph also has an **Input** node.
 *
 * Both the editor palette and the compiler's port/param vocabulary come from the
 * one Rust node catalog (`src-tauri/src/audio/graph/nodes`), generated into
 * `src/bindings/nodeCatalog.json` by `cargo test` — see `docs/graph-editor.md`.
 */
export type { GraphKind, GraphScope, GraphSpec, NodeKindDef, ParamDef } from "./types";
export { parseSystemScope, systemScope, type SubsystemScope } from "./scope";
export {
  defaultParams,
  isSubsystemKind,
  nodeKind,
  NODE_KINDS,
  paletteFor,
  portLabel,
} from "./palette";
export { fromSpec, handlePort, toSpec } from "./spec";
export { graphThumbnail } from "./thumbnail";
