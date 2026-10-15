# Code hygiene — the maid

The maid is the repo's **quality gate**: one command that checks the things a
reviewer would otherwise have to catch by eye — that files stay short enough to
read, that logic is not copy-pasted, that nothing dead is left behind, and that
both languages are formatted and linted the same way.

It exists because those invariants do not survive on intention alone. The repo
grew to ~37 000 lines across 200 source files with **no formatter, no linter and
no CI quality step at all**, so drift was invisible: duplication accumulated where
two chart views were written in parallel, and four files passed 1000 lines while
nobody was looking. The maid makes each of those a *failed check* instead of a
gradual habit.

```sh
npm run maid        # check everything (what CI and the pre-push hook run)
npm run maid:fix    # autofix what can be autofixed
```

## What it checks

| Check | Command | Enforces | Config |
| --- | --- | --- | --- |
| Formatting | `npm run maid:fmt` | prettier over every source file | `.prettierrc.json`, `.prettierignore` |
| Linting | `npm run maid:lint` | eslint + `typescript-eslint` + `eslint-plugin-solid` | `eslint.config.js` |
| File length | `npm run maid:size` | no source file past its **budget**, and none over 400 lines | `scripts/maid-baseline/fileSizes.json` |
| Duplication | `npm run maid:dup` | duplicated-line percentage below the threshold | `.jscpd.json` |
| Dead code | `npm run maid:dead` | no unused files / exports / types / dependencies | `knip.jsonc` |
| Rust | `npm run maid:rs` | `cargo fmt --check` and `cargo clippy -D warnings` | `src-tauri/rustfmt.toml` |

Every check is **blocking**. There is no advisory mode.

## When it runs

| Trigger | What runs | Why that scope |
| --- | --- | --- |
| `git commit` | `.husky/pre-commit` → lint-staged: prettier + eslint on the **staged** files, plus the file-length budget | Fast feedback; a commit should not wait on a repo-wide analysis |
| `git push` | `.husky/pre-push` → `npm run maid` | The full gate, once per push rather than once per commit |
| CI | the frontend job runs the five frontend checks; the rust job runs `cargo fmt`, `cargo clippy` (all three OSes) and — on Linux — `cargo test` | Backstop for `--no-verify` and for platform-specific Rust code |

The hooks are installed by `npm install` (the `prepare` script runs `husky`, which
points git at `.husky/_`). The hook *bodies* are tracked in `.husky/`; only the
generated `.husky/_/` shims are git-ignored. Bypass with `git commit --no-verify`
only when you know the gate is wrong.

`cargo test` in CI doubles as a **generated-code drift check**: ts-rs rewrites
`src/bindings/` from the Rust types during the run, and the job fails if that
leaves an uncommitted diff — the "you changed a boundary type but forgot to
regenerate the TypeScript" mistake that `docs/dependencies.md` warns about.

## The rules

### Files stay under 400 lines

A 1200-line file is not a crime against style; it is a file nobody can load into
their head at once — including the next agent asked to change it.

`scripts/checkFileSize.mjs` fails on two things: a source file over the **400-line
ceiling** that is not in `scripts/maid-baseline/fileSizes.json`, and a budgeted
file that **grew past its budget**. The budget existed only so the original backlog
(~24 files, the largest 3066 lines) could be paid down gradually instead of in one
unreviewable change; **M15 paid it down, so the baseline is now empty** and the
ceiling applies to every file directly. The mechanism stays for the same reason:

```sh
node scripts/checkFileSize.mjs             # check
node scripts/checkFileSize.mjs --update    # ratchet: drop entries now within the
                                           # ceiling, lower the rest to their current
                                           # size — never raise one
```

`--update` deliberately **refuses to raise a budget**. A file that got longer is a
failure, not a new baseline: the honest fixes are to split it, or to move the new
logic into a file of its own. This is why the largest files today are all just under
the ceiling rather than comfortably small — the split is what matters, and the next
line added to a 393-line file is a failed check with a clear remedy. Markdown is
exempt — `docs/` is prose and may be long on purpose — as are the generated trees
(`src/bindings/**`, `dist/`, `public/`, `src-tauri/{target,gen}`).

### No new duplication

`.jscpd.json` fails when duplicated **lines** exceed the threshold (70-token
minimum match). The threshold is a **ratchet**: it sits just above today's measured
value and comes down as duplication is removed. Lower it in the same change that
removes a clone. M15 removed the big clones and dropped the value from **1.5 to
0.5** (measured ≈0.36 % of lines).

The clone pairs M15 removed:

