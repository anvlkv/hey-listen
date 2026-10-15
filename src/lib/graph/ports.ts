/**
 * Per-kind port labels for multi-port nodes, indexed by port. Input 0 of a `*_cv`
 * filter is always the audio; the rest are control signals. A missing entry falls
 * back to `in`/`out` (single port) or `in1`/`out1`… (multiple ports).
 */
const PORT_LABELS: Record<string, { in?: string[]; out?: string[] }> = {
  mix: { in: ["A", "B"] },
  split: { out: ["L", "R"] },
  join: { in: ["L", "R"] },
  // Math: binary nodes take A and B.
  add: { in: ["A", "B"] },
  subtract: { in: ["A", "B"] },
  multiply: { in: ["A", "B"] },
  divide: { in: ["A", "B"] },
  min: { in: ["A", "B"] },
  max: { in: ["A", "B"] },
  // Stereo set (L/R).
  pan: { out: ["L", "R"] },
  panner: { in: ["audio", "pan"], out: ["L", "R"] },
  rotate: { in: ["L", "R"], out: ["L", "R"] },
  limiter_stereo: { in: ["L", "R"], out: ["L", "R"] },
  reverb_stereo: { in: ["L", "R"], out: ["L", "R"] },
  reverb2_stereo: { in: ["L", "R"], out: ["L", "R"] },
  reverb3_stereo: { in: ["L", "R"], out: ["L", "R"] },
  reverb4_stereo: { in: ["L", "R"], out: ["L", "R"] },
  schroeder_cv: { in: ["audio", "coef"] },
  // Control-input filters (audio, cutoff[, Q[, gain/morph]]).
  lowpass_cv: { in: ["audio", "cut", "Q"] },
  highpass_cv: { in: ["audio", "cut", "Q"] },
  bandpass_cv: { in: ["audio", "cut", "Q"] },
  notch_cv: { in: ["audio", "cut", "Q"] },
  peak_cv: { in: ["audio", "cut", "Q"] },
  allpass_cv: { in: ["audio", "cut", "Q"] },
  moog_cv: { in: ["audio", "cut", "Q"] },
  lowrez_cv: { in: ["audio", "cut", "Q"] },
  bandrez_cv: { in: ["audio", "cut", "Q"] },
  resonator_cv: { in: ["audio", "center", "bw"] },
  bell_cv: { in: ["audio", "cut", "Q", "gain"] },
  lowshelf_cv: { in: ["audio", "cut", "Q", "gain"] },
  highshelf_cv: { in: ["audio", "cut", "Q", "gain"] },
  morph_cv: { in: ["audio", "cut", "Q", "morph"] },
  butterpass_cv: { in: ["audio", "cut"] },
  lowpole_cv: { in: ["audio", "cut"] },
  highpole_cv: { in: ["audio", "cut"] },
  allpole_cv: { in: ["audio", "delay"] },
};

/** The tiny label for port `index` of `count` on one side of a node kind. */
export function portLabel(
  kind: string | undefined,
  side: "in" | "out",
  index: number,
  count: number,
): string {
  const labels = kind ? PORT_LABELS[kind]?.[side] : undefined;
  if (labels?.[index]) return labels[index];
  if (count > 1) return side === "in" ? `in${index + 1}` : `out${index + 1}`;
  return side === "in" ? "in" : "out";
}
