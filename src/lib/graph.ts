/**
 * fundsp graph model shared by the filter and synth editors.
 *
 * The model mirrors fundsp's `Net`: nodes are pushed, then their **inputs** are
 * connected (each input takes exactly one source), and the graph's result is read
 * from the single **Output** node. The filter graph also has an **Input** node.
 *
 * The palette here must stay in sync with the Rust compiler
 * (`src-tauri/src/audio/graph.rs` → `make_unit` / `kind_arity`); the compiler rejects
 * unknown kinds and impossible wiring, so drift surfaces as a `graph-error`.
 */

/** A graph as it crosses IPC to the Rust core (camelCase keys). */
export interface GraphSpec {
  nodes: SpecNode[];
  edges: SpecEdge[];
}

export interface SpecNode {
  id: string;
  kind: string;
  params: number[];
}

export interface SpecEdge {
  from: string;
  fromPort: number;
  to: string;
  toPort: number;
}

/** The two graph editors (each its own Workbench tab). */
export type GraphKind = "filter" | "synth";

/** One editable numeric parameter of a node kind. */
export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** The palette groups a node kind can belong to. */
export type NodeCategory =
  | "io"
  | "mixer"
  | "processor"
  | "filtercv"
  | "dynamics"
  | "modulation"
  | "reverb"
  | "control"
  | "generator";

/** A node kind offered in the palette. */
export interface NodeKindDef {
  kind: string;
  label: string;
  category: NodeCategory;
  /** Visible input handles (one connection each). */
  inputs: number;
  outputs: number;
  params: ParamDef[];
  /** Only offered in filter graphs (the signal entry point). */
  filterOnly?: boolean;
  /** Only offered in synth graphs (sound generators). */
  synthOnly?: boolean;
  /** A short, plain-language description of what the node does (tooltip). */
  hint?: string;
}

function freqParam(defaultValue = 1_000): ParamDef {
  return {
    key: "freq",
    label: "Freq",
    default: defaultValue,
    min: 20,
    max: 20_000,
    step: 1,
    unit: "Hz",
  };
}

const Q_PARAM: ParamDef = { key: "q", label: "Q", default: 1, min: 0.1, max: 20, step: 0.1 };

/** Amplitude gain for shelf/bell filters (`1` is flat, `4` is +12 dB). */
function gainParam(defaultValue = 1): ParamDef {
  return { key: "gain", label: "Gain", default: defaultValue, min: 0, max: 4, step: 0.05 };
}

/** Delay time in seconds. */
function timeParam(defaultValue = 0.01, max = 0.2): ParamDef {
  return { key: "time", label: "Time", default: defaultValue, min: 0, max, step: 0.001, unit: "s" };
}

/** Pulse width in 0..1. */
const WIDTH_PARAM: ParamDef = { key: "width", label: "Width", default: 0.5, min: 0.01, max: 0.99, step: 0.01 };

