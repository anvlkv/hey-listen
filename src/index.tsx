/* @refresh reload */
// Startup diagnostics must come first: this is the app's very first import, so a
// failure in any module below (or during the first render) is reported instead of
// disappearing into a blank window. See `src/boot.ts`.
import { reportStartupFailure } from "./boot";
import { render } from "solid-js/web";
import { invoke } from "./lib/ipc";
import { initLogMirror } from "./lib/log";
import App from "./App";
import LogApp from "./LogApp";
import PopoutApp from "./PopoutApp";
import ShortcutsApp from "./ShortcutsApp";
import type { CompareViewDto } from "./state/compare/types";
import { isProjectWindow, isShortcutsWindow } from "./lib/windowRole";

/**
 * How long the popout query may take before the project window is rendered instead.
 * The query answers in milliseconds when it answers at all, so this only ever fires
 * on a wedged command — where the alternative is a window that shows nothing at all.
 */
const POPOUT_QUERY_TIMEOUT_MS = 2_000;

// Mirror the core's log records into the webview console (dev only). The console bridge
// in `src/lib/log.ts` sends this side's `console.*` to the same file, so one log holds
// both producers; `boot.ts` installed it already.
void initLogMirror();

void start();

/** Render this window: a popout shows a single tool or annotation, a project window the app. */
async function start(): Promise<void> {
  // E2E scaffolding (M8): the WebdriverIO Tauri plugin installs `window.wdioTauri`
  // and the `invoke` interception the suite's IPC mocks ride on. It is E2E-only, so
  // the app loads it only when the E2E service launched it (`TAURI_WEBDRIVER_PORT`)
  // — a manual launch never installs it. Loaded dynamically (and before the first
  // paint) so the Lighthouse preview — which has no Tauri core for the plugin to
  // attach to — does not pay for its polling and console forwarding.
  if (!window.__HEYLISTEN_PREVIEW__) {
    const e2e = await invoke<boolean>("e2e_enabled").catch(() => false);
    if (e2e) {
      try {
        await import("@wdio/tauri-plugin");
      } catch (err) {
        // Test scaffolding must never block the app: report and render without it.
        reportStartupFailure("the E2E plugin failed to load", err);
      }
    }
  }

  const root = document.getElementById("root");
  if (!root) {
    reportStartupFailure("the #root element is missing from index.html");
    return;
  }

  try {
    // The Keyboard Shortcuts window is app-wide and needs no project state, so it renders
    // before (and without) the popout query.
    if (isShortcutsWindow) {
      render(() => <ShortcutsApp />, root);
      return;
    }

    // A project window renders immediately; a popout view (tool, annotation, comparison
    // or the log preview, all non-project labels) asks which view it is.
    const target = isProjectWindow ? null : await popoutTarget();
    render(() => {
      if (!target) return <App />;
      if (target.kind === "log") return <LogApp />;
      return (
        <PopoutApp
          toolId={target.kind === "tool" ? target.id : undefined}
          annotationId={target.kind === "annotation" ? target.id : undefined}
          compare={target.kind === "compare" ? target.view : undefined}
        />
      );
    }, root);
  } catch (err) {
    reportStartupFailure("the app failed to render", err);
  }
}

/**
 * What this window pops out: a Workbench **view** (a tool tab — an analyzer or a graph
 * editor — or a subsystem), an **annotation**, a **comparison**, or the app-wide **log
 * preview**.
 */
type PopoutTarget =
  | { kind: "tool"; id: string }
  | { kind: "annotation"; id: string }
  | { kind: "compare"; view: CompareViewDto }
  | { kind: "log" };

/**
 * The view, annotation, comparison or log preview this popout window shows, or `null`
 * when it is none.
 *
 * Asked only by a popout view (`!isProjectWindow`): a project window renders without it.
 * Rust registers which kind a popout is (ADR-11), so the window asks for all four and
 * takes whichever answers (only one can). The first paint must never be gated on a
 * command that can fail or never answer: a rejected query renders the project window
 * (and is reported), and so does one that does not come back within
 * [`POPOUT_QUERY_TIMEOUT_MS`] — a blank window is not a useful failure mode, and on a
 * wedged command it is otherwise all the user ever sees.
 */
async function popoutTarget(): Promise<PopoutTarget | null> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Whoever settles first wins: stop the timer, and let the timeout stay silent.
  const settle = () => {
    settled = true;
    clearTimeout(timer);
  };

  const query = Promise.all([
    invoke<string | null>("popout_tool"),
    invoke<string | null>("popout_annotation"),
    invoke<CompareViewDto | null>("popout_compare"),
    invoke<boolean>("popout_log"),
  ])
    .then(([tool, annotation, compare, log]): PopoutTarget | null => {
      settle();
      if (log) return { kind: "log" };
      if (compare != null) return { kind: "compare", view: compare };
      if (tool != null) return { kind: "tool", id: tool };
      if (annotation != null) return { kind: "annotation", id: annotation };
      return null;
    })
    .catch((err) => {
      settle();
      reportStartupFailure("the popout query failed; rendering the project window", err);
      return null;
    });

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      // The query answered in time; a settled race must not log a false failure.
      if (settled) return;
      reportStartupFailure(
        `the popout query did not answer within ${POPOUT_QUERY_TIMEOUT_MS}ms; rendering the project window`,
      );
      settled = true;
      resolve(null);
    }, POPOUT_QUERY_TIMEOUT_MS);
  });

  return Promise.race([query, timeout]);
}
