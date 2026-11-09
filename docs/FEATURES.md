# Features and workflows

A user-facing map of Hey Listen, including work that has not shipped. **Available** means the [roadmap](roadmap.md) marks it delivered; **Planned** is a defined future milestone; **Proposed** needs confirmation; **Drafted** is an outline, not a commitment. This is not an implementation checklist. For the canonical analyzer inventory, see [Analysis tools](analysis-tools.md); for exact milestone status, see the [roadmap](roadmap.md).

## Start with sound — available

- **Open a recording.** Load an audio file from a picker, drag-and-drop, or the operating system; replace it when you want to examine something else. One project window has one source, so replacement resets its timeline. [Source model](source-model.md)
- **Capture a live source.** Record a microphone, system output, a selected process, or a microphone-and-system mix. Monitor before recording, choose gain, and use delayed or timed capture, pause, resume, and stop. [Source model](source-model.md)
- **Make a sound.** Build a synth graph and render it as the project's source. Rendering a different source replaces the timeline. [Graph editor](graph-editor.md)
- **Work in several projects.** Open independent project windows, switch to previous/next projects, and use recent projects or OS file association to reopen a `.heyl` file. A popped-out tool is a view of its parent project, not another project. [UI layout](ui-layout.md) · [Comparison](comparison.md)
- **Save the session.** Reopen a `.heyl` project with its source, graphs, settings, analysis window, annotations, Workbench layout, and saved comparisons. File audio can be embedded or referenced; source changes and unsaved work are guarded. [Project file](project-file-format.md)

## Listen and navigate — available

- **Frame the question.** Inspect the waveform, set or move an analysis window, zoom and pan the Timeline, and fit the view or window. Analyzers run on that window, not necessarily the whole recording. [Source model](source-model.md) · [UI layout](ui-layout.md)
- **Preview a region.** Loop or stop playback, choose a playback device and gain, watch the output meter and shared playhead, and vary playback speed from 0.25× to 4×. Varispeed changes what you hear, not the analysis. [Annotations](annotations.md) · [UI layout](ui-layout.md)
- **Choose a channel.** Inspect or analyze a specific channel or a mono downmix of multichannel audio. [Analysis tools](analysis-tools.md)

## Shape sound — available

- **Filter before measuring.** Wire a filter graph, bypass or enable it, hear the result in preview, and compare the processed waveform with the original. The active filter feeds every analyzer. [Graph editor](graph-editor.md) · [Analysis tools](analysis-tools.md)
- **Build graphs visually.** Search the node palette, place nodes by click or drag, insert them on a connection, wire labeled ports, adjust parameters, zoom, and use the minimap. The palette covers generators, routing, math, filters, dynamics, modulation, reverb, and control; the exact node inventory lives in [Graph editor](graph-editor.md). [Graph editor](graph-editor.md)

## Analyze what changed — available

