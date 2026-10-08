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
| **Routing** | `mix` (2→1 sum) |
| **Filters** | `gain`, `lowpass`, `highpass`, `bandpass`, `notch`, `peak`, `moog`, `butterpass`, `dcblock`, `delay`, `limiter` |
| **Control** | `dc`, `sine_lfo` |
| **Generators** (synth) | `sine`, `saw`, `square`, `triangle`, `white`, `pink` |

Parameters are fixed per node (positional `params`); filter cut-offs/Q come from
params (the `*_hz` constructors), so a node has a single audio input. Filter graphs
seed as `Input → Output`; synth graphs seed as `Sine → Output`.

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

## Planned

- **Full fundsp coverage.** The palette is a focused subset today. Expand it to
  cover all of fundsp: every filter family and their **control-input** variants
  (signal + cutoff + Q, fed by `dc`/`lfo`), dynamics, panning/stereo, modulation
  (chorus/flanger/phaser), reverbs, the `Sequencer`, and custom nodes — plus
  per-node inspectors and presets.
- **Timeline filtered overlay** so the filter's effect is visible (see
  [`ui-layout.md`](ui-layout.md)).
- **Stereo graphs** (the net is mono today); parameter smoothing for live edits.
