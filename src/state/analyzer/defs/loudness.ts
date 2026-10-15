import { series } from "../view";
import type { AnalyzerDef } from "../types";

/** EBU R128 loudness tools (Sidebar section `loudness`). */
export const LOUDNESS_ANALYZERS: AnalyzerDef[] = [
  {
    id: "loudnessIntegrated",
    title: "Integrated LUFS",
    description: "EBU R128 integrated loudness",
    about:
      "Programme loudness integrated over the window, per EBU R128 / ITU-R BS.1770 " +
      "(with the gating the standard requires). This is the number streaming " +
      "platforms normalise to (typically −14 LUFS).",
    keywords: ["loudness", "lufs", "ebu", "r128", "integrated", "gating", "normalization"],
    section: "loudness",
    view: { kind: "readouts" },
  },
  {
    id: "loudnessMomentary",
    title: "Loudness (momentary)",
    description: "Short-term loudness over time",
    about:
      "Loudness as it evolves through the window. By default this is EBU R128 " +
      "momentary loudness (400 ms blocks, 100 ms hop); pick a custom window to use " +
      "non-overlapping blocks instead. Good for spotting level changes and dynamics.",
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
    description: "LRA — loudness spread in LU",
    about:
      "Loudness range (LRA): the spread between the quiet and loud passages of the " +
      "programme, in LU. A high LRA means wide dynamics; a low LRA means heavily " +
      "compressed, consistent material.",
    keywords: ["loudness", "range", "lra", "dynamics", "spread", "compression"],
    section: "loudness",
    view: { kind: "readouts" },
  },
];