- **Find the right view.** Search analyzers by title or keyword in the Sidebar, read their About guidance, and open dockable Workbench tabs. Reorder, split, join, or pop out a view without duplicating an analyzer tab. [Analysis tools](analysis-tools.md) · [UI layout](ui-layout.md)
- **Keep measurements comparable.** Set shared FFT, overlap, window function, channel, resampling, and frequency-range controls; tune each analyzer's own options separately. Charts offer cursor readouts and appropriate scales or overlays. [Analysis tools](analysis-tools.md)
- **See time and level.** Inspect waveform, peak and RMS levels, or a fine-resolution frame-RMS envelope. Frame RMS tracks short changes in amplitude; it is not programme loudness. [Analysis tools](analysis-tools.md) · [Analysis metrics](analysis-metrics.md)
- **See frequency and timbre.** Use spectrum and time-frequency maps, perceptual or musical feature maps, and descriptors for spectral balance, change, concentration, noisiness, periodicity, and zero crossings. The [tool inventory](analysis-tools.md#tool-inventory-oxiaudio) names each analyzer. [Analysis tools](analysis-tools.md)
- **Follow pitch and modulation.** Track fundamental frequency with pYIN, YIN, or autocorrelation; bound the pitch range and inspect voiced-frame reliability. Examine amplitude- and frequency-modulation rates and depth. [Analysis metrics](analysis-metrics.md)
- **Find notes, gaps, and syllables.** Segment gated audio into musical note spans and gaps; inspect duration, level, envelope, voiced share, and pitch per segment. Group nearby spans into syllables and examine jitter, shimmer, and periodicity **proxies**, not clinical diagnoses. [Analysis metrics](analysis-metrics.md)
- **Find timing.** Inspect tempo, onset strength and detected onsets or downbeats. Onsets are not gated note boundaries. [Analysis tools](analysis-tools.md) · [Analysis metrics](analysis-metrics.md)
- **Measure programme loudness.** Inspect integrated and momentary/windowed LUFS and loudness range (EBU R128). Use frame RMS instead for very short amplitude events. [Analysis tools](analysis-tools.md)
- **Explore perception.** Inspect critical-band energy, modelled loudness in sones/phons and its frequency distribution, sharpness, roughness, fluctuation strength, masking, tonality, and stereo spatial cues. Add equal-loudness contours to a spectrum or spectrogram. Models and proxies are labelled; SPL-based interpretation needs calibration. [Psychoacoustics](analysis-psychoacoustics.md) · [Roadmap M26–M31](roadmap.md#m26m31--psychoacoustic-analysis-)

## Keep the evidence — available

- **Annotate a moment or span.** Add a point or range from the Timeline, a chart, or the playhead. Write Markdown and, for a chart annotation, retain a frozen values/settings snapshot even after analysis settings change. [Annotations](annotations.md)
- **Review without moving the window.** Select an annotation to locate it across charts, edit or discard changes in the Annotations rail, or open it in a separate window. Choose **Analyze** when you want to move the analysis window to that mark. [Annotations](annotations.md)
- **Compare projects, not tracks.** Run the same analyzer on two independent projects with their own windows, filters, and options. Align by relative time, fine-tune the reference offset, swap A/B, and inspect overlays or deltas when results are comparable; setting mismatches are reported instead of silently interpolated. [Comparison](comparison.md)
- **Return to a comparison.** Compare live windows or a saved reference snapshot, pop out a compare view, and save the last successful comparison in the owner project for later review without the reference window open. [Comparison](comparison.md)
- **Export the evidence.** Save analyzer data as provenance-bearing JSON or CSV (with metadata sidecar), copy CSV, export every open analysis, or capture the rendered chart as PNG with its visible theme and zoom. PNG needs the app; data export also works headlessly. [Exports](exports.md)

## Let an agent or script do the groundwork — available

- **Connect an agent.** Enable the MCP server from the app, discover analyzers and their valid options, and let an external agent open a source, change settings or graphs, run analyses, preview, annotate, compare, export, and save. In a running app the window follows along; without one, MCP can work headlessly. Agent interpretation is not a built-in analyzer. [MCP](mcp.md) · [MCP/CLI ergonomics](mcp-cli-ergonomics.md)
- **Ask for the amount of detail you need.** Read short, unit-labelled summaries first; request compact previews or full arrays when necessary. Transient runs can leave the project setup unchanged, and runs can avoid opening a tab. [MCP/CLI ergonomics](mcp-cli-ergonomics.md)
- **Batch recordings from the shell.** Use the standalone `hey-listen-cli` to list analyzers, analyze multiple files or windows to JSONL, render synth audio, create projects, compare projects, and read or edit saved-project annotations. It uses the analysis engine without a GUI; `heylisten-mcp` is the separate MCP transport. [CLI](cli.md) · [MCP](mcp.md)
- **Carry the work back into the app.** Create `.heyl` files headlessly with source, setup, open tabs and annotations; save a headless comparison and reopen its tab in the desktop app. [CLI](cli.md) · [Comparison](comparison.md)

## Make it yours — available

- **Change the appearance.** Switch Auto/Dark/Light, choose independent light and dark themes, adjust UI scale, and import, export, reveal, or remove theme files. Themes style charts and graph editors as well as the shell. [Theming](theming.md)
- **Install and maintain the tools.** Check for signed app updates; from Help, install, update, repair, or uninstall the standalone CLI. Its installed version follows the app. [Updater](updater.md) · [CLI](cli.md)

## Not yet available

### Planned

- **Reusable analysis templates (M13).** Save a source-independent setup of settings, tools, graphs, and optionally layout; apply it to another recording with a window policy that adapts to its duration. Planned entry points include app UI, MCP, and CLI. [Templates](templates.md)
- **Live synth workflow (M22).** Audition graph edits without replacing the source, or opt into a live synth-owned source that updates in place so existing windows, annotations, and charts keep their positions. Show a node ghost and landing/connection preview when dragging from the palette. [Roadmap M22](roadmap.md#m22--synth-workflow-live-audition--in-place-source-planned)
- **Timeline and transport improvements (M23).** Bring a newly committed window into view, Shift-drag to select it, seek or pause/resume from a persistent playhead, control loop and follow behaviour, and make trackpad/wheel pan and zoom consistent across charts. Show full-height guides when selecting or editing annotation spans. [Roadmap M23](roadmap.md#m23--timeline-ergonomics-planned)
- **Keyboard-first control (M24).** Reach transport, window, annotation, graph, and tab actions by configurable shortcuts; find commands and tools in a palette, and discover or rebind keys in a shortcuts dialog. [Hotkeys](hotkeys.md)

### Proposed or drafted

- **Further Timeline precision (M23 proposal).** Hover time/sample readouts, a context menu, snapping, typed window bounds, easier handles, navigation history, and accessibility announcements are proposals to confirm, not committed features. [Roadmap M23 proposals](roadmap.md#proposed-additions-prioritized--confirm-before-building)
- **In-app help and onboarding (M34 draft).** Contextual help for analyzers, graphs, and projects, plus a getting-started path and clearer documentation entry points; surfaces and content are still TBD. [Roadmap M34](roadmap.md#m34--improved-documentation-and-help-drafted)
- **Landing-page rework (M35 draft).** A clearer public explanation of the open → filter → analyze → annotate → compare workflow; site structure and copy remain TBD. This is a communications plan, not a new analysis capability. [Roadmap M35](roadmap.md#m35--landing-page-rework--remotion-workflow-video-drafted)
