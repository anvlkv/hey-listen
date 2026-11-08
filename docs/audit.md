# Hey Listen app, MCP, and CLI audit

**Date:** 2026-11-08  
**Method:** Read-only, parallel code review of the SolidJS app, Rust core/project format, MCP bridge and dispatcher, and batch CLI. Findings below were checked against the cited implementation and existing tests; the failure scenarios are code-derived unless a runtime reproduction is explicitly stated. No application code was changed. The untracked `docs/hey-listen-report.md` was left untouched.

**Scope:** Delivered functionality in [the roadmap](roadmap.md), not planned M13, M22–M24, or M26–M31 work. Severity: **P1** risks data loss, wrong-audio analysis, or process failure; **P2** breaks a supported workflow or makes results misleading; **P3** is a narrower usability/documentation defect. These are priorities, not proof of exploitability in every deployment.

## P1 — address first

### 1. Saving an existing project can destroy the previous version

**Surfaces:** app, headless MCP, CLI `project`; **confidence:** high. The GUI save opens the final path with `File::create` before the project is complete ([`commands/project.rs:111–139`](../src-tauri/src/commands/project.rs)); headless save does the same ([`mcp/dispatch/project.rs:80–111`](../src-tauri/src/mcp/dispatch/project.rs)). A write error, disk-full condition, or process termination after truncation leaves a partial project instead of the previously valid file. In contrast, CLI annotation mutations already use a sibling temporary file and rename ([`cli/batch/annotations.rs:281–308`](../src-tauri/src/cli/batch/annotations.rs)).

**Recommendation:** Consolidate project saving behind one atomic-write helper: write to a temporary sibling, flush and sync it, then replace the destination; preserve the old file on any pre-replace error. Add a failing-writer/overwrite regression test. A successful `write_project` currently flushes its writer, but cannot make an already truncated destination atomic.

### 2. Concurrent file opens can make the timeline describe the wrong audio

**Surface:** app and bridged MCP `open_audio_file`; **confidence:** high in the race, not dynamically reproduced. The frontend increments `openToken` and ignores a stale completion ([`state/source.ts:125–159`](../src/state/source.ts)), but every `stream_file` invocation installs its decoded PCM in the core independently ([`commands/decode.rs:38–56`](../src-tauri/src/commands/decode.rs)). If opening A starts first, B starts second, B completes first and A completes last, the UI displays B while playback and analysis read A. The asynchronous `clear_audio_source` at the start of `openPath` is also not awaited ([`state/source.ts:125–129`](../src/state/source.ts)).

**Recommendation:** Serialize source replacement or attach a source-generation/request ID to the core install and commit only the newest request; keep frontend and core replacement transactional. Add an out-of-order decode completion test, including a second source that finishes first.

### 3. Malformed project DATA metadata can request huge allocations before validation

**Surfaces:** app, headless MCP, CLI project readers; **confidence:** high in the unchecked allocation path. The reader checks chunk-count equality and the index start, then allocates `chunk_count * DATA_INDEX_ENTRY_LEN` and `frames * channels` without verifying that either fits the DATA section or a resource bound ([`project/read.rs:229–255`](../src-tauri/src/project/read.rs)). A small crafted `.heyl` with a valid recomputed checksum but inconsistent declared sizes can trigger an oversized allocation, overflow, or process termination before its chunks are checked. `offset + length` is also unchecked at the later bounds check ([`project/read.rs:255–267`](../src-tauri/src/project/read.rs)). This is a local untrusted-file availability risk; no exploit run was performed.

**Recommendation:** Use checked arithmetic; validate index bytes, chunk extents, sample count, and reasonable resource limits against the actual section/file length *before* allocation. Exercise valid-checksum malformed headers and indexes in loader tests.

## P2 — supported workflows and result integrity

### 4. Project saving holds the audio-source lock for the entire disk write

**Surface:** app live capture; **confidence:** high in the lock contention, conditional on slow enough I/O for audio loss. `save_project` holds the source mutex through `write_project` ([`commands/project.rs:111–139`](../src-tauri/src/commands/project.rs)). Capture appends chunks under the same mutex ([`state/mod.rs:47–59`](../src-tauri/src/state/mod.rs); [`commands/capture.rs:102–110`](../src-tauri/src/commands/capture.rs)). Saving a large recording to slow storage can stall the capture poller and eventually lose buffered input. Snapshot the PCM under a short lock, release it before disk I/O, and test saving under concurrent capture with a deliberately slow writer.

### 5. A stream reset is treated as successful end-of-audio

