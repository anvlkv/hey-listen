# Graph editor (fundsp)

The filter and synth graphs are built with `solid-flow` in two **Workbench tabs**
(see ADR-10). The frontend owns *editing*; the Rust core owns the *net* — a
`GraphSpec` (JSON) is compiled to a fundsp `Net` in `src-tauri/src/audio/graph/`.

## Canvas gestures

- **Select** — click a node or a connector. Dragging on empty canvas draws a selection
  box over nodes *and* connectors; shift-click extends a selection. Panning is the
  middle/right mouse button, so a left drag never turns into a pan instead of a box.
  A connector's hit band is ~20 px wide, so it is selectable without pixel-hunting.
- **Connect** — drag from a source port to a target port; an occupied input or a cycle
  is refused with a warning.
- **Insert** — dropping a node (from the palette or an existing node) onto a connector
  splices it in (see *Drop to insert*).
- **Layout** — the toolbar's **Layout** button lays every node out left to right with
  `@dagrejs/dagre` (measured node boxes, 24 px separation, 72 px ranks) and then fits
  the canvas to the result.

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
| **Math** | `add`, `subtract`, `multiply`, `divide`, `min`, `max` (2→1); `abs`, `invert` (1→1) |
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

**Math nodes.** `add`/`subtract`/`multiply`/`divide`/`min`/`max` are 2-in/1-out
signal arithmetic (A op B) — `multiply` doubles as a VCA/ring-mod when one input is
a control signal from `dc`/`sine_lfo`; `add` is the arithmetic twin of the routing
`mix`. `abs` rectifies and `invert` flips polarity (both 1-in/1-out). fundsp exposes
its binary math as combinators (`sum`/`product`/`-`) rather than fixed-arity units,
so these are small custom `AudioUnit`s in `audio/graph/` (as with `SumUnit` and the
compressor/gate).

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
  The **Timeline toolbar's Filter switch** bypasses it. The fresh `Input → Output`
  seed is an identity pass-through, so the switch reads **off** until a non-anchor
  node is added; enabling it while the graph is still the seed opens the filter view
  so the user can compose one.
- The core filters a region **when it is loaded**, so `audio/preview.ts` re-issues
  the active preview whenever the filter graph, analysis channel, or output device
  changes — a filter edit is heard immediately, not on the next preview.
- The **synth graph** is rendered to PCM by `render_synth` (48 kHz mono) and becomes
  the project source.

### Live synth (M22)

- **Live** re-renders the synth **source in place** on each settled edit
  (`update_synth_source`, capped at 10 s), preserving the analysis window, timeline zoom,
  annotations, history and open analyzer tabs, so the waveform and analysis follow the
  graph. Playback is the Timeline's transport; the synth tab adds no second play control.
  **Render once** stays for long/one-shot renders, and shares the in-place path when the
  source is already the synth.
- The scheduler debounces ~160 ms and is latest-wins. A failed render keeps the last good
  source and reports inline.
- A compiled net is reused across settles, so a parameter-only edit patches the affected
  node instead of recompiling the graph; a structural edit rebuilds.
- See [`roadmap.md`](roadmap.md) → M22 and ADR-21.

## Palette UX

- **Search** — a search box at the top of the palette filters the nodes by label or
  kind name.
- **Click or drag** — a palette button **click** drops the node onto a free spot on
  the canvas; **dragging** it drops it *where you release*, and onto a **connector**
  it splices the node in (see *Drop to insert* below). The drag is driven with
  **pointer events**, not HTML5 drag-and-drop: Tauri's native file-drop handler
  consumes every drag over the WebView on macOS (so an HTML5 `drop` never fires) and
  shows its file-drop overlay mid-drag — see `src/state/dragdrop.ts`.
- **Drag preview** (M22) — the drag shows a **ghost** of the node under the pointer, a
  translucent **drop preview** at the landing position, and a **splice preview**
  (highlighted connector + *Insert into link* badge) when it would split an edge.
  Outside the canvas or when the drop is invalid it reads as not-allowed. The preview and
  the real drop both resolve through `lib/graphDrop.ts` → `dropTarget`, so what is shown
  is what happens.
