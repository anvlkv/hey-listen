# Hey Listen — tooling report (iteration 1)

**Scope.** This evaluates **Hey Listen 0.5.3** as consumed by Syrinx's iteration-1
evaluation and data-extraction scripts — specifically `scripts/data/evaluate.py`
(project + comparison preparation), `scripts/data/extract_tags.py` (tag
extraction), the `just evaluate*` recipes, and the per-fragment analysis written
for this iteration (`data/evaluation/analyze_fragments.py`). Two surfaces were
actually used: the **batch CLI** (headless, the workhorse for scripts) and the
**GUI app** (listening + curation). The **MCP server** was not exercised here; the
batch CLI is the surface the scripts target, per the tool's own guidance that
shell/CI work belongs on the CLI.

**Verdict in one line.** The analysis engine is strong and scripting-friendly;
the friction is almost entirely in process lifecycle (the "batch CLI" is the GUI
app binary) and a handful of sharp edges around pitch range and annotation
bodies.

---

## 1. What it was used for

| Use | Surface | Command(s) |
| --- | --- | --- |
| Render → project (source + tabs + params + annotations) | batch CLI | `hey-listen project …` |
| Bind each analyzer to one origin (saved compare view) | batch CLI | `hey-listen compare … --save` |
| Read annotation bodies back for tag extraction | batch CLI | `hey-listen annotations … --json --full` |
| Per-fragment synth-vs-origin deltas | batch CLI | `hey-listen analyze … --windows …` |
| Pin the tool version into manifests | batch CLI | `hey-listen --version` |
| Listen and tag/curate annotations | GUI app | (app) |

---

## 2. Functionality

### 2.1 Works well

- **One engine, two interfaces.** The batch CLI and the app share the same
  analysis engine and the same project reader/writer. `evaluate.py` leans on this
  deliberately: writing projects through the CLI guarantees the app can open them
  (`resolve_cli` docstring, `evaluate.py`).
- **Deterministic, self-describing JSONL.** Every `analyze` record carries the
  effective `window` / `params` / `options`, a canonical `summary` (a one-line
  `text` plus labelled `items`), and a `result` shaped by mode. This is what made
  the per-fragment driver tractable: it parsed `summary.items` for
  `medianF0Hz` / `voicedFrames` / `f0Reliable` and the spectral `min`/`max`
  without guessing.
- **`analyze` is genuinely batch.** Multiple files in one process, `--windows
  FILE` for many windows in one process (what `analyze_fragments.py` used to run
  ~247 windows per side without re-decoding), `--summary`/`--full`, and
  `-p`/`-o` patching of shared params and per-tool options.
- **Discovery is good.** `hey-listen analyzers [ID]` returns the catalog and one
  tool's options, defaults, ranges, and units — the pre-flight that let the
  scripts pick the right `minF0Hz`/`maxF0Hz` keys.
- **Segmentation without a full result.** `noteMetrics` compact returns `bounds`
  for every detected span; the D1 origin windows came from that.
- **`gateDb` gating** on the scalar series is a clean way to drop background
  before comparing levels/shape.
- **`annotations` is a real reader/writer**: `--json`/`--full` list,
  `--get`/`--add`/`--update`/`--delete`, `--to` for editing a copy, and atomic
  rewrite. `evaluate.py` and `extract_tags.py` both read through it rather than
  re-parsing the `.heyl` container.

### 2.2 Gaps and missing pieces

- **`pitchPyin` has no pitch-range control and is hard-capped at 2000 Hz.** Its
  option set is empty (`hey-listen analyzers pitchPyin` → `options: {}`), and it
  reports `effectiveMinF0Hz`/`effectiveMaxF0Hz` of 50/2000 regardless of any
  `-p freqMinHz/freqMaxHz`. Measured in this iteration: above ~2 kHz it returns
  nulls or sub-harmonics, so it cannot serve as the required cross-tracker for
  most tier-1 species. `evaluate.py` encodes the same fact: it passes the pitch
  range to `pitchYin`, `pitchAutocorr`, and `modulation`, with the comment
  *"pYIN takes none"* (`pitch_tool_options`).