**Surfaces:** file opening in app/MCP/CLI; **confidence:** high for the code path; chained Ogg fixture not run. `decode_file` breaks on `SymphoniaError::ResetRequired`, then returns the already decoded frames as success ([`audio/decode.rs:171–178,206–214`](../src-tauri/src/audio/decode.rs)). For a chained stream, later logical streams are omitted without an error. Rebuild the decoder for the updated track list or reject the stream explicitly; add a chained-Ogg fixture to the decode tests.

### 6. MCP loopback accepts unlimited unauthenticated blocking sessions

**Surface:** app MCP server; **confidence:** high. Each TCP accept spawns a detached thread with no concurrency limit ([`mcp/server.rs:41–78`](../src-tauri/src/mcp/server.rs)). That thread calls unbounded `read_line` before comparing the handshake token, with no read deadline; the same applies to subsequent JSON lines ([`mcp/server.rs:82–115`](../src-tauri/src/mcp/server.rs)). Local peers can hold connections open or stream a huge unterminated line, consuming threads/memory without knowing the token. Bound handshake/message sizes, set deadlines, and limit simultaneous sessions; test stalled and oversized clients. The token still protects tool authorization, but not this pre-authentication resource path.

### 7. MCP bridge discovery treats a stale advertisement as a live app

**Surface:** stdio MCP auto mode; **confidence:** high. Auto mode commits to bridging when `mcp.json` is readable ([`mcp/mod.rs:72–81`](../src-tauri/src/mcp/mod.rs); [`mcp/bridge.rs:28–49`](../src-tauri/src/mcp/bridge.rs)). If the app crashes and leaves that file, connection retries fail and the process returns an error rather than starting headless ([`mcp/bridge.rs:187–205`](../src-tauri/src/mcp/bridge.rs)). The possibility of a stale file is documented in [`mcp.md:199–214`](mcp.md). Probe the endpoint/PID before choosing a mode or fall back to headless on connection refusal; retain `--headless` as an explicit override. Add an auto-mode test with a stale advertisement.

### 8. MCP forwarded requests retain waiters on failure or timeout

**Surface:** app MCP routing; **confidence:** high. `dispatch` registers a sender, but neither `emit_to` failure nor the 120-second response timeout removes it ([`mcp/server.rs:154–170`](../src-tauri/src/mcp/server.rs); [`mcp/mod.rs:88–119`](../src-tauri/src/mcp/mod.rs)). Repeated unresponsive-window calls accumulate pending entries until a late reply arrives or the process exits. Cancel the waiter on every early return (prefer a guard) and test emission failure and timeout cleanup.

### 9. A disconnected MCP socket can leave the stdio bridge blocked on stdin

**Surface:** stdio MCP bridge; **confidence:** high. When socket reading ends, the bridge joins the stdin-forwarding thread ([`mcp/bridge.rs:64–100`](../src-tauri/src/mcp/bridge.rs)); that thread may remain blocked in `stdin.read` while the MCP client keeps stdin open. The bridge can therefore hang after the app closes its socket. Make socket shutdown interrupt or avoid waiting indefinitely for the stdin reader; test server-side disconnect with open client stdin.

### 10. Headless parameter and analyzer-option overrides can be silently ignored or misreported

**Surfaces:** headless MCP and batch CLI; **confidence:** high. `merge_params` silently ignores wrong-typed known keys (for example `{"fftSize":"4096"}`) yet reports success ([`mcp/dispatch/args.rs:31–85`](../src-tauri/src/mcp/dispatch/args.rs)). `merge_options` recognizes keys globally, not per analyzer, and does not enforce the per-tool catalog ranges ([`mcp/dispatch/args.rs:107–152`](../src-tauri/src/mcp/dispatch/args.rs); [`cli/batch/args.rs:363–393`](../src-tauri/src/cli/batch/args.rs)). For example, `-t frameRms -o frameMs=0` may report `frameMs: 0` even though the engine falls back to its default ([`audio/analysis/types.rs:215–220`](../src-tauri/src/audio/analysis/types.rs)); `-o frameRms.nMels=20` is accepted even though it does not configure `frameRms`. The effective-options overlay includes non-null overrides irrespective of the tool's declared keys ([`audio/analyzers.rs:114–129`](../src-tauri/src/audio/analyzers.rs)). Validate type, applicability, and range against the catalog before updating state, and add negative tests through both MCP and CLI.

### 11. A new popout can overwrite a newer shared-state value during startup

