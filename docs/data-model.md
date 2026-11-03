# Data model

Conceptual entities (serde-serializable where they cross IPC or persist).

## Entities

- **Project** — one source + timeline + setup + results. 1:1 with a window.
- **Source** — the project's single audio source, persisted as a `SourceDescriptor`
  (`kind: SourceKind` plus the optional kind-specific fields); see the sketch below.
- **SourceData** — the PCM backing the timeline (interleaved `f32`, sample rate,
  channels, total frames). Grows for inputs; static for file/synth.
- **Timeline** — whole recording + `AnalysisWindow { startSecs, endSecs }` (source
  seconds) + zoom state.
- **GraphSpec** — a fundsp editor graph (`nodes` + `edges`, with positional
  params), built in a Workbench graph tab (`filter` or `synth`) and compiled to a
  fundsp `Net` in the Rust core. The project's **filter graph** and a synth
  source's graph are both `GraphSpec`s. It mirrors fundsp's `Net`: nodes are
  pushed, each input takes **exactly one** connection, and explicit `input`
  (filter graphs) / `output` anchor nodes bridge the graph to the net's global
  input/output (there is no implicit summing).
- **AnalysisSetup** — open tools/tabs + per-tool config + shared params +
  layout (dockview JSON + solid-flow node positions).
- **AnalyzerTool** — an analysis capability (see
  [`analysis-tools.md`](analysis-tools.md)), identified by a stable id (e.g.
  `spectrogram`, `fft`, `loudness`).
- **Comparison** — a view over two project sides (M25): `tool` + owner `A` + reference
  `B`, each side's window/params/options/filter, the two `AnalysisResult`s, a
  `Comparability` (grid signature, **relative alignment** + measured extents, the
  informational absolute overlap, mismatches, filter difference) and an optional `Diff`
  (per-family delta stats). The reference is either a **live** project window or the
  owner's **saved snapshot** (M25.C). One view per tool per project, as a Workbench tab
  **or** its popout (`ComparePopout { tool, reference }`, held in the window registry for
  the popout). Since M25.C the reference side is saved as a `SavedComparison` in the
  project's `COMPARE` section (no reference audio); the panel itself still stays out of
  `LAYOUT`, and comparisons stay out of undo/redo. See [`comparison.md`](comparison.md).
- **SavedComparison** — the reference side of one comparison, frozen: tool, reference
  display name, source shape, window, shared params, effective options, filter
  fingerprint, `bOffset`, `savedMs`, and the reference's full `AnalysisResult`. Written
  for each comparison open at save time; restored as a Workbench tab and used until an
  explicit reconnect. See [`project-file-format.md`](project-file-format.md).
- **AnalyzerId / ToolId / SourceKind / WindowKind** — the typed string identifiers
  (ADR-28, M15.B). `AnalyzerId` names every analyzer, `ToolId` adds the `filter` /
  `synth` graph tabs, `SourceKind` every source kind, and `WindowKind` the window
  function. Each serializes as its original wire string (camelCase ids; lowercase
  single-word ids), so the wire format is unchanged; Rust consumers work on the enum.
- **AnalysisResult** — cached output of a tool over a window (typed payload +
  the params/window it was computed for). Every time it carries is in **source
  seconds**: the tools run on the window's slice, and the engine re-bases the result
  onto the source timeline before it leaves (`windowStart` records the origin), so
  the payload, the charts, an annotation's `timeSecs`, and an export all agree. See
  [`analysis-tools.md`](analysis-tools.md) → Chart rendering.
- **SharedParams** — analysis params synced across tools (FFT size, hop/overlap, window function, channel, frequency range, …).
- **ToolOptions** — per-tool params that are *not* shared (band/coefficient counts,
  YIN threshold, f0 range, bar length, momentary window, …); they ride along with
  every `run_analysis` call and fall back to per-tool defaults when absent. Keys are
  canonical **camelCase**; snake_case aliases are accepted when reading a request, and
  an unknown key is rejected (M16). Chart-display toggles are not engine options and
  never cross IPC.
- **LayoutState** — `dockview` `api.toJSON()` + solid-flow graph positions.
- **ThemeFile** — an installable palette: a declared `base` (`dark` / `light`) plus
  partial `ui` (CSS custom properties) / `chart` / `colormap` / `flow` overlays. The
  built-ins (`builtin:dark` / `builtin:light`, plus bundled **Retrowave Neon**,
  **Nord**, **Solarized Dark / Light**) are full themes; the preference is a
  **mode + two slots**. Stored as JSON (`.heyltheme`) under the app config dir.
