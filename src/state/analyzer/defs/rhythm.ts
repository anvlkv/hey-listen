import type { AnalyzerDef } from "../types";

/** Tempo, onset, and downbeat detection (Sidebar section `rhythm`). */
export const RHYTHM_ANALYZERS: AnalyzerDef[] = [
  {
    id: "tempo",
    title: "Tempo",
    description: "Estimated BPM and beat grid",
    about:
      "**What it shows.** A tempo estimate in BPM, a confidence score, and the beat " +
      "grid it found.\n\n" +
      "**Why use it.** Gives a starting grid for editing or checking a performance. " +
      "Best on steady, percussive material; sparse or freely played music can read " +
      "as half or double time.",
    keywords: ["tempo", "bpm", "beat", "rhythm", "pulse", "detection"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["beats"] },
  },
  {
    id: "onsets",
    title: "Onsets",
    description: "Spectral-flux onset peaks (not gated sound events)",
    about:
      "**What it shows.** Peaks in the spectral-flux envelope: moments where the " +
      "spectrum changed sharply. The detector is **not gated**, so noise can produce " +
      "events (roughly nine per second on a quiet field recording).\n\n" +
      "**Why use it.** A quick cross-check for attacks and transients. For gated sound " +
      "segments with start/end/duration use **Note segments** (`noteMetrics`), and for " +
      "the fine envelope itself use **Amplitude envelope** (`frameRms`).",
    keywords: [
      "onset",
      "attack",
      "transient",
      "event",
      "note",
      "detection",
      "spectral flux",
      "novelty",
    ],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["onsets"] },
  },
  {
    id: "downbeats",
    title: "Downbeats",
    description: "Where the bars start",
    about:
      "**What it shows.** Beat times, with the beats likely to begin a bar marked as " +
      "downbeats.\n\n" +
      "**Why use it.** Gives a bar grid for rhythmic music, so you can line up loops, " +
      "cuts, or notes. Works best with a clear bass drum; set beats per bar below.",
    keywords: ["downbeat", "bar", "measure", "beat", "meter", "rhythm"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["beats", "downbeats"] },
    params: [
      {
        key: "barLength",
        label: "Beats per bar",
        kind: "select",
        value: 4,
        options: [2, 3, 4, 5, 6, 7].map((value) => ({ value, label: `${value}` })),
        title: "Beats per bar — the time-signature numerator (4 for 4/4, 3 for 3/4).",
      },
    ],
  },
];
