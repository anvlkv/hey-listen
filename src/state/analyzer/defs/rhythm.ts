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
    description: "When new sounds begin",
    about:
      "**What it shows.** The start times of detected events, marked on the onset " +
      "envelope.\n\n" +
      "**Why use it.** Find attacks, note boundaries, and transients — handy for " +
      "trimming, slicing, or checking timing. The shared FFT size and hop set the " +
      "time resolution.",
    keywords: ["onset", "attack", "transient", "event", "note", "detection"],
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