- **Anchors are undeletable** — `input` / `output` cannot be deleted
  (`deletable: false`, and the editor's `onDelete` skips them). They seed at the
  left / right edges but are **freely draggable**.
- **Collapsible** — the palette folds to a small header toggle to free canvas space.
- **Hints** — every node kind carries a short, plain-language `hint` (what it does,
  not fundsp jargon) shown as a tooltip on the palette button and the node itself.

## Port labels

Every node shows a **tiny label** beside each input/output handle, so a port's role
is readable at a glance. Multi-port nodes get semantic labels — `mix`/`add` are
*A*/*B*, `split`/`join` and the stereo nodes are *L*/*R*, the `*_cv` filters are
*audio*/*cut*/*Q* (plus *gain*/*morph*), `resonator_cv` is *center*/*bw*, and
`panner` is *audio*/*pan*. Single-port sides fall back to *in*/*out* and unnamed
multi-port sides to *in1*/*in2*/*out1*/*out2*. The labels live in a per-kind map
(`lib/graph/ports.ts` → `PORT_LABELS` + `portLabel`), render outside the handle, and are
`pointer-events: none` so they never interfere with wiring.

## Canvas

- The **zoom controls** sit at the top-right and the **MiniMap** at the bottom-right —
  on both editors (filter *and* synth) — so neither overlaps the top-left palette.

## Drop to insert

Dropping a node **onto a connector** — either a fresh node dragged from the palette
or an existing node dropped onto an edge — **splits that edge and inserts the node**:
the old `source → target` edge is removed and replaced by `source → node` (input 0)
and `node → target` (output 0), preserving the original ports. The node is centred on
the cursor. Insertion only applies to nodes that have **both** an input and an output
(so anchors and pure generators are skipped) and only when both the node's input 0 and
output 0 are free and no cycle would result; otherwise the drop just places the node.
Edge proximity is a distance test against the sampled bezier path (the same control
points solid-flow draws), with a ~26-unit threshold (`lib/graphEdges.ts`).

## Node parameters

Every node card shows its own numeric parameters inline, so a value is edited where it
is read (drag-to-adjust or type; see `graphEditor/ParamField.tsx`). Right-clicking a node
opens a one-item context menu with **Reset node**, which restores every parameter of that
node to its kind's default. There is no separate inspector panel, so the canvas always
keeps its full width; anchors (`input` / `output`) have no parameters and no menu.

The parameter field is shared by every node card, so drag-to-adjust and typing behave
identically everywhere. A parameter's numeric input also keeps the platform's spinner
buttons working: a press in the spinner's gutter steps the value instead of starting the
drag gesture.

## Deferred

Also see [`deferred.md`](deferred.md): click-free rebuild smoothing is **D-24**. The extra
shaping, delay-as-signal and envelope/gate nodes
are delivered (D-17); the remaining families below are still out.

- **`Sequencer`** — it schedules timed `AudioUnit` events (`push`, fades, replay
  mode), which the positional-params node model cannot express; deferred to a future
  event/sequence editor.
- **Expander** — fundsp provides none (as with the compressor/gate it ships nothing);
  the `gate` node is the practical downward expander.
- **Remaining fundsp nodes (D-17 delivered a first group).** The palette covers the
  filter families (and their `*_cv` variants), generators, dynamics, modulation, reverbs,
  **math**, panning, and now **extra shaping** (`clip_to`, `declick`, `dcblock_hz`),
  **delay-as-signal** (`tap`) and **envelope/gate** (`follow`, `afollow`, `hold`) plus the
  `zero`/`impulse` generators. Still not offered, and why: structural combinators
  (`bus`/`branch`/`thru`, `feedback`, `fdn`) that need multi-channel/multi-input arity the
  mono-port model can't express; `adsr_live`, which needs an explicit gate edge; the
  remaining shaping (`shape`, `ramp`, `rossler`/`lorenz`, `fir`/`fir3`, `mls_bits`,
  `oversample`); the dirty/feedback biquads (`dlowpass`/`flowpass`/`dbell`/`fbell`/…); and
  the introspection/plumbing helpers (`monitor`/`meter`, `snoop`, `timer`, `shared`/`var`,
  `convolve`, `resynth`, `playwave`, `resample`). These can still be added incrementally
  as focused nodes (each is a `make_unit` arm plus a palette entry and its arity in
  `kind_arity`).

## Planned

- **Click-free smoothing across net rebuilds** — the current `follow` smoothing
  glides control signals *within* a compiled net, but a structural edit still rebuilds
  and steps; cross-rebuild (crossfade) smoothing is a future item
  ([D-24](deferred.md)). M22's Live path patches a single node's parameters, not a
  filter/net rebuild.