/** Every node kind the editor can place. */
export const NODE_KINDS: NodeKindDef[] = [
  // Anchors. The filter graph's input; both graphs' output.
  {
    kind: "input",
    label: "Input",
    category: "io",
    inputs: 0,
    outputs: 1,
    params: [],
    filterOnly: true,
    hint: "Where the mono signal enters the filter graph.",
  },
  {
    kind: "output",
    label: "Output",
    category: "io",
    inputs: 1,
    outputs: 0,
    params: [],
    hint: "Where the graph's mono result is read.",
  },
  // Mixer / routing.
  {
    kind: "mix",
    label: "Mix",
    category: "mixer",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "Sums two signals into one.",
  },
  {
    kind: "split",
    label: "Split",
    category: "mixer",
    inputs: 1,
    outputs: 2,
    params: [],
    hint: "Copies a mono signal into two identical channels.",
  },
  {
    kind: "join",
    label: "Join",
    category: "mixer",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "Averages two channels back into one — use after stereo processing.",
  },
  // Processors — filters and utilities (fixed parameters via the `*_hz` constructors).
  {
    kind: "gain",
    label: "Gain",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [{ key: "gain", label: "Gain", default: 1, min: 0, max: 4, step: 0.05 }],
    hint: "Scales the signal's amplitude.",
  },
  {
    kind: "lowpass",
    label: "Low-pass",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Attenuates frequencies above the cutoff.",
  },
  {
    kind: "highpass",
    label: "High-pass",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Attenuates frequencies below the cutoff.",
  },
  {
    kind: "bandpass",
    label: "Band-pass",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Passes a band around the center frequency, attenuating both sides.",
  },
  {
    kind: "notch",
    label: "Notch",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Cuts a narrow band around the center frequency.",
  },
  {
    kind: "peak",
    label: "Peak",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Boosts or cuts a band around the center frequency.",
  },
  {
    kind: "allpass",
    label: "All-pass",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Shifts phase around the center frequency without changing the level.",
  },
  {
    kind: "bell",
    label: "Bell",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM, gainParam()],
    hint: "Peaking bell EQ: boosts or cuts around the center frequency by a gain.",
  },
  {
    kind: "lowshelf",
    label: "Low shelf",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM, gainParam(0.5)],
    hint: "Boosts or cuts all frequencies below the cutoff by a fixed gain.",
  },
  {
    kind: "highshelf",
    label: "High shelf",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM, gainParam(0.5)],
    hint: "Boosts or cuts all frequencies above the cutoff by a fixed gain.",
  },
  {
    kind: "moog",
    label: "Moog",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Resonant analogue-style low-pass (Moog ladder) with a steep roll-off.",
  },
  {
    kind: "butterpass",
    label: "Butterworth",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam()],
    hint: "Second-order Butterworth low-pass — a maximally flat passband.",
  },
  {
    kind: "lowpole",
    label: "Low-pole",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam()],
    hint: "Gentle one-pole low-pass (6 dB/octave).",
  },
  {
    kind: "highpole",
    label: "High-pole",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam()],
    hint: "Gentle one-pole high-pass (6 dB/octave).",
  },
  {
    kind: "lowrez",
    label: "Low-rez",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Resonant two-pole low-pass with a synthetic, 'acid' character.",
  },
  {
    kind: "bandrez",
    label: "Band-rez",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [freqParam(), Q_PARAM],
    hint: "Resonant two-pole band-pass.",
  },
  {
    kind: "resonator",
    label: "Resonator",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [
      freqParam(),
      { key: "bandwidth", label: "BW", default: 110, min: 1, max: 5_000, step: 1, unit: "Hz" },
    ],
    hint: "Constant-gain band-pass resonator: rings at the center frequency over a bandwidth.",
  },
  {
    kind: "morph",
    label: "Morph",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [
      freqParam(),
      Q_PARAM,
      { key: "morph", label: "Morph", default: 0, min: -1, max: 1, step: 0.05 },
    ],
    hint: "Morphing filter: -1 low-pass, 0 peaking, +1 high-pass.",
  },
  {
    kind: "pinkpass",
    label: "Pink tilt",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [],
    hint: "Tilts the spectrum to a -3 dB/octave (pink) response.",
  },
  {
    kind: "allpole_delay",
    label: "All-pass (delay)",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [{ key: "delay", label: "Delay", default: 1, min: 0.1, max: 100, step: 0.1, unit: "smp" }],
    hint: "First-order all-pass whose phase shift is set by a delay in samples.",
  },
  {
    kind: "biquad",
    label: "Biquad",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "a1", label: "a1", default: 0, min: -2, max: 2, step: 0.001 },
      { key: "a2", label: "a2", default: 0, min: -2, max: 2, step: 0.001 },
      { key: "b0", label: "b0", default: 1, min: -2, max: 2, step: 0.001 },
      { key: "b1", label: "b1", default: 0, min: -2, max: 2, step: 0.001 },
      { key: "b2", label: "b2", default: 0, min: -2, max: 2, step: 0.001 },
    ],
    hint: "A general second-order filter defined by explicit coefficients.",
  },
  {
    kind: "dcblock",
    label: "DC block",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [],
    hint: "Removes DC offset (very low frequencies).",
  },
  {
    kind: "delay",
    label: "Delay",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [{ key: "time", label: "Time", default: 0.25, min: 0, max: 2, step: 0.01, unit: "s" }],
    hint: "Delays the signal by a fixed time.",
  },
  // Stereo: mono→stereo panning and 2-channel processing (join back before Output).
  {
    kind: "pan",
    label: "Pan",
    category: "processor",
    inputs: 1,
    outputs: 2,
    params: [{ key: "pan", label: "Pan", default: 0, min: -1, max: 1, step: 0.01 }],
    hint: "Places a mono signal in the stereo field (-1 left, +1 right).",
  },
  {
    kind: "panner",
    label: "Panner (cv)",
    category: "processor",
    inputs: 2,
    outputs: 2,
    params: [],
    hint: "Widens a mono signal using a control input for position — inputs: signal, pan (-1..1).",
  },
  {
    kind: "rotate",
    label: "Stereo rotate",
    category: "processor",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "angle", label: "Angle", default: 0, min: -3.1416, max: 3.1416, step: 0.01, unit: "rad" },
      { key: "gain", label: "Gain", default: 1, min: 0, max: 2, step: 0.01 },
    ],
    hint: "Rotates the stereo image by an angle, with an overall gain.",
  },
  // Control-input filters: cutoff and/or Q are driven by other signals (feed them
  // from `dc`/`sine_lfo`). Input 0 is always the audio; later inputs are control.
  {
    kind: "lowpass_cv",
    label: "Low-pass (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Low-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "highpass_cv",
    label: "High-pass (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "High-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "bandpass_cv",
    label: "Band-pass (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Band-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "notch_cv",
    label: "Notch (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Notch driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "peak_cv",
    label: "Peak (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Peaking filter driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "allpass_cv",
    label: "All-pass (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "All-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "bell_cv",
    label: "Bell (cv)",
    category: "filtercv",
    inputs: 4,
    outputs: 1,
    params: [],
    hint: "Bell EQ driven by control signals — inputs: audio, cutoff, Q, gain.",
  },
  {
    kind: "lowshelf_cv",
    label: "Low shelf (cv)",
    category: "filtercv",
    inputs: 4,
    outputs: 1,
    params: [],
    hint: "Low shelf driven by control signals — inputs: audio, cutoff, Q, gain.",
  },
  {
    kind: "highshelf_cv",
    label: "High shelf (cv)",
    category: "filtercv",
    inputs: 4,
    outputs: 1,
    params: [],
    hint: "High shelf driven by control signals — inputs: audio, cutoff, Q, gain.",
  },
  {
    kind: "moog_cv",
    label: "Moog (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Moog ladder low-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "lowrez_cv",
    label: "Low-rez (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Resonant low-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "bandrez_cv",
    label: "Band-rez (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Resonant band-pass driven by control signals — inputs: audio, cutoff, Q.",
  },
  {
    kind: "resonator_cv",
    label: "Resonator (cv)",
    category: "filtercv",
    inputs: 3,
    outputs: 1,
    params: [],
    hint: "Resonator driven by control signals — inputs: audio, center, bandwidth.",
  },
  {
    kind: "morph_cv",
    label: "Morph (cv)",
    category: "filtercv",
    inputs: 4,
    outputs: 1,
    params: [],
    hint: "Morphing filter driven by control signals — inputs: audio, cutoff, Q, morph.",
  },
  {
    kind: "butterpass_cv",
    label: "Butterworth (cv)",
    category: "filtercv",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "Butterworth low-pass with a control-driven cutoff — inputs: audio, cutoff.",
  },
  {
    kind: "lowpole_cv",
    label: "Low-pole (cv)",
    category: "filtercv",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "One-pole low-pass with a control-driven cutoff — inputs: audio, cutoff.",
  },
  {
    kind: "highpole_cv",
    label: "High-pole (cv)",
    category: "filtercv",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "One-pole high-pass with a control-driven cutoff — inputs: audio, cutoff.",
  },
  {
    kind: "allpole_cv",
    label: "All-pass (cv)",
    category: "filtercv",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "All-pass with a control-driven delay — inputs: audio, delay (samples).",
  },
  // Dynamics.
  {
    kind: "limiter",
    label: "Limiter",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "attack", label: "Attack", default: 0.005, min: 0.001, max: 0.1, step: 0.001, unit: "s" },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Prevents the signal from exceeding full scale (look-ahead limiter).",
  },
  {
    kind: "limiter_stereo",
    label: "Limiter (stereo)",
    category: "dynamics",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "attack", label: "Attack", default: 0.005, min: 0.001, max: 0.1, step: 0.001, unit: "s" },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Stereo look-ahead limiter — holds both channels within full scale.",
  },
  {
    kind: "compressor",
    label: "Compressor",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "threshold", label: "Thresh", default: -18, min: -60, max: 0, step: 0.5, unit: "dB" },
      { key: "ratio", label: "Ratio", default: 4, min: 1, max: 20, step: 0.1 },
      { key: "attack", label: "Attack", default: 0.01, min: 0.0005, max: 0.5, step: 0.001, unit: "s" },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 2, step: 0.01, unit: "s" },
    ],
    hint: "Reduces dynamic range: quietens peaks that rise above the threshold.",
  },
  {
    kind: "gate",
    label: "Noise gate",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "threshold", label: "Thresh", default: -40, min: -80, max: 0, step: 0.5, unit: "dB" },
      { key: "attack", label: "Attack", default: 0.002, min: 0.0005, max: 0.1, step: 0.0005, unit: "s" },
      { key: "release", label: "Release", default: 0.05, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Mutes the signal when it falls below a threshold (downward expander).",
  },
  // Modulation.
  {
    kind: "chorus",
    label: "Chorus",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "separation", label: "Spread", default: 0.015, min: 0.001, max: 0.05, step: 0.001, unit: "s" },
      { key: "variation", label: "Depth", default: 0.005, min: 0.0005, max: 0.02, step: 0.0005, unit: "s" },
      { key: "rate", label: "Rate", default: 0.5, min: 0.05, max: 8, step: 0.05, unit: "Hz" },
    ],
    hint: "Thickens the signal with several short, modulated delay copies.",
  },
  {
    kind: "flanger",
    label: "Flanger",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "feedback", label: "Feedback", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      { key: "min_delay", label: "Min", default: 0.005, min: 0.0005, max: 0.05, step: 0.0005, unit: "s" },
      { key: "max_delay", label: "Max", default: 0.01, min: 0.001, max: 0.05, step: 0.0005, unit: "s" },
      { key: "rate", label: "Rate", default: 0.1, min: 0.02, max: 5, step: 0.02, unit: "Hz" },
    ],
    hint: "A short, swept delay creating a whooshing comb-filter (jet) effect.",
  },
  {
    kind: "phaser",
    label: "Phaser",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "feedback", label: "Feedback", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      { key: "rate", label: "Rate", default: 0.1, min: 0.02, max: 5, step: 0.02, unit: "Hz" },
    ],
    hint: "A swept all-pass cascade creating a notchy phase (swoosh) effect.",
  },
  // Reverb. fundsp's full reverbs are stereo-only (2 in / 2 out) and cannot compile
  // under the mono net, so only its mono all-pass diffusion element is offered here.
  {
    kind: "schroeder",
    label: "Schroeder",
    category: "reverb",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "coefficient", label: "Coef", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      timeParam(),
    ],
    hint: "An all-pass diffusion element (Schroeder all-pass); stack several to build a reverb.",
  },
  {
    kind: "schroeder_cv",
    label: "Schroeder (cv)",
    category: "reverb",
    inputs: 2,
    outputs: 1,
    params: [timeParam()],
    hint: "Schroeder all-pass with a control-driven coefficient — inputs: audio, coefficient.",
  },
  // Full stereo reverbs (2 in / 2 out): pair with `split`/`join` to fit the mono
  // pipeline. fundsp's high-quality reverbs take a loop-filter node from positional
  // params (its cutoff frequency).
  {
    kind: "reverb_stereo",
    label: "Reverb",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 10, min: 10, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "damping", label: "Damping", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    hint: "Stereo room reverb (32-channel FDN) — inputs: left, right; outputs: left, right.",
  },
  {
    kind: "reverb2_stereo",
    label: "Reverb 2 (hq)",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 10, min: 10, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "diffusion", label: "Diffusion", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "mod_speed", label: "Mod", default: 1, min: 0, max: 2, step: 0.01 },
      { key: "loop_filter", label: "Loop filter", default: 8_000, min: 100, max: 20_000, step: 100, unit: "Hz" },
    ],
    hint: "High-quality stereo reverb with a damped feedback loop — inputs: left, right.",
  },
  {
    kind: "reverb3_stereo",
    label: "Reverb 3",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "diffusion", label: "Diffusion", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "loop_filter", label: "Loop filter", default: 8_000, min: 100, max: 20_000, step: 100, unit: "Hz" },
    ],
    hint: "All-pass-loop stereo reverb — inputs: left, right; outputs: left, right.",
  },
  {
    kind: "reverb4_stereo",
    label: "Reverb 4 (fade)",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 15, min: 15, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
    ],
    hint: "Stereo reverb with a slow fade-in envelope — inputs: left, right.",
  },
  // Control sources (usable in either graph).
  {
    kind: "dc",
    label: "Constant",
    category: "control",
    inputs: 0,
    outputs: 1,
    params: [{ key: "value", label: "Value", default: 1, min: -1, max: 1, step: 0.01 }],
    hint: "A constant value (DC) — used to set control inputs.",
  },
  {
    kind: "sine_lfo",
    label: "Sine LFO",
    category: "control",
    inputs: 0,
    outputs: 1,
    params: [
      { key: "freq", label: "Rate", default: 1, min: 0.05, max: 20, step: 0.05, unit: "Hz" },
      { key: "amp", label: "Amount", default: 1, min: -2, max: 2, step: 0.01 },
      { key: "offset", label: "Offset", default: 0, min: -1, max: 1, step: 0.01 },
    ],
    hint: "A slow sine oscillator for modulating parameters.",
  },
  // Generators (synth graphs).
  {
    kind: "sine",
    label: "Sine",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A pure sine oscillator at the given frequency.",
  },
  {
    kind: "saw",
    label: "Saw",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A band-limited sawtooth oscillator at the given frequency.",
  },
  {
    kind: "square",
    label: "Square",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A band-limited square oscillator at the given frequency.",
  },
  {
    kind: "triangle",
    label: "Triangle",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A triangle oscillator at the given frequency.",
  },
  {
    kind: "organ",
    label: "Organ",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "An additive organ-like tone at the given frequency.",
  },
  {
    kind: "hammond",
    label: "Hammond",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A tone with the drawbar-like harmonics of a Hammond organ.",
  },
  {
    kind: "soft_saw",
    label: "Soft saw",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A sawtooth wave with reduced high-frequency harshness.",
  },
  {
    kind: "pulse",
    label: "Pulse",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440), WIDTH_PARAM],
    synthOnly: true,
    hint: "A rectangular pulse wave with an adjustable width.",
  },
  {
    kind: "poly_saw",
    label: "Poly saw",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A band-limited (PolyBLEP) sawtooth wave.",
  },
  {
    kind: "poly_square",
    label: "Poly square",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440)],
    synthOnly: true,
    hint: "A band-limited (PolyBLEP) square wave.",
  },
  {
    kind: "poly_pulse",
    label: "Poly pulse",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [freqParam(440), WIDTH_PARAM],
    synthOnly: true,
    hint: "A band-limited (PolyBLEP) pulse wave with an adjustable width.",
  },
  {
    kind: "dsf_saw",
    label: "DSF saw",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [
      freqParam(440),
      { key: "roughness", label: "Rough", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    synthOnly: true,
    hint: "Additive sawtooth from a discrete summation formula; roughness sets brightness.",
  },
  {
    kind: "dsf_square",
    label: "DSF square",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [
      freqParam(440),
      { key: "roughness", label: "Rough", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    synthOnly: true,
    hint: "Additive square wave from a discrete summation formula; roughness sets brightness.",
  },
  {
    kind: "pluck",
    label: "Pluck",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [
      freqParam(440),
      { key: "decay", label: "Decay", default: 1, min: 0, max: 8, step: 0.05, unit: "1/s" },
      { key: "damping", label: "Damping", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    synthOnly: true,
    hint: "A plucked-string (Karplus–Strong) tone that decays over time.",
  },
  {
    kind: "white",
    label: "White noise",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [],
    synthOnly: true,
    hint: "Full-bandwidth white noise.",
  },
  {
    kind: "pink",
    label: "Pink noise",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [],
    synthOnly: true,
    hint: "Pink noise (-3 dB/octave).",
  },
  {
    kind: "brown",
    label: "Brown noise",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [],
    synthOnly: true,
    hint: "Brown (red) noise (-6 dB/octave).",
  },
  {
    kind: "mls",
    label: "MLS",
    category: "generator",
    inputs: 0,
    outputs: 1,
    params: [],
    synthOnly: true,
    hint: "A deterministic pseudo-random ±1 maximum-length sequence.",
  },
];

const KIND_BY_ID = new Map(NODE_KINDS.map((def) => [def.kind, def]));

export function nodeKind(kind: string): NodeKindDef | undefined {
  return KIND_BY_ID.get(kind);
}

const CATEGORY_LABELS: Record<string, string> = {
  io: "Graph",
  generator: "Generators",
  mixer: "Routing",
  processor: "Filters",
  filtercv: "Filters (control)",
  dynamics: "Dynamics",
  modulation: "Modulation",
  reverb: "Reverb",
  control: "Control",
};

/** The palette for a graph kind, grouped for display. */
export function paletteFor(graph: GraphKind): { category: string; kinds: NodeKindDef[] }[] {
  const order = ["io", "generator", "mixer", "processor", "filtercv", "dynamics", "modulation", "reverb", "control"];
  return order
    .map((category) => ({
      category: CATEGORY_LABELS[category],
      kinds: NODE_KINDS.filter(
        (def) =>
          def.category === category &&
          (graph === "filter" ? !def.synthOnly : !def.filterOnly),
      ),
    }))
    .filter((group) => group.kinds.length > 0);
}

/** Default parameter values for a kind, keyed by param name. */
export function defaultParams(def: NodeKindDef): Record<string, number> {
  return Object.fromEntries(def.params.map((param) => [param.key, param.default]));
}

/**
 * Minimal structural shape of an editor node/edge, so `toSpec` does not depend on
 * the solid-flow store types (avoids a cycle with `state/graph.ts`).
 */
export interface SpecInputNode {
  id: string;
  data: { kind: string; params: Record<string, number> };
}

export interface SpecInputEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** A handle id as a port index (`"0"`/`"1"` → 0/1; missing → 0). */
export function handlePort(handle: string | null | undefined): number {
  const port = Number(handle);
  return Number.isInteger(port) && port >= 0 ? port : 0;
}

/** Convert editor nodes/edges into the IPC graph spec (positional params). */
export function toSpec(
  nodes: readonly SpecInputNode[],
  edges: readonly SpecInputEdge[],
): GraphSpec {
  return {
    nodes: nodes.map((node) => {
      const def = nodeKind(node.data.kind);
      const params = def
        ? def.params.map((param) => node.data.params[param.key] ?? param.default)
        : [];
      return { id: node.id, kind: node.data.kind, params };
    }),
    edges: edges.map((edge) => ({
      from: edge.source,
      fromPort: handlePort(edge.sourceHandle),
      to: edge.target,
      toPort: handlePort(edge.targetHandle),
    })),
  };
}
