import { installLogBridge } from "./lib/log";

// The console bridge comes first: the handlers below (and every module that loads
// afterwards) report through `console.*`, which this forwards to the app's log file.
installLogBridge();

/**
 * Startup diagnostics.
 *
 * Imported **first** by `index.tsx` so these handlers are installed before the app's
 * other modules are evaluated — a module that throws while *loading* can only be
 * reported by a handler that is already installed.
 *
 * A failure during the first paint is otherwise invisible: no window, no error, and
 * nothing in the log file. `console.error` reaches the file through the bridge in
 * `src/lib/log.ts` (one line, with its `[ui …]` origin), so a startup failure is reported
 * once and lands where a bug report and a CI run can actually see it.
 * See `docs/testing.md` → "When the shell does not render".
 */
export function reportStartupFailure(message: string, error?: unknown): void {
  console.error(`[startup] ${message}`, describe(error));
}

function describe(error: unknown): string {
  if (error == null) return "";
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

// `navigator.language` is normalized *before* the module graph runs by
// `public/locale.js` (loaded as a classic script from `index.html`): a module fix here
// would run too late, because the separately chunked uPlot bundle — which reads
// `navigator.language` at module scope — is evaluated before this module's body.

window.addEventListener("error", (event) => {
  // A `ResizeObserver` loop is reported on `window.error`, but it is a benign
  // notification (the spec calls the condition non-fatal), not a failure the app can act
  // on: logging it would put a false "uncaught error" in every bug report.
  if (event.message.startsWith("ResizeObserver loop")) return;
  reportStartupFailure(
    `uncaught error at ${event.filename}:${event.lineno}`,
    event.error ?? event.message,
  );
});

window.addEventListener("unhandledrejection", (event) =>
  reportStartupFailure("unhandled rejection", event.reason),
);
