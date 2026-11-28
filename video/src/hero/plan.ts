/**
 * The film's edit: scene boundaries, camera moves and the agent log.
 *
 * Times are film seconds from story-assets/SCENARIO.md §6; frames are scene-local at
 * 30 fps. Camera `focus` is normalized app space (0-1), `scale` is the push-in amount.
 * Adjacent scenes repeat the outgoing value where the scenario asks for a continuous
 * dissolve (S2 -> S3, S10 -> S11).
 */

import {dissolveSource} from "./manifest";

export type SceneSpec = {
  id: string;
  fromSec: number;
  toSec: number;
  /** Shot shown after any outgoing dissolve. */
  shot: string;
  /** Seconds into the scene where the burst starts (after a dissolve). */
  burstOffsetSec?: number;
  /** Frame of `shot` held underneath while the scene fades in. */
  outgoing?: {shot: string; fadeFrames: number};
  scale: [frame: number, value: number][];
  focus: [frame: number, x: number, y: number][];
  cursor?: boolean;
  /** Scene-local frames that get a click ripple. */
  clicks?: number[];
};

export const SCENES: SceneSpec[] = [
  {
    id: "S1",
    fromSec: 0,
    toSec: 3,
    shot: "01-timeline-zoom",
    scale: [
      [0, 1],
      [6, 1.03],
      [40, 1.46],
      [58, 1.48],
      [76, 1.22],
      [90, 1.16],
    ],
    focus: [
      [0, 0.5, 0.478],
      [26, 0.5, 0.68],
      [58, 0.5, 0.75],
      [76, 0.47, 0.68],
      [90, 0.47, 0.64],
    ],
  },
  {
    id: "S2",
    fromSec: 3,
    toSec: 6.8,
    shot: "02-centroid-dark",
    scale: [
      [0, 1.18],
      [10, 1.12],
      [70, 1.1],
      [114, 1.22],
    ],
    focus: [
      [0, 0.47, 0.66],
      [30, 0.45, 0.44],
      [114, 0.43, 0.4],
    ],
    cursor: true,
    clicks: [24],
  },
  {
    id: "S3",
    fromSec: 6.8,
    toSec: 10.85,
    shot: "03-centroid-light",
    burstOffsetSec: 0.4,
    outgoing: {
      shot: dissolveSource("03-centroid-light") ?? "02-centroid-dark",
      fadeFrames: 12,
    },
    scale: [
      [0, 1.22],
      [14, 1.18],
      [60, 1.24],
      [122, 1.3],
    ],
    focus: [
      [0, 0.43, 0.4],
      [122, 0.45, 0.42],
    ],
    cursor: true,
  },
  {
    id: "S4",
    fromSec: 10.85,
    toSec: 13.6,
    shot: "04-centroid-dip-light",
    scale: [
      [0, 1.3],
      [12, 1.2],
      [82, 1.28],
    ],
    focus: [
      [0, 0.45, 0.42],
      [82, 0.47, 0.46],
    ],
    cursor: true,
    clicks: [40],
  },
  {
    id: "S5",
    fromSec: 13.6,
    toSec: 16.2,
    shot: "05-chromagram-light",
    scale: [
      [0, 1.28],
      [12, 1.18],
      [78, 1.3],
    ],
    focus: [
      [0, 0.47, 0.46],
      [78, 0.5, 0.5],
    ],
    cursor: true,
  },
  {
    id: "S6",
    fromSec: 16.2,
    toSec: 19.6,
    shot: "06-roughness-light",
    scale: [
      [0, 1.3],
      [24, 1.16],
      [60, 1.18],
      [92, 1.62],
      [102, 1.56],
    ],
    focus: [
      [0, 0.5, 0.5],
      [36, 0.55, 0.5],
      [92, 0.63, 0.5],
      [102, 0.63, 0.5],
    ],
    cursor: true,
  },
  {
    id: "S7",
    fromSec: 19.6,
    toSec: 23.6,
    shot: "07-compare-hover",
    scale: [
      [0, 1.12],
      [24, 1.14],
      [120, 1.36],
    ],
    focus: [
      [0, 0.5, 0.5],
      [120, 0.52, 0.55],
    ],
    cursor: true,
  },
  {
    id: "S8",
    fromSec: 23.6,
    toSec: 26.1,
    shot: "08-filter-light",
    scale: [
      [0, 1.14],
      [75, 1.4],
    ],
    focus: [
      [0, 0.38, 0.4],
      [75, 0.6, 0.5],
    ],
  },
  {
    id: "S9",
    fromSec: 26.1,
    toSec: 28,
    shot: "09-export-dark",
    outgoing: {
      shot: dissolveSource("09-export-dark") ?? "09-export-light",
      fadeFrames: 12,
    },
    scale: [
      [0, 1.1],
      [12, 1.06],
      [57, 1.1],
    ],
    focus: [
      [0, 0.15, 0.4],
      [57, 0.16, 0.42],
    ],
  },
  {
    id: "S10",
    fromSec: 28,
    toSec: 30,
    shot: "10-mcp-on",
    scale: [
      [0, 1.1],
      [22, 1.13],
      [34, 1.18],
      [60, 1.2],
    ],
    focus: [
      [0, 0.16, 0.42],
      [22, 0.5, 0.44],
      [40, 0.577, 0.36],
      [60, 0.577, 0.36],
    ],
    cursor: true,
    clicks: [44],
  },
  {
    id: "S11",
    fromSec: 30,
    toSec: 31.2,
    shot: "11-return-dark",
    outgoing: {shot: "10-mcp-on", fadeFrames: 15},
    scale: [
      [0, 1.2],
      [14, 1.04],
      [22, 1],
      [36, 1],
    ],
    focus: [
      [0, 0.577, 0.36],
      [14, 0.5, 0.478],
      [36, 0.5, 0.478],
    ],
  },
];

