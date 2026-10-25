import { error as logError } from "@tauri-apps/plugin-log";

/**
 * Startup diagnostics.
 *
 * Imported **first** by `index.tsx` so these handlers are installed before the app's
 * other modules are evaluated — a module that throws while *loading* can only be
 * reported by a handler that is already installed.
 *
 * A failure during the first paint is otherwise invisible: no window, no error, and
 * nothing in the log file. Note the direction of the log plugin's APIs — `attachConsole`
 * mirrors *Rust* logs into the webview console; it does **not** forward the frontend's
 * `console.*` to the log file. So every startup failure is reported twice: to the
 * webview console (visible in `npm run tauri dev`) and explicitly to the Tauri log
 * (the rotated log file plus stdout, which is what a CI run and a user's bug report
 * can actually show). See `docs/testing.md` → "When the shell does not render".
 */
export function reportStartupFailure(message: string, error?: unknown): void {
  const detail = describe(error);
  console.error(`[startup] ${message}`, detail);
  // Fire-and-forget: reporting a failure must never be able to fail startup itself.
  void logError(`[startup] ${message} ${detail}`).catch(() => {});
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

window.addEventListener("error", (event) =>
  reportStartupFailure(
    `uncaught error at ${event.filename}:${event.lineno}`,
    event.error ?? event.message,
  ),
);

window.addEventListener("unhandledrejection", (event) =>
  reportStartupFailure("unhandled rejection", event.reason),
);
