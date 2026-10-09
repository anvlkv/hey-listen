# Graph editor (fundsp)

The filter and synth graphs are built with `solid-flow` in two **Workbench tabs**
(see ADR-10). The frontend owns *editing*; the Rust core owns the *net* — a
`GraphSpec` (JSON) is compiled to a fundsp `Net` in `src-tauri/src/audio/graph.rs`.

## The model mirrors fundsp `Net`

Compilation is a literal **push + connect**:

1. `Net::new(inputs, 1)` — one mono output, and one global input for filter graphs.
2. `net.push(unit)` for every node.
3. `net.connect(src, src_port, dst, dst_port)` for every edge — **each input takes
   exactly one source**.
4. The `input` / `output` anchors are bridged to the net's global input/output.

There is **no implicit summing**: only what is wired to `Output` is the graph's
result. (The previous "sum every terminal node" behaviour was removed — it silently
mixed in dangling/unwired paths.)

## Node palette (current)

| Group | Nodes |
| --- | --- |
| **Graph** | `input` (filter only), `output` |
| **Generators** (synth) | `sine`, `saw`, `square`, `triangle`, `organ`, `hammond`, `soft_saw`, `pulse`, `poly_saw`, `poly_square`, `poly_pulse`, `dsf_saw`, `dsf_square`, `pluck`, `white`, `pink`, `brown`, `mls` |
| **Routing** | `mix` (2→1 sum), `split` (1→2), `join` (2→1) |
| **Filters** | `gain`, `lowpass`, `highpass`, `bandpass`, `notch`, `peak`, `allpass`, `bell`, `lowshelf`, `highshelf`, `moog`, `butterpass`, `lowpole`, `highpole`, `lowrez`, `bandrez`, `resonator`, `morph`, `pinkpass`, `allpole_delay`, `biquad`, `dcblock`, `delay`, `pan` (1→2), `panner` (2→2), `rotate` (2→2) |
| **Filters (control)** | `lowpass_cv`, `highpass_cv`, `bandpass_cv`, `notch_cv`, `peak_cv`, `allpass_cv`, `bell_cv`, `lowshelf_cv`, `highshelf_cv`, `moog_cv`, `lowrez_cv`, `bandrez_cv`, `resonator_cv`, `morph_cv`, `butterpass_cv`, `lowpole_cv`, `highpole_cv`, `allpole_cv` |
| **Dynamics** | `limiter`, `compressor`, `gate`, `limiter_stereo` (2→2) |
| **Modulation** | `chorus`, `flanger`, `phaser` |
| **Reverb** | `schroeder`, `schroeder_cv`, `reverb_stereo`, `reverb2_stereo`, `reverb3_stereo`, `reverb4_stereo` (all 2→2) |
| **Control** | `dc`, `sine_lfo` |

**Fixed-parameter nodes** read their cut-off/Q/gain from positional `params` (the
`*_hz` constructors), so they have a single audio input. **Control-input variants**
(`*_cv`) instead take the cut-off and/or Q from extra inputs fed by `dc`/`sine_lfo`:
their visible `inputs` and the core's `kind_arity` match the fundsp constructor's
arity (e.g. `lowpass_cv` is *audio, cutoff, Q*; `bell_cv` adds a *gain* input;
`resonator_cv` is *audio, center, bandwidth*). Input 0 is always the audio; later
inputs are control signals. `compressor`/`gate` are built from fundsp's primitives
(level follower + gain map) because fundsp ships neither. Filter graphs seed as
`Input → Output`; synth graphs seed as `Sine → Output`.

**Stereo nodes.** The compiled net's global I/O is still mono (filter: 1 in / 1
out; synth: 0 in / 1 out), but nodes may be **stereo internally** (`1→2`, `2→2`,
`2→1`) — wire `Input → split → stereo FX → join → Output` and the graph still
resolves to one channel. Because the net's output is mono, `join` (or wiring a
single channel) back before `Output`; a floating stereo channel is simply not
heard. `reverb2_stereo` and `reverb3_stereo` take their loop filter as a positional
cutoff (`lowpole_hz`) and `panner`'s pan is a control input (its second port).

**Parameter smoothing.** Control-rate inputs — every `*_cv` cut-off/Q/gain/… input
and `panner`'s pan — are wrapped in fundsp's one-pole `follow` smoother, so live
control signals (e.g. from `sine_lfo`) glide instead of stepping. (Full click-free
smoothing across a net *rebuild* is out of scope.)

## Rules (enforced in the UI *and* the core)

- **Exactly one `input`** (filter graphs) and **exactly one `output`**.
- **One source per input** — a second edge into an occupied input is rejected
  (`GraphError::InputConflict`); the UI blocks it and warns.
- **No cycles** (`GraphError::Cycle`), no self-links.
- Unknown kinds are rejected (`GraphError::UnknownKind`).

## Application

- The **filter graph** is installed via `set_filter_graph` (debounced) and applied
  to the (channel-selected, mono) signal **before preview** and, from M4, analysis.
  The Toolbar **Filter** switch bypasses it.
- The core filters a region **when it is loaded**, so `audio/preview.ts` re-issues
  the active preview whenever the filter graph, analysis channel, or output device
  changes — a filter edit is heard immediately, not on the next preview.
- The **synth graph** is rendered to PCM by `render_synth` (48 kHz mono) and becomes
  the project source.

## Palette UX

- **Search** — a search box at the top of the palette filters the nodes by label or
  kind name.
- **Anchors are undeletable** — `input` / `output` cannot be deleted
  (`deletable: false`, and the editor's `onDelete` skips them). They seed at the
  left / right edges but are **freely draggable**.
- **Collapsible** — the palette folds to a small header toggle to free canvas space.
- **Hints** — every node kind carries a short, plain-language `hint` (what it does,
  not fundsp jargon) shown as a tooltip on the palette button and the node itself.

## Canvas

- The **zoom controls** sit at the top-right and the **MiniMap** at the bottom-right —
  on both editors (filter *and* synth) — so neither overlaps the top-left palette.

## Deferred

- **`Sequencer`** — it schedules timed `AudioUnit` events (`push`, fades, replay
  mode), which the positional-params node model cannot express; deferred to a future
  event/sequence editor.
- **Expander** — fundsp provides none (as with the compressor/gate it ships nothing);
  the `gate` node is the practical downward expander.

## Planned

- **Click-free smoothing across net rebuilds** — the current `follow` smoothing
  glides control signals *within* a compiled net, but a filter edit still rebuilds
  and steps; cross-rebuild (crossfade) smoothing is a future item.
- **Per-node inspectors and presets** (a richer alternative to inline positional
  params).