| Duplication | Where |
| --- | --- |
| ~250 lines, 17 clone pairs | `components/analyzer/MatrixView.tsx` ↔ `SpectrogramTab.tsx` — the pan / zoom / note-drag / reframe interaction, written twice → one `chartInteraction.ts` |
| ~60 lines | `ChannelSelect.tsx` ↔ `SelectField.tsx` ↔ `SourcePanel.tsx` — the same select trigger markup three times → one `SelectTrigger.tsx` |
| 40 lines | `scripts/notes.test.ts` ↔ `scripts/themeFile.test.ts` — each test file defined its own `check` / `assertEqual` harness → `scripts/testHarness.ts` |
| ~40 lines | `App.tsx` — the splitter down/move/up handlers, written three times → `lib/splitter.ts` + `components/Splitter.tsx` |

What remains is small and mostly *within* a single file — a 26-line `match` arm
pair in `state/analyzer/defs/`, an 18-line test-fixture pair, and 41 lines across
three `src/styles/*` pairs (the pre-existing `.toolbar-*` vs `.params-*`,
`.timeline-*` vs `.graph-*` resemblance). None is worth a shared abstraction yet;
the threshold guards against *new* ones.

### No dead code

`knip.jsonc` fails on unused files, exports, types, dependencies and unlisted
binaries, and on duplicate exports.

Two things about it are worth knowing before you edit it:

- **`ignoreExportsUsedInFile: true`** is on. Solid state modules legitimately
  export a value or type that only their own file reads (a signal's `setX` called
  by that module's actions, a one-use `Props` type). Without this, ~50 of the
  first report's 72 "unused exports" were that single false-positive class. Note
  the smell hiding underneath: if nothing *outside* the file needs a symbol, it
  probably should not carry `export` at all.
- **`ignoreIssues` is a burn-down list**, not a dumping ground. Each entry was a
  symbol verified by grep to be genuinely unreferenced and *deliberately* kept for
  the day the dead-code phase landed. M15 was that phase: the list is **now empty**
  (the last ~15 symbols were deleted — write-only history flags, an unread
  `filteredRate`, a duplicate preview `setOutputGain`, two unused theme constants,
  and a handful of unused e2e helpers/types). If a new finding needs suppressing,
  grep it first and prefer deleting it; never blanket-ignore a directory of app code.

Dependencies are never deleted to satisfy knip. `@tauri-apps/plugin-store` and
`@wdio/local-runner` are load-bearing through mechanisms knip cannot see (version
alignment with the Rust plugin, and wdio's dynamic local-runner resolution) —
`docs/dependencies.md` explains both.

### Generated code is never touched

`src/bindings/**` is ts-rs output, rewritten by `cargo test`. It is excluded from
prettier, eslint, knip and the length budget. Never hand-edit it and never format
it — regenerate it. The same goes for the vendored Font Awesome files under
`public/fonts/`, whose licence comments must stay verbatim.

Run that `cargo test` **from `src-tauri/`**. The export directory comes from
`src-tauri/.cargo/config.toml` (`TS_RS_EXPORT_DIR = ../src/bindings`), and Cargo only
picks up a `.cargo/config.toml` on the way *up* from the working directory — so
`cargo test --manifest-path src-tauri/Cargo.toml` run from the repo root misses it and
dumps a stray `src-tauri/bindings/` instead of refreshing the real one.

## Deliberately not enforced (yet)

These are real, known gaps rather than oversights. Each one is a candidate for a
later ratchet, and turning one on should be its own change:

- **Type-aware linting.** `eslint.config.js` uses `tseslint.configs.recommended`,
  not `recommendedTypeChecked`. `tsc --noEmit` covers much of the same ground, and
  type-aware linting would have to be taught about three tsconfigs plus the
  out-of-project `scripts/*.ts`. The prize is `no-floating-promises`, worth having
  in an app this async — the code already writes `void someAsync()` deliberately.
- **Formatting the docs.** Prettier skips `*.md`: `docs/` is hand-wrapped prose
  with deliberate line breaks, and reformatting it would churn every planning doc
  without making anything better.
- **Clippy's `pedantic` set.** ~309 findings today, dominated by
  `cast_precision_loss` in the DSP code where a "fix" risks changing sample
  accuracy. Not worth the risk for the gain.

## See also

- [`roadmap.md`](roadmap.md) → **M15** for the gate itself and the split / dedupe /
  burn-down work it protects.
- [`architecture.md`](architecture.md) → "Rust module layout" for the module
  structure the splits landed on.
- [`testing.md`](testing.md) for the test suite the gate complements.
