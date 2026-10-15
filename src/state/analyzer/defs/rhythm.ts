import type { AnalyzerDef } from "../types";

/** Tempo, onset, and downbeat detection (Sidebar section `rhythm`). */
export const RHYTHM_ANALYZERS: AnalyzerDef[] = [
  {
    id: "tempo",
    title: "Tempo",
    description: "Estimated BPM and beat grid",
    about:
      "Estimates the tempo (BPM) from an onset-strength histogram and returns a " +
      "confidence and a beat grid. Works best on steady, percussive material; expect " +
      "octave errors (half/double time) on sparse or rubato input.",
    keywords: ["tempo", "bpm", "beat", "rhythm", "pulse", "detection"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["beats"] },
  },
  {
    id: "onsets",
    title: "Onsets",
    description: "Detected note / event start times",
    about:
      "Detects onset times (in seconds) by spectral-flux peak picking. Useful for " +
      "finding attacks, transients, and note boundaries. Tune expectations with the " +
      "shared FFT size and hop.",
    keywords: ["onset", "attack", "transient", "event", "note", "detection"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["onsets"] },
  },
  {
    id: "downbeats",
    title: "Downbeats",
    description: "Estimated bar-start beat times",
    about:
      "Estimates the tempo, then picks the beats likely to start a bar (downbeats) " +
      "using above-average bass energy. Set the beats-per-bar below (4 for 4/4). " +
      "Best on rhythmic music with a clear bass drum.",
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
