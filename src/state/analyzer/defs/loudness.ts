import { series } from "../view";
import type { AnalyzerDef } from "../types";

/** EBU R128 loudness tools (Sidebar section `loudness`). */
export const LOUDNESS_ANALYZERS: AnalyzerDef[] = [
  {
    id: "loudnessIntegrated",
    title: "Integrated LUFS",
    description: "Overall loudness for the window (EBU R128)",
    about:
      "**What it shows.** One loudness figure for the window, in LUFS, measured the " +
      "EBU R128 / ITU-R BS.1770 way — including the *gating* that skips near-silence.\n\n" +
      "**Why use it.** Streaming platforms normalise to this number (often −14 LUFS), " +
      "so it tells you how loud your material will feel next to everything else.",
    keywords: ["loudness", "lufs", "ebu", "r128", "integrated", "gating", "normalization"],
    section: "loudness",
    view: { kind: "readouts" },
  },
  {
    id: "loudnessMomentary",
    title: "Loudness (momentary)",
    description: "Loudness over time",
    about:
      "**What it shows.** Loudness as it changes through the window, with −14 LUFS " +
      "marked as a reference.\n\n" +
      "**Why use it.** Spot level changes, drops, and dynamics. By default it uses " +
      "short 400 ms blocks (EBU R128); choose a custom window for fixed, " +
      "non-overlapping blocks.",
    keywords: ["loudness", "momentary", "short term", "lufs", "dynamics", "level"],
    section: "loudness",
    view: series("loudness (LUFS)", (value) => `${value.toFixed(1)} LUFS`, {
      style: "area",
      reference: { value: -14, label: "-14 LUFS" },
    }),
    params: [
      {
        key: "windowMs",
        label: "Window",
        kind: "select",
        value: 0,
        options: [
          { value: 0, label: "EBU R128 (400 ms)" },
          { value: 100, label: "100 ms" },
          { value: 200, label: "200 ms" },
          { value: 500, label: "500 ms" },
          { value: 1000, label: "1000 ms" },
        ],
        title:
          "Analysis block length. EBU R128 uses 400 ms blocks with a 100 ms hop; custom windows use non-overlapping blocks.",
      },
    ],
  },
  {
    id: "loudnessRange",
    title: "Loudness range",
    description: "How wide the loudness swings (LRA)",
    about:
      "**What it shows.** The spread between the quiet and loud passages of the " +
      "window, in LU.\n\n" +
      "**Why use it.** A high range means wide dynamics; a low range means " +
      "compressed, even material. Useful for matching the feel of a mix or checking " +
      "a master.",
    keywords: ["loudness", "range", "lra", "dynamics", "spread", "compression"],
    section: "loudness",
    view: { kind: "readouts" },
  },
];
