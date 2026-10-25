/**
 * The analyzer registry: the Sidebar's section list and the tool entries the Sidebar
 * lists and the Workbench mounts.
 *
 * The entries are split into per-section chunks (`defs/*`) purely to keep every file
 * inside the size budget — `ANALYZERS` concatenates them back into the original order,
 * which the palette and the Sidebar's section grouping depend on.
 */
import { LOUDNESS_ANALYZERS } from "./defs/loudness";
import { MODULATION_ANALYZERS } from "./defs/modulation";
import { PITCH_ANALYZERS } from "./defs/pitch";
import { RHYTHM_ANALYZERS } from "./defs/rhythm";
import { SPECTRAL_FRAME_ANALYZERS } from "./defs/spectralFrames";
import { SPECTRAL_SERIES_ANALYZERS } from "./defs/spectralSeries";
import { TIME_ANALYZERS } from "./defs/time";
import type { AnalyzerDef, AnalyzerSection } from "./types";

/** Grouping used by the Sidebar (mirrors `docs/analysis-tools.md`). */
export const ANALYZER_SECTIONS: { id: AnalyzerSection; title: string }[] = [
  { id: "time", title: "Time domain" },
  { id: "spectral", title: "Spectral" },
  { id: "pitch", title: "Pitch / melody" },
  { id: "rhythm", title: "Rhythm / tempo" },
  { id: "loudness", title: "Loudness" },
];

/** Every analyzer tool, in Sidebar order. */
export const ANALYZERS: AnalyzerDef[] = [
  ...TIME_ANALYZERS,
  ...SPECTRAL_FRAME_ANALYZERS,
  ...SPECTRAL_SERIES_ANALYZERS,
  ...MODULATION_ANALYZERS,
  ...PITCH_ANALYZERS,
  ...RHYTHM_ANALYZERS,
  ...LOUDNESS_ANALYZERS,
];
