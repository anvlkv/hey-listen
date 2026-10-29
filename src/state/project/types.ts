import type { AnalysisSetup } from "../../bindings/AnalysisSetup";
import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { GraphSpec } from "../../bindings/GraphSpec";
import type { Meta } from "../../bindings/Meta";
import type { Note } from "../../bindings/Note";
import type { SourceDescriptor } from "../../bindings/SourceDescriptor";
import type { StoredResult } from "../../bindings/StoredResult";
import type { GraphLayout } from "../graph";

/**
 * The project file's section DTOs (see
 * [`project-file-format.md`](../../../docs/project-file-format.md)).
 *
 * The `SOURCE`/`SETUP`/`META`/`RESULTS` shapes come from the Rust types (generated
 * via ts-rs; see `src/bindings/`); only `LAYOUT` is frontend-owned (it is the JSON
 * the frontend writes into the core's opaque `layout` value).
 */

/** `SOURCE` section: what the project's single source was. */
export type SourceDescriptorDto = SourceDescriptor;
/** A `start..end` span in source seconds. */
export type AnalysisWindowDto = AnalysisWindow;
/** `SETUP` section: shared params, per-tool options, open tools, and the windows. */
export type AnalysisSetupDto = AnalysisSetup;
/** `META` section: the project's identity and provenance. */
export type ProjectMetaDto = Meta;

/** `LAYOUT` section: the dockview snapshot plus both graph editors' state. */
export interface LayoutDto {
  dockview: unknown | null;
  graphs: { filter?: GraphLayout; synth?: GraphLayout };
  /** Tools popped out into their own windows (recreated on load). */
  popouts?: string[];
  /**
   * The compiled filter applied to preview/analysis (M25). Additive: a file saved
   * before it existed has no key, and the CLI then compares **unfiltered** (with a
   * warning) because the saved editor graph cannot be compiled without its param order.
   */
  filterSpec?: GraphSpec | null;
}

/** The frontend-supplied project data for `save_project`; the core adds `META` + `DATA`. */
export interface SaveProjectArgs {
  name: string;
  createdMs?: number;
  source: SourceDescriptorDto | null;
  setup: AnalysisSetupDto;
  layout: LayoutDto;
  notes: Note[];
  /** Embed the source PCM (default). `false` writes a reference project. */
  embedSource?: boolean;
}

/** What `load_project` returns (the `DATA` samples stream separately). */
export interface LoadedProjectDto {
  meta: ProjectMetaDto;
  source: SourceDescriptorDto | null;
  setup: AnalysisSetupDto;
  layout: LayoutDto;
  results: StoredResult[];
  notes: Note[];
  sampleRate: number;
  channels: number;
  frames: number;
}
