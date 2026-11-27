# M35.A — Hero film scenario

The short film at the top of the landing (`landing/public/media/hero.mp4`), rebuilt as a
**31.2 s seamless loop** driven by a real analysis session instead of a slideshow.

- **Timeline / view** — `Grieg_Holberg_Suite_1_Praeludium.ogg`, the full 154.86 s track
  (2 ch, 44.1 kHz). It is the project's source, so the Timeline shows the whole piece with
  the 52.000–83.200 s loop selected. `analysis-example.heyl` embeds this same recording.
- **Film audio** — `Grieg_Holberg_Suite_1_Praeludium.wav` (31.200 s, 44.1 kHz, stereo, f32):
  the seamless loop cut from the OGG (source **52.000 → 83.200 s**).
- **Alignment** — the four exported analyses (`tempo`, `spectralCentroid`, `chromagram`,
  `downbeats`) cover that same window, so every cut lands on a measured musical event.
- **Screenplay** — the agent run in `Audio analysis test-drive.md`, replayed live: the
  capture opens the **original OGG in a new project** and adds the agent's pins through the
  app's own UI as the scenario runs; its compact tool calls are a parallel log (§6.1).
- **No saved project** — `analysis-example.heyl` is only the reference for the pins' text and
  numbers. The capture never opens it, so the rail starts empty and the film shows the
  annotations being made.
- **Look** — the real running app, captured by `npm run capture:hero` (WebdriverIO) as
  **stills plus short interaction bursts** (crosshair sweeps, a timeline zoom, the roughness
  drill-down, MCP switching on), so the film moves. No exported charts, no mocked numbers.

**Assets used** — the original `.ogg` (source + Timeline), the `.wav` loop (film audio), the
four analysis `.json` files (alignment), `analysis-example.heyl` (the pin text/numbers the
scenario recreates), the test-drive markdown (agent log), and `analysis-example.license.txt`.

Everything below is **one pass**. The page plays the file with `<video loop>`, so the film
must end where it begins; §7 is the closure rule.

---

## 1. What the music says (the score we cut to)

The loop is 2684 analysis frames at a 512-sample hop (11.6 ms). Beat grid: **235 BPM**
(confidence 0.459), 122 beats. Times below are **film time** (source − 52.0 s), and the same
mapping holds for the OGG: film time = OGG time − 52.0.

| Film time | Source | Event (measured) | Centroid |
| --- | --- | --- | --- |
| 0.00 | 52.00 | loop start — quiet dark entry | ~320–800 Hz |
| **4.00** | 56.00 | **statement enters**: level lifts ~13 dB (−30.2 → −24.8 dBFS) | 337 Hz |
| **6.80** | 58.80 | **dark → bright**: 549 → 1015 Hz within 0.1 s; peaking 1941 Hz at 7.25–7.45 | 1015 Hz |
| **10.85** | 62.85 | **bright → dark plunge**: 371 → 229 → 165 Hz (bottom 129 Hz at 11.85) | 229 Hz |
| **17.35** | 69.35 | **bass register enters**: +21 dB after a −40.7 dBFS breath; 427 → 146 Hz | 135 Hz |
| **26.10** | 78.10 | **texture thins**: −22.8 → −29.0 dBFS into the airy echo | 324 Hz |
| **27.05** | 79.05 | **quiet but bright**: 491 → 1067 → 1350 Hz while at −39 dBFS | 491 Hz |
| 31.20 | 83.20 | seam back to the quiet dark start | ~370 Hz |

Downbeats (film time): 5.224, 6.246, 7.268, 8.290, 11.355, 12.376, 14.420, 15.441, 18.506,
21.571, 22.593, 23.615. Cuts snap to these where possible.

