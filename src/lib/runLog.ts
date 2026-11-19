/**
 * A run's lifecycle as one line each in the app log (see `docs/logging.md`).
 *
 * [`startRun`] names the run when it starts, when it ends (always with its elapsed time),
 * and warns every [`HEARTBEAT_MS`] while it is still going — so a run that never returns is
 * named in the log instead of leaving only an eternal "Comparing…". The lines go through
 * `console.*`; `src/lib/log.ts` forwards them to the core's single file with a `[ui …]`
 * origin, so nothing here talks to the log plugin.
 */

/** The two kinds of run the Workbench starts. */
export type RunKind = "analysis" | "comparison";

/** How a run ended. A cancelled run is an expected supersede (D-21), not a failure. */
export type RunOutcome = "ok" | "failed" | "cancelled";

export interface RunLog {
  /** The run got its inputs and is starting. */
  start(): void;
  /** A still-running run: reports the heartbeat and schedules the next one. */
  heartbeat(): void;
  /** One line of context for the run — call it before `finish`, never one per finding. */
  warn(detail: string): void;
  /** The run ended: exactly one of `ok` / `failed` / `cancelled`. */
  finish(outcome: RunOutcome, detail?: string): void;
}

/** A run still going after this long reports, then after every further interval. */
const HEARTBEAT_MS = 15_000;

/**
 * Start logging one run. `label` names it after the kind (`spectrum 0.20–1.80 s`), and the
 * optional `note` supplies extra heartbeat context (the current phase) once known.
 */
export function startRun(kind: RunKind, label: string, note?: () => string | null): RunLog {
  const started = performance.now();
  let finished = false;
  let timer: number | undefined;

  function elapsed(): string {
    return formatElapsed(performance.now() - started);
  }

  /** The note in parentheses, read fresh: it may change while the run is going. */
  function noteSuffix(): string {
    if (!note) return "";
    try {
      const text = note();
      return text ? ` (${text})` : "";
    } catch {
      return "";
    }
  }

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function heartbeat() {
    if (finished) return;
    // One timer only, however the heartbeat was reached.
    clearTimer();
    emit("warn", `${kind} ${label} still running after ${elapsed()}${noteSuffix()}`);
    timer = window.setTimeout(heartbeat, HEARTBEAT_MS);
  }

  function finish(outcome: RunOutcome, detail?: string) {
    if (finished) return;
    finished = true;
    clearTimer();
    const extra = detail ? `: ${detail}` : "";
    if (outcome === "ok") emit("info", `${kind} ${label} finished in ${elapsed()}`);
    else if (outcome === "cancelled")
      emit("info", `${kind} ${label} cancelled after ${elapsed()}${extra}`);
    else emit("warn", `${kind} ${label} failed after ${elapsed()}${extra}`);
  }

  return {
    start() {
      if (finished) return;
      emit("info", `${kind} ${label} started`);
      clearTimer();
      timer = window.setTimeout(heartbeat, HEARTBEAT_MS);
    },
    heartbeat,
    warn(detail: string) {
      if (!finished) emit("warn", `${kind} ${label}: ${detail}`);
    },
    finish,
  };
}

/** `0.20–1.80 s` — the span fragment a run's label carries. */
export function runSpanLabel(start: number, end: number): string {
  return `${start.toFixed(2)}–${end.toFixed(2)} s`;
}

/** The one warning a run reports when the core widened the frame hop to its frame cap. */
export function hopWidenedNote(samples: number): string {
  return `frame hop widened to ${samples} samples (frame cap)`;
}

/** Why a comparison is not a like-for-like diff, as one line; `null` when it is. */
export function comparabilityNote(mismatchCount: number, filtersDiffer: boolean): string | null {
  const parts: string[] = [];
  if (mismatchCount > 0) {
    parts.push(`${mismatchCount} setting${mismatchCount === 1 ? "" : "s"} differ`);
  }
  if (filtersDiffer) parts.push("filters differ");
  return parts.length > 0 ? parts.join("; ") : null;
}

/** A whole number of ms, then seconds with at most one decimal (`412 ms`, `15 s`, `4.2 s`). */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${Math.round(ms / 100) / 10} s`;
}

/** One implementation of the console call; a log line must never break the run. */
function emit(level: "info" | "warn", text: string) {
  try {
    if (level === "info") console.info(text);
    else console.warn(text);
  } catch {
    // Ignored: logging never fails the run it describes.
  }
}
