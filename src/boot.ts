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

/**
 * Make `navigator.language` a tag `Intl` accepts.
 *
 * A `C` / `C.UTF-8` locale — the default on headless CI runners and in minimal
 * containers — makes the WebView report a non-BCP-47 `language` such as `"C"`.
 * `new Intl.NumberFormat("C")` then throws a `RangeError`, and because a bundled
 * dependency (uPlot) builds one at **module scope**, that throw aborts the whole
 * bundle before the first paint: an empty `#root`, indistinguishable from a slow
 * one. Normalizing it here — the app's first module, evaluated before the rest of
 * the import graph — keeps the shell rendering. (Kobalte reads it too, and falls
 * back to this same `"en-US"`.)
 */
function normalizeNavigatorLanguage(): void {
  if (isIntlLocale(navigator.language)) return;
  Object.defineProperty(navigator, "language", {
    configurable: true,
    get: () => "en-US",
  });
}

/** Whether `Intl` accepts `tag` as a locale (a structurally valid BCP-47 tag). */
function isIntlLocale(tag: string): boolean {
  try {
    // Structurally invalid tags (e.g. `C`, `en_US.UTF-8`) throw a `RangeError`;
    // valid-but-unknown ones (e.g. `xx-XX`) just resolve to `[]`. Both are fine
    // to hand to `Intl.NumberFormat`, so only the throw marks a real problem.
    Intl.NumberFormat.supportedLocalesOf([tag]);
    return true;
  } catch {
    return false;
  }
}

// Runs as part of this module's body, before any component module (and so before
// uPlot's module-scope `Intl.NumberFormat`) is evaluated.
normalizeNavigatorLanguage();

window.addEventListener("error", (event) =>
  reportStartupFailure(`uncaught error at ${event.filename}:${event.lineno}`, event.error ?? event.message),
);

window.addEventListener("unhandledrejection", (event) =>
  reportStartupFailure("unhandled rejection", event.reason),
);
