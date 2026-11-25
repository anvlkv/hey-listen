# Roadmap

Every milestone in the order it was built, one line each. ✅ is delivered; `(planned)`
and `(drafted)` are still ahead. The detailed scope, tests and delivery notes for a
delivered milestone are archived; this file is the index.

## M0 — Shell ✅
The window: fixed regions and Workbench tabs.

## M1 — File source + timeline ✅
Open audio, draw the waveform, pick an analysis window.

## M2 — Live capture ✅
Microphone, system output, a single process, or a mix.

## M3 — Filtering + synthesis graphs ✅
A fundsp filter graph and a synth source, built visually.

## M4 — Analysis engine + first tools ✅
Off-thread analysis with shared parameters.

## M5 — Full tool inventory + tabs ✅
Every oxiaudio analyzer as a dockable Workbench tab.

## M6 — Project file ✅
One binary `.heyl` holding the source, setup and results.

## M7 — Multi-window + polish + packaging ✅
Project windows, popouts, signed release builds.

## M8 — E2E test suite ✅
A WebdriverIO suite over deterministic fixtures.

## M8.A — Improvements iteration ✅
First round of suite and UX fixes.

## M9 — MCP server (agent access + UI following) ✅
An agent drives the live window through a stdio bridge.

## M10 — Batch CLI (`hey-listen analyze`) ✅
Bulk, headless analysis from a shell.

## M11 — Exchangeable themes ✅
Theme files with independent light and dark slots.

## M11.A — Chart polish ✅
Charts follow the active theme.

## M12 — Analysis exports: chart image + data ✅
Provenance JSON and CSV, plus a chart PNG.

## M13 — Analysis templates (planned)
Source-less JSON presets of setup, graphs and layout.

## M14 — Annotations ✅
Markdown notes frozen to a time and a chart's values.

## M15 — Code hygiene ✅
The maid: format, lint, size, duplication, dead code.

## M15.B — String identifiers become strum enums ✅
Typed ids at every boundary.

## M16 — Pitch range + analyzer option integrity ✅
Per-tool pitch bounds; an unknown option key fails.

## M17 — Frame-RMS amplitude envelope ✅
Short-term level, without pretending to be loudness.

## M18 — Note segmentation, gaps, and per-note level ✅
Musical notes and gaps from gated audio.

## M19 — Note voice-quality proxies ✅
Jitter, shimmer and periodicity, labelled as proxies.

## M20 — AM/FM modulation spectra ✅
Modulation rate and depth, for the window or per note.

## M21 — MCP + CLI analysis ergonomics (cross-cutting) ✅
Summaries, compact previews, analyzer discovery.

## M21.A — MCP/CLI agent hardening (cross-cutting) ✅
Stricter inputs and clearer failures for agents.

## M21.B — Measurement reliability + scale ergonomics ✅
Honest scales and steadier results.

## M22 — Synth workflow: in-place Live source ✅
Edits update the source without losing your place.

## M23 — Timeline ergonomics + comparison rework ✅
Channel lanes, numeric window, context menu, snap.

## M24.A — Undo/redo as a core project operation ✅
One edit, one step.

## M24.B — Keyboard control ✅
Command registry, palette, rebindable shortcuts.

## M25 — Cross-project comparison ✅
The same analyzer on two projects, overlaid with a delta.

## M25.A — Comparison views: heatmaps, events, modulation ✅
A / B / Δ for every result family.

## M25.B — Relative-time compare alignment ✅
Compare windows of different lengths fairly.

## M25.C — Saved comparisons ✅
Reopen a comparison without the reference project.

## M25.D — Project navigation + headless comparisons ✅
Move between projects; compare from a script.

## M26 — Auditory scales + critical-band energy ✅
Energy on a perceptual scale.

## M27 — Loudness (sone/phon) + specific-loudness map ✅
Modelled loudness in sones and phons.

## M28 — Perceived sharpness ✅
How much high-frequency content dominates.

## M29 — Roughness + fluctuation strength ✅
Fast and slow modulation of sensation.

## M30 — Tonality, masking, and audibility ✅
What is audible, and what is hidden.

## M31 — Equal-loudness contour overlay + spatial (stereo) cues ✅
Contours on a spectrum; left/right cues.

## M32 — Automated Lighthouse audit ✅
A scripted quality baseline across the UI.

## M32.A — Consequent improvement pass ✅
Acting on the audit's findings.

## M33 — Reliability, a console CLI, and self-update ✅
Hardening, `hey-listen-cli`, signed updates.

## M34 — Improved documentation and help
Archive / development / manual split; in-app help next.

## M35 — Landing page rework + Remotion workflow video (drafted)
A new site and a short workflow film.

## M36 — Informative, telling charts ✅
Charts that are truthful, linked and legible.

## M37 — Project file migrations ✅
Versioned files that upgrade on open.

## M38 — Composite analyzer charts ✅
Several tools on one chart.

## M39 — DOT notation for filter/synth graphs ✅
Graphs as text across the app, MCP and the CLI.

## M40 — Complete fundsp coverage, subsystems and snoop ✅
Every node, nested systems, live taps.

## M41 — Multi-channel outputs and variadic tables ✅
Per-channel graph outputs and table nodes.

## M42 — Source storage: embedded, linked, live link ✅
Where the audio lives; saved references carry their own audio and re-grid (D-23).

## M43 — Audio import/export (drafted)
Sources move into the Sidebar; the analysis window exports as audio.
