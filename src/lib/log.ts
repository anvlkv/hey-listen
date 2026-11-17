import { invoke } from "@tauri-apps/api/core";
import { attachLogger, LogLevel } from "@tauri-apps/plugin-log";

/**
 * The frontend half of the app log (ADR-33).
 *
 * Everything the webview prints — `console.log` / `info` / `warn` / `error` anywhere in
 * the app, plus the startup and unhandled-error reports in `boot.ts` — is forwarded to the
 * core's single log file, so one bug report carries both sides in order. The line says
 * which side wrote it (the plugin's target) and where: this module prefixes the message
 * with a short `[ui <file>:<line>]` origin.
 *
 * Forwarding goes **directly** to `plugin:log|log`, never through `src/lib/ipc.ts`: the
 * façade logs a rejected invoke, so routing a log line through it would recurse — and the
 * E2E mock seam must not be able to swallow a log line. See `docs/logging.md`.
 */

/** The console methods that reach the file, and the plugin level each one reports. */
const METHODS = {
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  log: LogLevel.Info,
  info: LogLevel.Info,
  warn: LogLevel.Warn,
  error: LogLevel.Error,
} as const;

type Method = keyof typeof METHODS;

/** What every forwarded line starts with; the mirror uses it to recognise its own echo. */
const UI_TAG = "[ui ";

/** A `console` method's callable shape (all of them accept any arguments). */
type ConsoleMethod = (...data: unknown[]) => void;

/** The most bytes one forwarded line may carry (a huge argument must not flood the file). */
const MAX_BYTES = 8 * 1024;

/** This module's own frames in a dev build (a bundled name is not distinguishable). */
const SELF_MODULE = /\/lib\/log\.[jt]s\b/;

/** Frames this module puts before the caller's: `origin` → the patched console method. */
const SELF_FRAMES = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let installed = false;
/** Set while a Rust record is being printed, so the mirror cannot bounce back as a write. */
let mirroring = false;

/**
 * Install the `console` bridge. Called **first** from `src/boot.ts`, so a module that
 * throws while loading is already covered.
 */
export function installLogBridge(): void {
  if (installed) return;
  installed = true;
  // The Lighthouse preview has no core to invoke — and no log file to write into.
  if (typeof window === "undefined" || window.__HEYLISTEN_PREVIEW__) return;

  for (const method of Object.keys(METHODS) as Method[]) {
    patchConsole(method);
  }
}

/** Wrap one `console` method: print as before, then forward the same call. */
function patchConsole(method: Method): void {
  const original = (console[method] as ConsoleMethod).bind(console);
  (console as unknown as Record<Method, ConsoleMethod>)[method] = (...args: unknown[]) => {
    original(...args);
    if (mirroring) return;
    forward(METHODS[method], args, origin());
  };
}

/** Send one line to the core, capped and unable to fail the caller. */
function forward(level: LogLevel, args: unknown[], origin: string): void {
  try {
    const message = cap(`${UI_TAG}${origin}] ${describe(args)}`);
    void invoke("plugin:log|log", { level, message }).catch(() => {});
  } catch {
    // Reporting a line must never be able to break the code that logged it.
  }
}

/**
 * Mirror the core's records into the webview console (dev only: a released build has no
 * console for a user to read, and the file already holds every line).
 *
 * The plugin's webview target re-emits **every** record on `log://log`, so a naive mirror
 * would print a line only to forward it again, forever. The `mirroring` flag breaks that
 * loop (the callback and the console call are synchronous), and a record that is already a
 * `[ui …]` line is skipped: the console printed it when it was first logged.
 */
export async function initLogMirror(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined" || window.__HEYLISTEN_PREVIEW__) return;
  try {
    await attachLogger(({ level, message }) => {
      if (message.startsWith(UI_TAG)) return;
      const method = MIRROR_METHOD[level] ?? "log";
      mirroring = true;
      try {
        console[method](`[log] ${message}`);
      } finally {
        mirroring = false;
      }
    });
  } catch (err) {
    // The mirror is a convenience; the file is the log of record.
    console.error("could not mirror the log into the console", err);
  }
}

/** The console method a mirrored record prints at, by the plugin's numeric level. */
const MIRROR_METHOD: Partial<Record<LogLevel, Method>> = {
  [LogLevel.Trace]: "trace",
  [LogLevel.Debug]: "debug",
  [LogLevel.Info]: "info",
  [LogLevel.Warn]: "warn",
  [LogLevel.Error]: "error",
};

/**
 * The call site to report: a short `file:line` taken from the stack, skipping this
 * module's own frames. `"?"` when the webview gives no usable stack.
 *
 * `forward` is **not** on this stack: `origin()` is evaluated as its argument, so the two
 * frames above are `origin` itself and the patched console method.
 */
function origin(): string {
  const frames = framesOf(new Error().stack);
  const caller = frames.slice(SELF_FRAMES).find((frame) => !SELF_MODULE.test(frame.url));
  return caller ? `${shortFile(caller.url)}:${caller.line}` : "?";
}

/** A parsed stack frame: its URL and its line. */
interface Frame {
  url: string;
  line: number;
}

/**
 * Parse `Error.stack` into frames.
 *
 * Handles both shapes a WebView produces — V8's `at fn (url:line:col)` and
 * JavaScriptCore's `fn@url:line:col` (what WebKit here reports) — and skips the header
 * line, which carries no location.
 */
function framesOf(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const raw of stack.split("\n")) {
    const match = /(?:^|[@(])([^\s()@]+):(\d+):\d+\)?$/.exec(raw.trim());
    if (match) frames.push({ url: match[1], line: Number(match[2]) });
  }
  return frames;
}

/** Shorten a frame's URL: a dev path keeps its `src/…` tail, a bundle keeps its file. */
function shortFile(url: string): string {
  const src = /\/src\/(.+)$/.exec(url);
  if (src) return src[1];
  const assets = /\/assets\/(.+)$/.exec(url);
  if (assets) return assets[1];
  return url.replace(/^[a-z]+:\/\/[^/]+\//i, "");
}

/** Format the call's arguments the way a console line reads, one string per line. */
function describe(args: unknown[]): string {
  return args.map(format).join(" ");
}

/** One argument as text: an `Error` keeps its stack, an object is JSON, the rest `String`. */
function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value, circular());
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** A `JSON.stringify` replacer that names a cycle instead of throwing on it. */
function circular(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  };
}

/** Cap a message in **bytes** (the file is UTF-8), dropping a split code point. */
function cap(message: string): string {
  const bytes = encoder.encode(message);
  if (bytes.length <= MAX_BYTES) return message;
  return `${decoder.decode(bytes.slice(0, MAX_BYTES))}…`;
}