export type LogLine = {
  fromSec: number;
  toSec: number;
  kind: "call" | "thought";
  text: string;
};

/** SCENARIO.md §6.1, clamped so two lines never overlap. */
const RAW_LOG: LogLine[] = [
  {fromSec: 0.7, toSec: 2.1, kind: "call", text: "open_audio_file → Grieg…Praeludium.ogg"},
  {fromSec: 3.5, toSec: 4.9, kind: "call", text: "run_analysis spectralCentroid · 52.0–83.2"},
  {fromSec: 5.9, toSec: 7.1, kind: "thought", text: "quiet runs below -28 dBFS mark the seam"},
  {fromSec: 7.3, toSec: 8.7, kind: "call", text: "annotate 58.80 s · centroid 549 → 1015 Hz"},
  {fromSec: 11.2, toSec: 12.6, kind: "call", text: "annotate 62.85 s · centroid 371 → 165 Hz"},
  {fromSec: 13.9, toSec: 15.3, kind: "call", text: "chromagram · C 20 % · A 15 %"},
  {fromSec: 14.8, toSec: 16, kind: "call", text: "annotate 83.20 s · chroma continuity 0.64"},
  {fromSec: 16.6, toSec: 18, kind: "call", text: "roughness · 0.02–0.48 asper · max @ 68.17 s"},
  {fromSec: 18.2, toSec: 19.4, kind: "thought", text: "24 bands × 24 rates · weighted at 70 Hz"},
  {fromSec: 19.9, toSec: 21.3, kind: "call", text: "open_project_window · same OGG · 14.2–43.6"},
  {fromSec: 21.5, toSec: 22.9, kind: "call", text: "compare_analysis spectralCentroid · Δ mean"},
  {fromSec: 23.9, toSec: 25.3, kind: "call", text: "set_filter_graph tone-stack.dot · bypassed"},
  {fromSec: 26.5, toSec: 27.9, kind: "call", text: "export_all · wav + json + csv"},
  {fromSec: 28.5, toSec: 29.9, kind: "call", text: "mcp → enabled · listening on 127.0.0.1:…"},
];

export const LOG: LogLine[] = RAW_LOG.map((line, index) => {
  const next = RAW_LOG[index + 1];
  return next ? {...line, toSec: Math.min(line.toSec, next.fromSec - 0.1)} : line;
});