Why this loop (the agent's evidence, told nowhere in the film but true underneath it):

- 31.2 s, starts −37.0 dBFS RMS in the heart of a dark echo lull and ends equally quiet, so
  the wrap closes quiet onto quiet.
- Seam at 45 µs resolution: **−0.97 dB** (ch0) / **+1.01 dB** (ch1) — *smaller than the
  largest deltas beside it* (1.06 dB two frames earlier, 1.30 dB at −43 frames).
- Both seam edges are largely unvoiced, so no sustained tone beats against itself across the
  wrap; chroma continuity at 1 s is 0.64 (vs 0.68 for the runner-up).
- Richness: centroid **112 → 2022 Hz (≈18×)** inside the loop, **24.8 dB** of dynamics.
  (The loop annotation's “12.7×” is its dark→bright swing; 18× is the full range.)

Characterization used for captions/alt text: strictly tonal polyphonic keyboard/string
music; spectral flatness ≤ 5×10⁻⁴, tonality up to 0.99; C-tonal (C 20.0 %, A 15.4 %,
D 14.5 %, F 10.0 %); driving syncopated 235 BPM in this section.

**Perception (roughness).** Over the loop: **0.025–0.484 asper** (uncalibrated → relative),
with the maximum at **68.17 s** (the densest statement) and the minimum at **79.20 s** (the
airy echo). The model splits **24 critical bands** and **24 modulation rates** (1–100 Hz),
weighted at **70 Hz**. Its chart carries the **drill-down**: on hover, the cursor frame's
band profile, its three strongest bands, and the band × rate grid — the film animates that
card travelling across the loop.

### The pins the capture adds

The agent's annotations are the film's evidence trail. The capture **creates them through
the app's UI** as the scenario runs — right-click the chart → “Add annotation here” → write
the markdown → Save — so the rail starts empty and gains a row (and a chart marker) at each
scene. The loop note is a **point** at 52.0 s, since the chart menu adds points.

| Time | Title | Body, in one line | Chart |
| --- | --- | --- | --- |
| 52.00 | LOOP — 52.000 → 83.200 s (31.200 s) | Seam −0.97/+1.01 dB; starts −37 dBFS, ends quiet; 12.7× dark→bright, 24.8 dB dynamics. | `spectralCentroid` |
| 56.00 | the statement enters (level lift) | +13 dB in ~0.15 s (−30.2 → −24.8 dBFS); centroid 553 → 337 Hz. | `spectralCentroid` |
| 58.80 | dark→bright: the loop's brightest point | 549 → 1015 Hz in 0.1 s; peak 1941 Hz at 59.25 s. | `spectralCentroid` |
| 62.85 | bright→dark: plunge to the darkest point | 371 → 229 → 165 Hz; settles 129–145 Hz at 63.85 s. | `spectralCentroid` |
| 68.17 | roughness peak | 0.48 asper (uncalibrated); 24 bands × 24 rates, weighted at 70 Hz. | `roughness` |
| 83.20 | seam harmony | 1 s chroma 0.64 vs 0.68; both edges unvoiced. | `chromagram` |

S2 adds the loop and statement pins, S3 the bright pin, S4 the plunge pin, S5 the seam pin,
S6 the roughness pin. The final New Project clears them all for the loop (§7).

---

## 2. The story in one sentence

> An agent already found the interesting moment in this piece. Open the same project to
> listen, read the measurements, pin what matters, shape it, and take the data out — then
> the loop comes round again.

It follows the landing's own copy (“Hear more. Spend less time searching.”) and walks the
six sections of the page: **sources → analysis → annotations → filter graph → export →
agents (MCP)**.

---

## 3. Format and safe area

| | |
| --- | --- |
| Composition | `1600 × 900`, 30 fps, **936 frames** (31.2 s) |
| Capture | **stills + 1–2 s bursts** (12–18 frames each) at ~7 fps, retimed in Remotion |
| Audio | the WAV above, one pass per loop |
| Landing box | `width: 100vw; height: clamp(320px, 62vh, 720px); object-fit: cover` |
| Desktop crop | on a ~2.4:1 box a 16:9 frame loses ~26 % of its height (~13 % top + bottom) |
| **Safe area** | keep all action and captions inside **y 12 %–88 %**, ideally 16 %–84 % |
| Mobile | the page switches to `16 / 9; object-fit: contain`, so the full frame shows |
| Background | theme panel colour of the active shot; no black bars inside the frame |

The app window is captured at **≈1440 × 900 CSS px** (inner), at the display's DPR. The
manifest records normalized rects, so Remotion maps them regardless of DPR.

---

## 4. Theme plan (dark → light → dark)

The app's default is **Retrowave Neon** (dark). The film uses the **dark → light → dark**
arc that mirrors the music's own quiet → bright → quiet shape.

| Cut | Theme | Mechanism |
| --- | --- | --- |
| 0.00–6.80 | **Dark** (Retrowave Neon) | opening, source, annotations |
| **6.80** | **Dark → Light** (Solarized Light) | a 0.40 s (12-frame) dissolve at the measured *dark→bright* moment, between two captures of the **same** state |
| 6.80–26.10 | **Light** | analysis, harmony, dynamics, filter graph |
| **26.10** | **Light → Dark** | a 0.40 s dissolve at *texture thins*, between two captures of the **same** export-rail state |
| 26.10–31.20 | **Dark** | export, MCP, return to the opening frame |

Both dissolves use paired captures (`02-centroid-dark` / `03-centroid-light`, and
`09-export-light` / `09-export-dark`) taken from an identical app state, so only the palette
changes. The capture script restores the visitor's/developer's original theme mode when it
finishes.

---

## 5. Shot list (what the capture script stages)

Each clip is a full-window screenshot (a still) or a short burst plus a normalized rect map
(see §9). A **new project** is created with the original OGG as its source, the analysis
window **and view** are pinned to 52.000–83.200 s, and the annotations rail starts empty.
The agent's pins are added through the chart menu at the start of S2–S6, so the rail and the
chart lanes fill as the film goes.

| Clip id | Kind | Theme | State / interaction | Rects that matter | Caption (optional) |
| --- | --- | --- | --- | --- | --- |
| `01-timeline-zoom` | burst 14 | dark | Spectrogram + **Sources**; crosshair at t≈3 s; the Timeline **view** pushes in from the full track to the loop window | `source`, `timeline`, `timeline.canvas`, `analyzer.spectrogram` | One project. Source, setup, views. |
| `02-centroid-dark` | burst 12 | dark | Centroid; **adds the loop + 56.00 s pins** via the chart menu; crosshair sweeps 0.15 → 0.218 into the bright peak | `analyzer.spectralCentroid`, `annotations`, `annotations.rows` | The agent found the loop. |
| `03-centroid-light` | burst 12 | light | **same state**, light; **adds the 58.80 s pin**; sweep continues 0.218 → 0.255 (**dissolve pair**: 02 last → 03 first) | same | — |
| `04-centroid-dip-light` | burst 12 | light | **adds the 62.85 s pin**; sweep 0.31 → 0.365 through the dark plunge | `analyzer.spectralCentroid`, `first.annotation` | Bright → dark, pinned. |
| `05-chromagram-light` | burst 12 | light | **adds the seam pin**; sweep fx 0.40 → 0.60, fy 0.35 → 0.60 across the pitch-class bands | `analyzer.chromagram`, `annotations.rows` | Harmony, measured. |
| `06-roughness-light` | burst 12 | light | **adds the roughness pin**; crosshair sweeps **0.51 → 0.62**; the **hover drill-down card** follows (band profile + band × rate grid) | `analyzer.roughness`, `drilldown.card` | Roughness, band by band. |
| `07-compare-hover` | burst 12 | light | **second window** at 14.2–43.6 s; compare; the cursor crosses the A/B overlay, updating the readouts (no slider) | `compare`, `compare.canvas` | Check it against another passage. |
| `08-filter-light` | still | light | tone-stack imported + auto-laid out; **filter bypassed** | `graph.canvas`, `analyzer.filter` | Shape it before you measure it. |
| `09-export-light` | still | light | **Export** rail (analysis window as WAV/FLAC/AIFF) | `export` | — |
| `09-export-dark` | still | dark | **identical** to `09-export-light`, dark base (dissolve pair) | same | Take the data with you. |
| `10-mcp-on` | burst 3 | dark | off → toggle → “listening on 127.0.0.1:” | `mcp`, `mcp.status`, `toolbar.mcp` | Or let an agent drive it. |
| `11-return-dark` | still | dark | **New Project + the OGG again** (clears the pins); re-stage **frame 0** of `01-timeline-zoom` | same as `01` | — |

Notes:

- **Motion is captured, not faked.** A burst is 12–18 consecutive screenshots of one real
  interaction (~7 fps on the capture side); Remotion retimes them to the clip's `seconds`
  and crossfades adjacent frames. Stills are for holds, push-ins and the two dissolves.
  Total **89 burst frames + 4 stills**, so ~11 s of the 31.2 s has true frame-to-frame
  changes.
- **Pins are UI-created.** Each is: right-click the chart → “Add annotation here” → write the
  markdown → Save. The annotation attaches to that chart, so its rail row carries the frozen
  values and its chart lane gets a marker. The rail starts empty (S1) and holds six rows by
  S6; the final New Project clears them.
- **Full track, loop window.** The Timeline is the original OGG (154.86 s) and the opening
  shot starts on the **whole track** with the 52.0–83.2 s window highlighted; the burst pushes
  into that window. The plot axes follow the window, so `fx` still maps to the loop's events.
  The source is never trimmed to 31.2 s; the toolbar shows the OGG's name.
- **Compare staging.** `open_project_window` → open the same OGG → pin 14.2–43.6 s; then in
  main, centroid's tab menu → “Compare with…” → the second window. Both sides keep their own
  window and params; the relative axis starts each at 0. The cursor then sweeps the overlay
  (the readouts update); the second window is closed after the capture.
- **Roughness hover.** uPlot's cursor binds to its `.u-over` div, so the capture hovers that
  element (not just the canvas). The `drilldown.card` appears and its band profile / band ×
  rate grid update frame by frame.
- **MCP on.** Force off, capture, toggle on, capture the listening state. The config found at
  start is restored afterwards (the setting is app-wide).
- **Filter bypassed is deliberate.** Importing `tone-stack.dot` shows the real editor and
  DOT graph; enabling it would filter the analyses upstream and break alignment with the
  exported JSON. The film says “shape it”, not “these numbers are filtered”.
- **Crosshair positions are musical.** With view = window, `fx = (event − 52) / 31.2`:
  0.218 (6.8 s bright), 0.348 (10.85 s dark), 0.518 (16.17 s roughness max), 0.556
  (17.35 s bass). The sweeps start/end on those numbers; `hoverAt` drives uPlot's own
  pointer handler, so the readout is genuine.
- **Sources** is shown by switching the activity bar to Sources *after* opening the chart,
  so the Workbench keeps the analyzer tab while the rail shows the file.

---

## 6. Film timeline (one 31.2 s pass, 30 fps)

| Scene | In | Out | Frames | Asset | Theme | Motion / zoom (target) |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 0.000 | 3.000 | 0–90 | `01-timeline-zoom` | dark | **new project + OGG** (view = whole track); 2.0 s burst (14 f): the view pushes into the loop; hold |
| S2 | 3.000 | 6.800 | 90–204 | `02-centroid-dark` | dark | **adds the loop + 56.00 s pins**; 1.5 s burst (12 f): crosshair into the peak; hold/push |
| **S3** | 6.800 | 10.850 | 204–326 | `03-centroid-light` | **dissolve** | **adds the 58.80 s pin**; 12-frame dark→light dissolve, then a 1.5 s burst (12 f) |
| S4 | 10.850 | 13.600 | 326–408 | `04-centroid-dip-light` | light | **adds the 62.85 s pin**; 1.5 s burst (12 f): crosshair through the plunge |
| S5 | 13.600 | 16.200 | 408–486 | `05-chromagram-light` | light | **adds the seam pin**; 1.6 s burst (12 f): crosshair across the bands |
| S6 | 16.200 | 19.600 | 486–588 | `06-roughness-light` | light | **adds the roughness pin**; 2.4 s burst (12 f): the **drill-down card** travels from the roughness max rightward |
| S7 | 19.600 | 23.600 | 588–708 | `07-compare-hover` | light | 1.8 s burst (12 f): the cursor crosses the A/B overlay; push in |
| S8 | 23.600 | 26.100 | 708–783 | `08-filter-light` | light | still, pan across the graph (1.22×) |
| **S9** | 26.100 | 28.000 | 783–840 | `09-export-dark` | **dissolve** | 12-frame light→dark dissolve (09 light → 09 dark), hold on the export rail |
| S10 | 28.000 | 30.000 | 840–900 | `10-mcp-on` | dark | 0.8 s burst (3 f): off → on → listening; hold |
| S11 | 30.000 | 31.200 | 900–936 | `11-return-dark` | dark | **New Project + OGG**, then a still at 1.00× — **identical framing to S1 frame 0** |

Cuts are hard cuts except the two theme dissolves. **The bursts carry the motion**: each is
retimed to its `seconds` and crossfaded frame-to-frame (12–18 source frames over 1.5–2.4 s),
so the crosshair, the timeline view, the compare overlay and the MCP status actually move.
Stills get a slow push (≤ 1.10×) or a pan. The pushes ease out on the musical event, never
mid-phrase.

Captions are optional and short (≤ 6 words), placed at **y ≈ 70 %**, left-aligned at the
safe-area margin, in the film's UI font; they fade in/out over 8 frames so they never fight
the chart. Drop them entirely if the hero copy below the film already says the line.

### 6.1 Agent log (parallel track)

A compact strip shows the agent **working alongside** the UI: the calls that produced the
pins and, now and then, a thought. It is an overlay in Remotion (not a capture).

- **Placement** — a lower-third strip, bottom-left, **y ≈ 82 %**, inside the safe area, over
  the Timeline (a soft scrim behind it). Monospace, ~0.8 rem, `--muted`, prompt `›`. It sits
  just below the caption line and never over the chart's plot area.
- **Pacing** — one line at a time, ~1.4 s, 6-frame fades; ~45 % of the runtime in total.
  Lines are optional: drop any that crowds its scene.
- **Voice** — calls are `verb → result`; thoughts are italic and prefixed `·`.

| In–Out | Kind | Line |
| --- | --- | --- |
| 0.7–2.1 | call | `› open_audio_file → Grieg…Praeludium.ogg` |
| 3.5–4.9 | call | `› run_analysis spectralCentroid · 52.0–83.2` |
| 5.9–7.1 | thought | `· the quiet lulls are the loop starts` |
| 7.3–8.7 | call | `› annotate 58.80 s · dark → bright` |
| 11.2–12.6 | call | `› annotate 62.85 s · plunge → 229 Hz` |
| 13.9–15.3 | call | `› chromagram · C 20 % · A 15 %` |
| 14.8–16.0 | call | `› annotate 83.20 s · seam harmony` |
| 16.6–18.0 | call | `› roughness · 0.02–0.48 asper · max @ 68.17 s` |
| 18.2–19.4 | thought | `· drill-down: 24 bands × 24 rates, weighted at 70 Hz` |
| 19.9–21.3 | call | `› open_project_window · same OGG · 14.2–43.6` |
| 21.5–22.9 | call | `› compare_analysis spectralCentroid · Δ mean` |
| 23.9–25.3 | call | `› set_filter_graph tone-stack.dot · bypassed` |
| 26.5–27.9 | call | `› export_all · wav + json + csv` |
| 28.5–29.9 | call | `› mcp → enabled · listening on 127.0.0.1:…` |

Every line is a compressed, true step from `Audio analysis test-drive.md`; the compare is the
M25 workflow and roughness is the M38 drill-down. The annotations are UI actions, not MCP
calls — the log narrates the agent, the rail shows the result. Do not invent numbers: the
line announces a step, the chart supplies the value.

---

## 7. Loop closure (the “logically loops” rule)

- **Frame 0 = frame 935.** `11-return-dark` is re-staged to match **frame 0** of
  `01-timeline-zoom` (same tab, rail, window, crosshair, theme), so the last second is the
  first second again. The page’s `<video loop>` therefore has no visual jump.
- **New project before S11.** The capture starts afresh and opens the OGG again, which clears
  the live annotations, the filter graph and the open tabs. The name, window, rails, theme and
  filter are then exactly frame 0's. The pins vanish on that cut; the composition crossfades
  S10 → S11 over ~0.5 s (the airy outro) so the rows and chart markers fade out rather than
  pop.
- **Audio is already seamless** at 31.2 s (verified above), so the audio wrap does not click.
- **Motion returns to rest**: S11 ends at zoom 1.00× and the caption/log layers are empty by
  30.4 s.
- **No state is left “open” that frame 0 lacks**: the MCP popover is dismissed and its config
  restored before S11, the export rail is not visible in `11`, the compare window is closed,
  the rail is empty in both and the theme is dark in both.

If a future edit cannot preserve frame-parity, render a 6-frame fade through the theme
background at the very end **and** start — but prefer parity.

---

## 8. Feature coverage

| Landing section | Shown by | Beat |
| --- | --- | --- |
| Sources | `01-timeline-zoom` (full OGG in the Timeline, loop window selected) | 0–3.0 |
| Analysis | `01`–`06` (spectrogram, centroid, chromagram, roughness) | 3.0–19.6 |
| Annotations | added live through the chart menu; the rail grows from empty to six rows | 3.0–19.6 |
| Compare | `07-compare-hover` (same OGG in a second window; cursor across loop vs runner-up) | 19.6–23.6 |
| Filter & synth | `08-filter-light` (DOT graph editor) | 23.6–26.1 |
| Import & export | `09-export-dark` | 26.1 |
| MCP & CLI | `10-mcp-on` (switching to listening) | 28.0 |
| Themes | the two dissolves | 6.80, 26.10 |

Not in v1 (possible v2 beats): Synth render, Help/Manual window, transport preview. They do
not fit 31.2 s without crowding.

---

## 9. Capture contract (`npm run capture:hero`)

WebdriverIO, the embedded Tauri driver and the **release** binary — same harness as
`capture:landing` (`screenshots.wdio.conf.ts`). New files:

```
e2e/hero/capture.spec.ts        the scenario (not under e2e/specs/, so CI never runs it)
e2e/support/hero.ts             theme, window pin, shot + rect capture, manifest writer
e2e/support/heroAnnotations.ts  the pins: chart menu → Add → markdown → Save
e2e/support/capture.ts          hoverAt (uPlot `.u-over`) and the element crops
hero.wdio.conf.ts               base config with specs = ["./e2e/hero/capture.spec.ts"]
```

Wiring: `package.json` → `"capture:hero": "wdio run hero.wdio.conf.ts"`; knip entries for
`e2e/hero/**/*.spec.ts` and `hero.wdio.conf.ts`; `e2e/tsconfig.json` includes the new config.

**Output** (`video/story-assets/hero/`, regenerable):

```
shots/01-timeline-zoom-00.png … 01-timeline-zoom-13.png
shots/02-centroid-dark-00.png …
…
shots/11-return-dark.png
manifest.json
```

`manifest.json` shape (**v2** — a clip has one frame or a burst):

```jsonc
{
  "version": 2,
  "generatedAt": "2026-…",
  "project": "unsaved project",
  "source": "Grieg_Holberg_Suite_1_Praeludium.ogg",
  "audio": "Grieg_Holberg_Suite_1_Praeludium.wav",
  "loop": { "sourceStart": 52.0, "sourceEnd": 83.2, "duration": 31.2 },
  "analysis": ["tempo", "spectralCentroid", "chromagram", "downbeats"],
  "compare": { "source": "Grieg_Holberg_Suite_1_Praeludium.ogg", "window": [14.2, 43.6], "tool": "spectralCentroid" },
  "capture": { "width": 1440, "height": 900, "dpr": 2 },
  "shots": [
    {
      "id": "02-centroid-dark",
      "kind": "burst",
      "theme": "dark",
      "note": "…",
      "seconds": 1.5,
      "capturedMs": 2650,
      "fps": 4.5,
      "viewport": { "width": 1440, "height": 900 },
      "frames": [
        {
          "image": "shots/02-centroid-dark-00.png",
          "imageSize": { "width": 2880, "height": 1800 },
          "capturedAt": "2026-…",
          "atMs": 0,
          "rects": {
            "app": { "x": 0, "y": 0, "width": 1, "height": 1 },
            "analyzer.spectralCentroid": { "x": 0.18, "y": 0.06, "width": 0.55, "height": 0.73 }
            // … normalized 0–1, origin top-left
          }
        }
      ]
    },
    {
      "id": "11-return-dark",
      "kind": "still",
      "seconds": 1.2,
      "frames": [ { "image": "shots/11-return-dark.png", "atMs": 0, "rects": { } } ]
    }
  ]
}
```

Rects are **normalized to the viewport**, so a 1× or 2× screenshot is addressed the same
way. A missing selector is simply absent (never a zero rect).

The capture **does not open a saved project**. It starts a new project, opens the original
OGG, changes tabs/theme/window, adds the pins through the UI, and never saves. It opens a
**second project window** for the compare scene (same OGG, 14.2–43.6 s), then closes the
compare tab and that window. Before the return shot it starts another **new project** and
re-opens the OGG, so the live annotations, filter and tabs are cleared and the frame matches
S1. It restores the original theme mode and the app-wide MCP config (`get_mcp_status` at
start) when it finishes.

**Prereqs / run**

```sh
npm run sidecar            # once on a fresh checkout
npm run tauri build        # release binary the harness drives
# quit any running Hey Listen (incl. a dev/MCP instance) first
npm run capture:hero
```

Then stage the assets into `video/public/hero/` (see §10) and render the `HeroFilm`
composition:

```sh
cd video
npx remotion render src/index.ts HeroFilm ../landing/public/media/hero.mp4
```

---

## 10. Remotion plan (what the composition consumes)

- `video/src/HeroFilm.tsx` — reads `hero/manifest.json` and the shot PNGs, and places
  `<Audio src={staticFile("hero/Grieg_Holberg_Suite_1_Praeludium.wav")} />`.
  **Staging:** `staticFile` serves only `video/public/`, so a small step copies
  `video/story-assets/hero/` (shots + manifest) and the WAV into `video/public/hero/`
  before the render; `story-assets/hero/` stays the source of truth, and `public/hero/` is
  build output (gitignored).
- One `Sequence` per scene. A **burst** renders its `frames` as a retimed `<Img>` series
  (crossfading adjacent frames) over the scene's opening seconds; a **still** fills the rest
  with a push/pan. Each scene's `zoomRect` comes from the clip's `rects`.
- The two theme dissolves stack the *same-state* pair (02's last frame ↔ 03's first; the two
  09 stills) and ramp opacity over 12 frames.
- Register in `Root.tsx`: `id="HeroFilm"`, `durationInFrames={936}`, `fps={30}`,
  `width={1600}`, `height={900}`.
- Optionally add a small `Caption` component and an `AgentLog` component (§6.1); keep both
  inside the safe area and out of the chart's data.
- Update `landing/README.md` (“Hero film”) once `make-hero-video.mjs` is retired, and keep
  that script until the Remotion render is committed.

---

## 11. Verify before hand-off

1. **MCP** — reachable for planning (`list_projects` / `get_state`); the capture itself does
   not depend on it.
2. **Numbers** — the four JSONs still cover 52.0–83.2 s and the event table in §1 matches.
3. **Capture** — `npm run capture:hero` exits 0; every clip id in §5 exists; the manifest’s
   `imageSize` matches each PNG; `11` and `01` are pixel-compatible framing; the rail is empty
   in both; the roughness card is present in at least one `06` frame.
4. **Render** — `npx remotion render …` writes `hero.mp4`; `ffprobe` reports **31.2 s**,
   1600×900, 30 fps, AAC audio; the first and last frames match.
5. **Page** — `npm run dev:landing`, confirm the loop has no visible seam at desktop width
   and no letterbox defects at phone width.
6. **Gates** — `npm run test:e2e:typecheck` (the new spec/config), `npm run maid` once.

---

## 12. Decisions / open questions

- **One loop (31.2 s) vs two (62.4 s).** Chosen: one, so audio and picture loop together and
  every analysis frame maps 1:1. A two-pass film could show Synth/Help, at the cost of a
  62 s hero and a double loop.
- **No saved project; the raw OGG.** The capture starts a new project and opens the original
  recording, so the Timeline shows the whole 154.86 s piece with the 31.2 s window. The film
  plays only the loop. Same recording, one mapping; `analysis-example.heyl` only supplies the
  pin text.
- **Pins are made through the UI.** The agent's annotations are created with the chart menu
  (right-click → Add → markdown → Save), not MCP, so the rail visibly fills and each row
  carries the chart's frozen values. The final New Project clears them.
- **Compare is real, not staged.** A second project window opens the same OGG at the agent's
  runner-up fragment; the view diffs `spectralCentroid` on a relative axis (M25) while the
  cursor sweeps the overlay. The fine-tune slider is deliberately **not** used: a 0.5 s shift
  on a 29 s axis is too small to read.
- **Roughness replaces the envelope scene.** It is the perception surface the landing
  promises, and its hover card (24 bands × 24 rates at 70 Hz) is motion on its own. The
  envelope/dynamics beat is dropped; the Timeline and centroid scenes still show level and
  dynamics.
- **Theme return at 26.10 s** (rather than at the very end) so the airy outro is a calm dark
  landing that matches the opening, and the last cut has room to settle.
- **MCP is on for the shot**, on an ephemeral port so it cannot collide with a running app;
  the capture restores the previous config.
- **Stills vs bursts.** 89 burst frames + 4 stills (~11 s of real motion) is the compromise
  that keeps the capture to a minute or two and the assets small. A true 30 fps film would
  need an OS screen recording plus a known window crop — a separate, platform-specific path.
- **Committed assets?** Captured shots are regenerable. If the Remotion render must run in
  CI, commit `story-assets/hero/shots/*.png` + `manifest.json`; otherwise keep them local.