- **AnalysisTemplate** — a named, **source-less** preset: an `AnalysisSetup` + optional
  filter / synth `GraphSpec`s + an optional layout + a **window / view policy**
  (`fractional` / `absolute` / `full` / `fixedLength`). Stored as JSON
  (`.heyltemplate`), not the binary project container.
- **Annotation** — user-authored commentary on the project: an audio
  **time** anchor (`timeSecs`) with an optional `range`, an optional **analyzer tool id**
  it was taken from (absent = a Timeline annotation), a markdown `body`, and a **frozen**
  `values` snapshot (the chart's readout at that time, with its `window` / `params` /
  `options` provenance). The annotation's heading is the **first line of the body**; the
  model's optional `title` field is retained but no longer set or shown. Stored in the
  project file's `ANNOTATIONS` section. See [`annotations.md`](annotations.md) → Terminology.
- **Note segment** (not persisted) — a detected run of audio above an amplitude gate,
  returned by the `noteMetrics` analyzer: start/end, duration, the gaps around it, RMS /
  peak level, a normalized envelope, and the M19 voice-quality **proxies** (voiced
  fraction, median f0, jitter in cents, shimmer in dB, and the 0–1 autocorrelation
  periodicity used as the HNR proxy). It is analysis output, not project content.

> **Planned / delivered.** `ThemeFile` shipped in M11 (see [`theming.md`](theming.md))
> and `Annotation` in M14 (see [`annotations.md`](annotations.md)); the export envelope shipped in M12
> (see [`exports.md`](exports.md)); `AnalysisTemplate` (M13) is still planned. The
> export envelope is a view over an existing `AnalysisResult`. `Comparison` shipped in
> M25 as a transient view; **M25.C** saves the reference side as a `SavedComparison`
> (not the whole comparison), so the diff can be reproduced without the other project.
> See [`exports.md`](exports.md), [`templates.md`](templates.md),
> [`comparison.md`](comparison.md).
> The M16–M20 analysis-depth results carry `FrameRms` (delivered in M17),
> `NoteMetricsResult` (delivered in M18–M19), and `ModulationResult` (delivered in M20)
> — see [`analysis-metrics.md`](analysis-metrics.md).
> M21 delivered the `ResultSummary` (a `text` line plus labelled, unit-bearing items) and
> the `AnalysisResponse` envelope carrying both `result` and `summary` — see
> [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

## Sketch (Rust)

```rust
// On the wire and on disk the source is a kind-tagged **struct** (`postcard` cannot
// encode internally-tagged enums): `SourceKind` names file / mic / system / process /
// mix / synth, and the kind-specific fields are optional.
struct SourceDescriptor {
    kind: SourceKind,
    path: Option<String>,
    device_id: Option<String>,
    mix_mic_device_id: Option<String>,
    mix_system_device_id: Option<String>,
    target_pid: Option<u32>,
    gain: f32,
    graph: Option<GraphSpec>,
}

// A fundsp editor graph (see `src-tauri/src/audio/graph/`).
struct GraphSpec { nodes: Vec<GraphNode>, edges: Vec<GraphEdge> }
struct GraphNode { id: String, kind: String, params: Vec<f32> }
struct GraphEdge { from: String, from_port: usize, to: String, to_port: usize }

struct AnalysisWindow { start_secs: f64, end_secs: f64 }

// M25: the core computes both sides. The reference may be live or saved (M25.C).
struct Comparison {
    tool: AnalyzerId,
    a: ComparisonSide,
    b: ComparisonSide,
    comparability: Comparability,    // aligned, alignment, overlap (informational),
                                     // mismatches, filters_differ
    diff: Option<ComparisonDiff>,    // per-family stats; arrays only when requested
}

struct ComparisonSide {
    project: Option<String>,         // display name (window labels are session-scoped)
    source: Option<SourceShape>,
    setup: CompareSetup,             // start/end + SharedParams + ToolOptions
    options: Map<String, Value>,     // the **effective** options
    summary: ResultSummary,
    result: AnalysisResult,
}

// Project content since M25.C: the reference side as it was last compared.
struct SavedComparison {
    tool: AnalyzerId,
    reference_name: String,          // display name (labels are session-scoped)
    source: SourceShape,
    window: AnalysisWindow,
    params: SharedParams,
    options: ToolOptions,
    filter_fingerprint: Option<String>,
    b_offset: f64,                   // fine-tune offset, seconds (M25.B)
    saved_ms: u64,
    result: AnalysisResult,
}

struct SharedParams {
    // frame analysis
    fft_size: usize,             // 512..8192
    hop: f64,                    // fraction of fft_size (0.25 = 75% overlap)
    randomized_overlap: bool,
    window_fn: WindowKind,       // Hann / Hamming / Blackman / rectangular

    // signal conditioning
    channel: Option<usize>,      // None = downmix (mono); Some(n) = 0-based channel
    resample_to: Option<u32>,    // optional analysis sample rate

    // spectral range
    freq_min_hz: f64,
    freq_max_hz: f64,
}

// Per-tool options, sent with every `run_analysis` call next to `SharedParams`.
// Every field is optional; absent fields use the tool's defaults. Keys are camelCase;
// snake_case aliases are accepted when reading, and unknown keys are rejected (M16).
struct ToolOptions {
    n_mels: Option<usize>,
    n_mfcc: Option<usize>,
    n_bands: Option<usize>,
    rolloff_percent: Option<f32>,
    yin_threshold: Option<f32>,
    min_f0_hz: Option<f32>,
    max_f0_hz: Option<f32>,
    bar_length: Option<usize>,
    window_ms: Option<u32>,
    f_min_hz: Option<f32>,
    f_max_hz: Option<f32>,
    // M17–M21: envelope / segmentation / modulation + the M21.B gate
    frame_ms: Option<f32>,
    hop_ms: Option<f32>,
    gate_db: Option<f32>,
    gate_floor_db: Option<f32>,
    hysteresis_db: Option<f32>,
    min_note_ms: Option<f32>,
    min_gap_ms: Option<f32>,
    syllable_gap_ms: Option<f32>,
    envelope_points: Option<usize>,
    pitch_frame_ms: Option<f32>,
    pitch_hop_ms: Option<f32>,
    mod_min_hz: Option<f32>,
    mod_max_hz: Option<f32>,
    detrend: Option<usize>,
    min_voiced_secs: Option<f32>,
    top_peaks: Option<usize>,
}

// The save command's payload is `SaveProject` and the loader returns `LoadedProject`;
// the audio itself is the binary file's `DATA` section, not a struct field.
struct SaveProject<'a> {
    name: String,
    created_ms: Option<u64>,
    source: Option<SourceDescriptor>,
    setup: AnalysisSetup,
    layout: serde_json::Value,
    results: Vec<AnalysisResult>,
    annotations: Vec<Annotation>,
    compare: Vec<SavedComparison>,
    pcm: Option<&'a SourceData>,
}

// An annotation (M14; stored as `Annotation`): a time anchor (+ optional span) tied to an
// analyzer chart, with a markdown body and a frozen snapshot of that chart's values.
struct Annotation {
    id: String,                      // stable id (uuid)
    created_ms: u64,
    updated_ms: u64,
    time_secs: f64,                  // the anchor instant (source seconds)
    range: Option<AnalysisWindow>,   // optional span; None = a point
    tool: Option<AnalyzerId>,        // analyzer id; None = a Timeline annotation
    title: Option<String>,           // optional plain-text title
    body: String,                    // markdown
    values: Option<AnnotationValues>,      // frozen chart snapshot
}

struct AnnotationValues {
    tool: AnalyzerId,
    label: String,                   // e.g. "Spectrum @ 2.34 s"
    text: String,                    // the compact values line (the subtitle)
    window: AnalysisWindow,
    params: SharedParams,
    options: BTreeMap<String, f64>,
    captured_ms: u64,
}

// A theme file (.heyltheme): a partial overlay on a built-in `base`.
struct ThemeFile {
    kind: String,               // "hey-listen.theme"
    format_version: u32,
    meta: ThemeMeta,            // id, name, description, base: "dark" | "light"
    ui: BTreeMap<String, String>,       // CSS custom properties (partial)
    chart: BTreeMap<String, serde_json::Value>, // partial ChartTheme
    colormap: Option<ColormapStops>,
    flow: BTreeMap<String, String>,     // optional --xy-* overrides
}

// A template file (.heyltemplate): a source-less preset.
struct AnalysisTemplate {
    kind: String,               // "hey-listen.template"
    format_version: u32,
    meta: TemplateMeta,         // id, name, description, created_ms, app_version
    setup: AnalysisSetup,       // reused from the project file
    window_policy: WindowPolicy,
    window: AnalysisWindow,
    view_policy: ViewPolicy,
    filter_graph: Option<GraphSpec>,
    synth_graph: Option<GraphSpec>,
    layout: Option<serde_json::Value>,
}
```

See [`project-file-format.md`](project-file-format.md) for how these map to
on-disk sections.

> **Serialized source (M6).** `SourceDescriptor` is a `kind`-tagged **struct**, not a
> Serde enum: `postcard` cannot encode internally-tagged enums. The audio itself is
> embedded in the `DATA` section, so the descriptor is provenance for the picker (and,
> for synth, the rendered graph). See `src-tauri/src/project/sections.rs`.
