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
- **AnalysisResult** — cached output of a tool over a window (typed payload +
  the params/window it was computed for).
- **SharedParams** — analysis params synced across tools (FFT size, hop/overlap, window function, channel, frequency range, …).
- **ToolOptions** — per-tool params that are *not* shared (band/coefficient counts,
  YIN threshold, f0 range, bar length, momentary window, …); they ride along with
  every `run_analysis` call and fall back to per-tool defaults when absent.
- **LayoutState** — `dockview` `api.toJSON()` + solid-flow graph positions.

## Sketch (Rust)

```rust
enum Source {
    File { path: String },
    Input { kind: SourceKind, device_id: Option<String>, target_pid: Option<u32> },
    Synth { graph: GraphSpec },
}

// A fundsp editor graph (see `src-tauri/src/audio/graph.rs`).
struct GraphSpec { nodes: Vec<GraphNode>, edges: Vec<GraphEdge> }
struct GraphNode { id: String, kind: String, params: Vec<f32> }
struct GraphEdge { from: String, from_port: usize, to: String, to_port: usize }

struct AnalysisWindow { start_secs: f64, end_secs: f64 }

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
// Every field is optional; absent fields use the tool's defaults.
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
    // SourceData is stored separately in the binary file's DATA section
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
