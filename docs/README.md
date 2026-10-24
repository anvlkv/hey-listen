# Hey Listen — Planning Docs

Index of the design/planning documentation. These docs are the source of truth for
design; [`roadmap.md`](roadmap.md) tracks what is implemented (M0–M11, M14–M19, and the
post-M6 backlog are done). M12–M13 (exports / templates) are **planned** — see
[`exports.md`](exports.md) and [`templates.md`](templates.md); [`notes.md`](notes.md)
(M14) and **M15** (code hygiene — the format/lint/dead-code gate) are delivered.
**M16–M19** (pitch range, the frame-RMS envelope, note segmentation, and the per-note
voice-quality proxies) are delivered; **M20** (AM/FM modulation) is **planned** — see
[`analysis-metrics.md`](analysis-metrics.md). **M21** (MCP/CLI ergonomics: per-result
summaries, compact results, catalog annotations, discovery) is also **planned** — see
[`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

| Doc | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | System architecture, IPC boundary, Rust/TS module layout, data flow, threading |
| [ui-layout.md](ui-layout.md) | The fixed-region + workbench-tabs layout rule and tab behaviors |
| [graph-editor.md](graph-editor.md) | The fundsp graph editor: Net model, node palette, rules, planned coverage |
| [source-model.md](source-model.md) | Audio sources (file / input / synth) and timeline behavior |
| [data-model.md](data-model.md) | Domain entities and their relationships |
| [project-file-format.md](project-file-format.md) | Binary project file byte layout and streaming |
| [analysis-tools.md](analysis-tools.md) | oxiaudio analysis inventory, tool/tab model, shared params |
| [analysis-metrics.md](analysis-metrics.md) | Analysis depth: pitch range, frame RMS, note segmentation (M16–M18), and per-note voice-quality proxies (M19) — all delivered; AM/FM modulation (M20, planned) |
| [mcp-cli-ergonomics.md](mcp-cli-ergonomics.md) | Planned MCP/CLI ergonomics: result summaries, compact previews, tool annotations, analyzer discovery (M21) |
| [theming.md](theming.md) | Exchangeable theme files: the `ThemeFile` model, built-ins + slots, the apply pipeline |
| [exports.md](exports.md) | Analysis exports: the provenance envelope, JSON / CSV (wide matrix), chart-PNG capture |
| [templates.md](templates.md) | Analysis templates: source-less JSON presets (setup + graphs + layout) and window policies |
| [notes.md](notes.md) | Annotations (stored as notes): markdown anchored to a time + chart, the frozen values snapshot, the right rail; the terminology split from M18 note segments |
| [mcp.md](mcp.md) | The MCP server: agent access, the stdio bridge, UI following, tool list |
| [cli.md](cli.md) | The batch CLI (`hey-listen analyze`): analyze files / render synth from a shell, no window |
| [dependencies.md](dependencies.md) | Dependency rationale and licenses |
| [packaging.md](packaging.md) | Release/CI process and the platform build matrix |
| [decisions.md](decisions.md) | Architecture decision records (ADRs) |
| [code-hygiene.md](code-hygiene.md) | The quality gate (the maid): format, lint, file-length budget, duplication, dead code, and the hooks/CI that run it |
| [roadmap.md](roadmap.md) | Phased milestones |
| [testing.md](testing.md) | E2E test plan + test matrix |