- **No built-in per-syllable verdict runner.** The evaluation plan (`evaluation-1.md`
  §4.5) had to specify steps 8–13 (delta + verdict writer) as *to build* on top
  of Hey Listen; the comparison primitive stops at "diff one analyzer across two
  projects". Those steps were ultimately deferred in favour of tags, so the
  measured per-fragment comparison in this iteration had to be assembled from
  `analyze` + a custom driver.
- **One comparison binds one reference per analyzer.** The project format holds a
  single reference per analyzer, so N origins force N projects
  (`save_comparison_project` docstring). This is why the iteration produced
  `<slug>.heyl` plus 180 `<slug>.via_XC<id>.heyl` companions, and why the tags
  end up scattered across companion projects.

### 2.3 Bugs and fragility (observed)

- **App-boot log plugin, two failure modes.** `hey-listen` is the GUI app binary
  (`evaluate.py` discovers it on PATH or in `/Applications/Hey Listen.app/`), so a
  "batch" command still runs Tauri setup:
  1. **Sandbox**: the log plugin aborts with
     `PluginInitialization("log", "Operation not permitted (os error 1)")` when it
     cannot write its log location, so `hey-listen` needs an unsandboxed shell.
  2. **Race**: concurrent instances lose a race over the log file and abort with
     `PluginInitialization("log", ENOENT)`. Both the project scripts
     (`extract_tags.py::cli_reader` — *"the app's Tauri setup can lose a race
     with another instance over its log plugin and abort"*) and this iteration's
     parallel subagents hit it; the workaround is a retry loop.
- **Series-family comparisons once failed to round-trip.** The 0.5.1 build wrote
  a `COMPARE` section its own reader rejected (`postcard: Hit the end of buffer`);
  fixed by 0.5.2 (`evaluation-1.md` §8.1). The scripts now *read back* every
  project before promoting it (`evaluate.py::commit_project`), which is a
  reasonable pattern but exists only because a write was not proof of readability.
- **`noteMetrics` defaults are wrong for this corpus.** With default `maxF0Hz`
  2000 it merged two syllables across a 0.09 s rest and misread the >2 kHz
  syllables in the `anas_acuta` testdrive (`evaluation-1.md` §9). The synthesized
  side therefore ignores the blind segmenter and uses the demo schedule.
- **`--version` is not always reliable.** `extract_tags.py::probe_version` runs it
  with `check=False` and a 120 s timeout, and tolerates a `None` version, because
  the call can fail.

---

## 3. Friendliness

### 3.1 Good

- **Summary-first.** A one-line `summary.text` plus labelled `items` usually
  answers the question before any arrays are requested; this is a genuinely good
  design for scripts and agents alike.
- **Effective settings are echoed** in every record, so a script can prove what
  actually ran rather than what it asked for.
- **Unknown option keys are hard errors** (canonical camelCase, snake_case
  aliases accepted), so a typo fails loudly instead of silently using a default.
- **Parent directories are created** by `project`/`save_project`, which kept the
  scripts free of mkdir boilerplate.
- **`annotations --json` defaults to a safe one-line excerpt**, which is the
  right default for listing; the body is opt-in via `--full`.

### 3.2 Friction and gotchas

- **Annotation bodies require `--full`, and the default silently omits them.** The
  tags live at the *end of the body*, so `extract_tags.py` must pass `--full`
  (its docstring calls this out). A reader that forgets the flag gets an excerpt
  with no tags and no error — a silent data loss. This is the single sharpest
  footgun in the surface the project used.
- **Negative offsets need the `=` form.** `evaluate.py::compare` passes
  `--b-offset=<value>` as one token *"because a negative value would otherwise
  parse as a flag"* — a minor but real CLI-parsing quirk that the script has to
  know about.
- **One process per command, each paying app setup.** `evaluate.py`'s `HeyListen`
  wrapper is explicitly *"one process per command"*, and each process boots the
  Tauri app before running the subcommand. Across the 292 synthesized + 668
  origin projects (multiple commands each), that is thousands of app-boot
  processes; it is also the direct cause of the §2.3 race and the sandbox
  failure, and it makes every sweep slower than the underlying engine.
- **CLI discovery must be reimplemented per script.** `resolve_cli` encodes the
  resolution order (explicit flag → `HEY_LISTEN_CLI`/`HEY_LISTEN_BIN` → PATH →
  app bundle), and deliberately excludes `heylisten-mcp` — the MCP helper speaks
  a protocol the script would have to implement, rather than returning JSONL.
  Fine once, but it is boilerplate every consumer re-derives.
- **App-side, two rough edges** recorded during the iteration: the analysis
  window is not reset to the whole file when annotations are saved while listening
  to a sub-window (`evaluation-1.notes.md`), and swapping species in the studio is
  reported as slow (unmeasured).

---

## 4. What the scripts had to work around

These are the concrete accommodations the project made, and each is a symptom of
a Hey Listen property:

| Workaround | Symptom |
| --- | --- |
| Retry once on any CLI failure (`extract_tags.py::cli_reader`) | log-plugin race aborts a read |
| Read a written project back before promoting it (`commit_project`) | write ≠ readable (0.5.1 series-compare bug) |
| Pass `--full` for annotation bodies | default excerpt drops the tags |
| Pass negative `--b-offset` as one `=` token | flag parsing of a leading `-` |
| Exclude `heylisten-mcp` from CLI candidates | MCP helper returns no JSONL |
| Tolerate `--version` returning nothing | version probe can fail |
| Use the demo schedule, not `noteMetrics`, for synth windows | segmenter defaults misread the corpus |

---

## 5. Assessment

**Functionally, Hey Listen is the right tool and mostly delivered.** The engine,
the JSONL contract, the analyzer catalog, `--windows` batching, `gateDb`, and
the project/annotation reader-writer were all sufficient for the iteration's
work, and the self-describing envelope is what made the measured per-fragment
comparison (§4 of `CONCLUSIONS.md`) cheap to build on top of it.

**The pain is process lifecycle, not capability.** The single biggest issue is
that the batch CLI is the GUI app binary, so headless/CI use pays full app init
and inherits the log plugin's sandbox and concurrency failures. Everything else
— the pYIN 2000 Hz cap, the `--full` footgun, the negative-offset quirk, the
one-reference-per-comparison constraint — is a sharp edge that cost work but did
not block the evaluation.

## 6. Recommendations (for the next iteration's tooling)

1. **Ship a GUI-free console binary for the batch subcommands** (`analyze`,
   `compare`, `project`, `annotations`) so scripts do not boot the Tauri app per
   command. This alone removes the sandbox failure, the log-plugin race, and most
   of the sweep latency.
2. **Give `pitchPyin` (and `harmonicRatio`) an explicit pitch range** so
   cross-tracker agreement works above 2 kHz; the current cap makes the
   "two trackers agree" acceptance criterion unevaluable for most tier-1 species.
3. **Make annotation bodies available without a silently-lossy default** — either
   include the body/tags in the default JSON record, or fail/emit a warning when a
   body-bearing field is requested without `--full`.
4. **Make the log-plugin init non-fatal or lazy for batch subcommands**, so a
   missing/unwritable log path cannot abort a headless analysis.
5. **Consider a native per-window delta/verdict helper** (or document the recipe)
   so a consumer does not have to re-derive the synth-vs-origin comparison from
   raw `analyze` output.
6. **App polish:** reset the analysis window on save, and profile the species-swap
   path, before the next listening pass.

None of these are engine rewrites; they are lifecycle and API ergonomics changes
that would make the next evaluation materially cheaper to run and more reliable.
