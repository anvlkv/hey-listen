# Roadmap (compact)

The living milestone index: one line per milestone, what it delivered, and where it
stands. The full history — scope, tests, delivery notes — is in
[`../archive/roadmap.md`](../archive/roadmap.md); this file does not repeat it.

**Status:** ✅ delivered · 🚧 in progress · 📝 drafted · 💤 planned. Start a
milestone only when asked, and one at a time.

## Foundations

| Milestone | Status | Delivered |
| --- | --- | --- |
| M0 Shell | ✅ | Tauri shell, fixed regions, Workbench tabs |
| M1 File source + timeline | ✅ | Open a file, waveform timeline, analysis window |
| M2 Live capture | ✅ | Microphone / system / process / mix capture |
| M3 Filtering + synthesis graphs | ✅ | fundsp filter graph and synth source |
| M4 Analysis engine + first tools | ✅ | Off-thread analysis, shared params, first analyzers |
| M5 Full tool inventory + tabs | ✅ | oxiaudio inventory, dockable analyzer tabs |
| M6 Project file | ✅ | Binary `.heyl`: source, setup, results |
| M7 Multi-window + packaging | ✅ | Project windows, popouts, release packaging |
| M8 E2E suite | ✅ | WebdriverIO suite + fixtures; M8.A polish pass |

## Agent and interchange

| Milestone | Status | Delivered |
| --- | --- | --- |
| M9 MCP server | ✅ | Agent access, stdio bridge, UI following |
| M10 Batch CLI | ✅ | `hey-listen analyze`, headless analysis |
| M21 MCP/CLI ergonomics | ✅ | Summaries, compact previews, analyzer discovery (M21.A/B hardening) |
| M33 Reliability + console CLI + self-update | ✅ | Hardening, `hey-listen-cli`, signed updates, menu install (M33.A–D) |
| M39 DOT graph interchange | ✅ | Graphs as DOT text in editors, MCP, and CLI |
| M40 Fundsp coverage + subsystems + snoop | ✅ | Full node coverage, nested systems, live taps |
| M41 Multi-channel outputs + variadic tables | ✅ | Per-channel outputs, channel analysis, table nodes |

## Appearance and evidence

| Milestone | Status | Delivered |
| --- | --- | --- |
| M11 Themes | ✅ | Exchangeable theme files, light/dark slots (M11.A chart polish) |
| M12 Exports | ✅ | Provenance JSON/CSV, chart PNG |
| M14 Annotations | ✅ | Markdown notes anchored to time + chart, frozen values |
| M36 Telling charts | ✅ | Truthful, linked, legible analyzer charts |
| M38 Composite analyzer charts | ✅ | Combined multi-tool charts |

## Analysis depth

| Milestone | Status | Delivered |
| --- | --- | --- |
| M16–M20 Depth I | ✅ | Pitch range, frame RMS, note segments, voice-quality proxies, AM/FM |
| M26–M31 Psychoacoustics | ✅ | Auditory scales, loudness, sharpness, roughness, masking, spatial cues |

## Workflow

| Milestone | Status | Delivered |
| --- | --- | --- |
| M22 Synth Live | ✅ | In-place live source, palette drag |
| M23 Timeline ergonomics | ✅ | Channel lanes, numeric window, context menu, snap |
| M24.A Undo/redo | ✅ | Project-level undo as one core operation |
| M24.B Keyboard control | ✅ | Command registry, palette, shortcut explorer |
| M25 Comparison | ✅ | Cross-project A/B, relative alignment, saved snapshots, headless (M25.A–D) |
| M37 Project migrations | ✅ | Versioned project files that upgrade on open |

## Quality

| Milestone | Status | Delivered |
| --- | --- | --- |
| M15 Code hygiene | ✅ | The maid gate; M15.B typed identifiers |

## Ahead

| Milestone | Status | Next |
| --- | --- | --- |
| M34 Docs + help | 🚧 | Split `docs/` into archive / development / manual; in-app help |
| M35 Landing page + video | 📝 | Site rework and a Remotion workflow video |
| M13 Analysis templates | 💤 | Source-less JSON presets |