**Surface:** app multi-window state; **confidence:** medium-high; scheduling-dependent race not reproduced. `initUiSync` reads the snapshot, applies it, marks itself synced, *then* subscribes to `ui-state` ([`state/uiSync.ts:88–100`](../src/state/uiSync.ts)). A peer update in that gap is not received; `initUiState` immediately creates push effects that resend local state ([`state/uiState.ts:104–138`](../src/state/uiState.ts)). A stale timeline, option, or annotation value can win over the peer's newer value. Subscribe before fetching the snapshot and reconcile revisions/queued events rather than blindly re-pushing the initial snapshot; test a peer write during popout initialization.

### 12. CLI can report success despite losing output or its CSV provenance sidecar

**Surface:** batch CLI; **confidence:** high. The JSONL emitter ignores `writeln!` errors ([`cli/batch/output.rs:7–15`](../src-tauri/src/cli/batch/output.rs)), and the app ignores its final buffered stdout `flush` error before exiting with the compute status ([`lib.rs:120–129`](../src-tauri/src/lib.rs)). A full destination or broken stdout can yield exit `0` with missing JSON. CSV export similarly discards a `.meta.json` sidecar write error and emits a success confirmation without a sidecar ([`cli/batch/export.rs:76–101`](../src-tauri/src/cli/batch/export.rs)), contrary to the documented CSV provenance contract in [`cli.md:105–111`](cli.md). Propagate writer/flush and sidecar errors into a nonzero exit; add failing-writer and unwritable-sidecar tests.

## P3 — smaller CLI/MCP contract discrepancies

- **CLI unknown analyzer exit:** `request_tools` rejects an unknown ID during request construction ([`cli/batch/args.rs:353–360`](../src-tauri/src/cli/batch/args.rs)), which becomes stderr and exit `2` ([`cli/mod.rs:76–80`](../src-tauri/src/cli/mod.rs); [`lib.rs:131–135`](../src-tauri/src/lib.rs)). [`cli.md:114–119`](cli.md) instead promises a JSON error record and exit `1`. Choose and test one contract, then update the other.
- **CLI `synth --pretty` without a tool:** `synth` emits exactly one source-summary record ([`cli/batch/synth.rs:36–40`](../src-tauri/src/cli/batch/synth.rs)), but the `--pretty` validator counts zero analyzer records and rejects it ([`cli/batch/args.rs:247–264`](../src-tauri/src/cli/batch/args.rs)). Count the source-summary record and honor pretty output in that branch, or document the restriction.
- **MCP initialize guidance is stale:** [`mcp/protocol.rs:104–108`](../src-tauri/src/mcp/protocol.rs) says `maxPoints` thins series only and would drop `noteMetrics` events, while the delivered family-aware behavior explicitly preserves note/event lists and also thins matrices ([`roadmap.md:1157–1161`](roadmap.md)). Update instructions to the actual contract; pin it with a protocol/catalog consistency test.
- **Failed OS-open retry:** `openPaths` permanently adds a path to its `handled` set before calling a loader ([`state/menu.ts:75–89`](../src/state/menu.ts)); `loadProject` catches failures internally ([`state/project/load.ts:225–241`](../src/state/project/load.ts)). Another drop/OS-open event for the same failed path is ignored until restart. Only mark successful loads, or clear the entry on failure.

## Verification and boundaries

- **Passed in this audit:** `npm run typecheck`, `npm run test:unit`, `npm run build`, and `cargo check` (from `src-tauri/`). A parallel Rust-core review also ran `cargo test --lib` and reported **363 passed, 0 failed**. These validate the current baseline, not the untested failure scenarios above.
- **Not run:** full Tauri/WebDriverIO E2E, live audio hardware/capture, hostile TCP client tests, malformed-project fuzzing, or OS-specific CLI binaries. Thus races, resource exhaustion, and chained-container scenarios remain code-backed findings rather than witnessed end-to-end reproductions.
- **Existing coverage:** [`headless_mcp.rs`](../src-tauri/tests/headless_mcp.rs) starts with `--headless`, so it does not exercise autodetection/bridge shutdown. The GUI source-open tests do not force out-of-order decode completion. Project writer tests use in-memory writers, not interrupted filesystem overwrites. Extend those tests alongside fixes rather than treating a green build as evidence these paths are safe.
- **Not classified as bugs:** explicitly planned features in the roadmap, and the documented Windows GUI-binary console and bare GUI-less Tauri limitations in [`cli.md`](cli.md).

**Suggested sequence:** first make project saves atomic and project reads allocation-safe; then make source replacement transactional. Next validate the shared headless settings path and MCP transport limits/lifecycle. Finish with the CLI output contract, cross-window race, and documentation discrepancies, adding targeted regression tests at each step.
