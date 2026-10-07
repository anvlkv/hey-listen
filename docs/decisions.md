# Decisions (ADRs)

## ADR-1 — dockview for the Workbench

**Context:** analyzer tabs need docking/splitting, but only inside the central
region; the Timeline and Sidebar are fixed panes.

**Decision:** use `dockview` (framework-agnostic, zero-dep), mounted **only**
inside the Workbench. Timeline/Sidebar/Workbench are fixed Solid regions, not
dockview panels.

**Consequence:** docking/tab features are limited to the Workbench, which is
exactly the requirement.

## ADR-2 — Binary project file (postcard + raw PCM sections)

**Context:** the project file must be binary, embed raw audio, and perform well
for large audio.

**Decision:** single-file versioned container; structured data via `postcard`,
layout via `serde_json`, bulk PCM as a raw chunked `DATA` section.

**Consequence:** compact + streamable, but the format is hand-specified and must
be versioned carefully (see
[`project-file-format.md`](project-file-format.md)).

## ADR-3 — One window = one project

**Decision:** each Tauri window hosts one independent project; no shared state.

## ADR-4 — PCM over `tauri::ipc::Channel`, not events

**Decision:** ordered, high-throughput audio streams use `Channel`; events are
reserved for status/signals.

## ADR-5 — fundsp for filtering/synthesis, oxiaudio for analysis

**Decision:** keep the audio *net* (filtering, synthesis) in fundsp and the
*analysis* in oxiaudio, to respect each crate's strengths.

## ADR-6 — Shared analysis params in the frontend store

**Decision:** shared params (FFT size, hop/overlap, randomized overlap, window
function, channel, frequency range) live in one Solid store and are sent with
each `run_analysis`, guaranteeing cross-tool sync.

## ADR-7 — Timeline waveform on a 2D canvas; preview via Web Audio

**Context:** the Timeline is a fixed region (not an analyzer tab) that renders
the whole waveform and overlays a draggable analysis window. Dragging a window
handle must audition that region.

**Decision:** render the waveform with the plain 2D canvas API rather than
solid-uplot — the Timeline needs custom range handles, a ruler, and zoom/pan that
would otherwise fight the chart abstraction. Rendering uses a per-source
min/max peak envelope (with a raw-sample fallback when zoomed in). Preview
playback is frontend-only via the Web Audio API, since the decoded PCM is already
in the WebView; Rust has no playback path.

**Consequence:** the Timeline stays independent of the analyzer charting stack
(solid-uplot remains for analyzer tabs in M4+). The full PCM is retained in the
frontend, which is fine for M1 but may need revisiting for very large files /
live capture.
