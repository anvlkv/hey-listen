import type { AnalysisSetup } from "../../bindings/AnalysisSetup";
import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { AnalyzerId } from "../../bindings/AnalyzerId";
import type { CachedResultInput } from "../../bindings/CachedResultInput";
import type { CachedResultOutput } from "../../bindings/CachedResultOutput";
import type { GraphSpec } from "../../bindings/GraphSpec";
import type { Meta } from "../../bindings/Meta";
import type { Annotation } from "../../bindings/Annotation";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import type { SourceDescriptor } from "../../bindings/SourceDescriptor";
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
  annotations: Annotation[];
  /** The analyzer result cache, written as the file's `RESULTS` section. */
  results: CachedResultInput[];
  /** Embed the source PCM (default). `false` writes a reference project. */
  embedSource?: boolean;
  /** The comparison tools open at save time; the core writes their snapshots (M25.C). */
  compareOpen: AnalyzerId[];
}

/** What `load_project` returns (the `DATA` samples stream separately). */
export interface LoadedProjectDto {
  meta: ProjectMetaDto;
  source: SourceDescriptorDto | null;
  setup: AnalysisSetupDto;
  layout: LayoutDto;
  /** Cached analyzer results: the loader seeds the frontend's result cache with them. */
  results: CachedResultOutput[];
  annotations: Annotation[];
  /** Saved comparisons (empty when the file has no `COMPARE` section, M25.C). */
  compare: SavedComparisonInfo[];
  /**
   * Whether the file embedded its audio (`DATA`). `false` = a reference project, which a
   * re-save keeps a reference instead of silently growing into a full copy (M37).
   */
  embedded: boolean;
  /**
   * The format version the file was written with, when this build migrated it forward (M37).
   * The project then stays dirty until a save writes the current version.
   */
  upgradedFrom: number | null;
  sampleRate: number;
  channels: number;
  frames: number;
}
