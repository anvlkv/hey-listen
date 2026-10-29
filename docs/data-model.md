# Data model

Conceptual entities (serde-serializable where they cross IPC or persist).

## Entities

- **Project** — one source + timeline + setup + results. 1:1 with a window.
- **Source** — enum: `File { path }`, `Input { kind, device_id?, target_pid? }`,
  `Synth { graph }`.
- **SourceData** — the PCM backing the timeline (interleaved `f32`, sample rate,
  channels, total frames). Grows for inputs; static for file/synth.
- **Timeline** — whole recording + `AnalysisWindow { start, end }` (frame or
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
- **Comparison** — a **transient** view over two projects (M25): `tool` + owner `A` +
  reference `B`, each side's window/params/options/filter, the two `AnalysisResult`s, a
  `Comparability` (grid signature, time overlap, mismatches, filter difference) and an
  optional `Diff` (per-family delta stats). One view per tool per project, as a
  Workbench tab **or** its popout (`ComparePopout { tool, reference }`, held in the
  window registry for the popout). It is **not** project content: never in `Project`, `SETUP`,
  `RESULTS`, `LAYOUT`, `NOTES` or `LAYOUT.popouts`, never saved, never undoable. See
  [`comparison.md`](comparison.md).
- **AnalysisResult** — cached output of a tool over a window (typed payload +
  the params/window it was computed for). Every time it carries is in **source
  seconds**: the tools run on the window's slice, and the engine re-bases the result
  onto the source timeline before it leaves (`windowStart` records the origin), so
  the payload, the charts, a note's `timeSecs`, and an export all agree. See
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
- **Annotation** (stored as `Note`) — user-authored commentary on the project: an audio
  **time** anchor (`timeSecs`) with an optional `range`, an optional **analyzer tool id**
  it was taken from (absent = a Timeline annotation), a markdown `body`, and a **frozen**
  `values` snapshot (the chart's readout at that time, with its `window` / `params` /
  `options` provenance). The annotation's heading is the **first line of the body**; the
  model's optional `title` field is retained but no longer set or shown. Stored in the
  project file's `NOTES` section. See [`notes.md`](notes.md) → Terminology.
- **Note segment** (not persisted) — a detected run of audio above an amplitude gate,
  returned by the `noteMetrics` analyzer: start/end, duration, the gaps around it, RMS /
  peak level, a normalized envelope, and the M19 voice-quality **proxies** (voiced
  fraction, median f0, jitter in cents, shimmer in dB, and the 0–1 autocorrelation
  periodicity used as the HNR proxy). It is analysis output, not project content.

> **Planned / delivered.** `ThemeFile` shipped in M11 (see [`theming.md`](theming.md))
> and `Note` in M14 (see [`notes.md`](notes.md)); the export envelope shipped in M12
> (see [`exports.md`](exports.md)); `AnalysisTemplate` (M13) is still planned. The
> export envelope is a view over an existing `AnalysisResult`. `Comparison` is M25
> (planned) and is deliberately **not**
> serialized into a project. See [`exports.md`](exports.md), [`templates.md`](templates.md),
> [`comparison.md`](comparison.md).
> The M16–M20 analysis-depth results carry `FrameRms` (delivered in M17),
> `NoteMetricsResult` (delivered in M18–M19), and `ModulationResult` (delivered in M20)
> — see [`analysis-metrics.md`](analysis-metrics.md).
> M21 delivered the `ResultSummary` (a `text` line plus labelled, unit-bearing items) and
> the `AnalysisResponse` envelope carrying both `result` and `summary` — see
> [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

## Sketch (Rust)

```rust
enum Source {
    File { path: String },
    Input { kind: SourceKind, device_id: Option<String>, target_pid: Option<u32> },
    Synth { graph: GraphSpec },
}

// A fundsp editor graph (see `src-tauri/src/audio/graph/`).
struct GraphSpec { nodes: Vec<GraphNode>, edges: Vec<GraphEdge> }
struct GraphNode { id: String, kind: String, params: Vec<f32> }
struct GraphEdge { from: String, from_port: usize, to: String, to_port: usize }

struct AnalysisWindow { start_secs: f64, end_secs: f64 }

// Transient (M25): the core computes both sides; nothing here is persisted.
struct Comparison {
    tool: String,
    a: CompareSide,                  // project label + window/params/options + result
    b: CompareSide,
    comparability: Comparability,    // aligned, overlap, mismatches, filters_differ
    diff: Option<Diff>,              // per-family stats; arrays only when requested
}

struct CompareSide {
    label: String,                   // window label / display name
    window: AnalysisWindow,
    params: SharedParams,
    options: ToolOptions,
    result: AnalysisResult,
}

struct SharedParams {
    // frame analysis
    fft_size: usize,             // 512..8192
    hop: f64,                    // fraction of fft_size, or frames
    randomized_overlap: bool,
    window_fn: WindowFn,         // Hann / Hamming / Blackman / rectangular

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
}

struct Project {
    version: u32,
    source: Source,
    setup: AnalysisSetup,
    results: Vec<AnalysisResult>,
    notes: Vec<Note>,
    // SourceData is stored separately in the binary file's DATA section
}

// An annotation (M14; stored as `Note`): a time anchor (+ optional span) tied to an
// analyzer chart, with a markdown body and a frozen snapshot of that chart's values.
struct Note {
    id: String,                      // stable id (uuid)
    created_ms: u64,
    updated_ms: u64,
    time_secs: f64,                  // the anchor instant (source seconds)
    range: Option<AnalysisWindow>,   // optional span; None = a point
    tool: Option<String>,            // analyzer id; None = a Timeline note
    title: Option<String>,           // optional plain-text title
    body: String,                    // markdown
    values: Option<NoteValues>,      // frozen chart snapshot
}

struct NoteValues {
    tool: String,
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

> **Serialized `Source` (M6).** On the wire and on disk, `Source` is stored as a
> `kind`-tagged **struct** (`SourceDescriptor` in `src-tauri/src/project/sections.rs`),
> not a Serde enum: `postcard` cannot encode internally-tagged enums. It carries
> `kind` (`file` / `mic` / `system` / `process` / `mix` / `synth`) plus the
> kind-specific fields (`path`, `deviceId`, `mixMicDeviceId`, `mixSystemDeviceId`,
> `targetPid`, `gain`, `graph`), all optional. The audio itself is embedded in the
> `DATA` section, so the descriptor is provenance for the picker (and, for synth,
> the rendered graph).
