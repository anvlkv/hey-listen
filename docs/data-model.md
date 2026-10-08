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
    channel: ChannelSelect,      // Downmix (mono) | Channel(n) — 0-based
    resample_to: Option<u32>,    // optional analysis sample rate

    // spectral range
    freq_min_hz: f64,
    freq_max_hz: f64,
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
