/* @refresh reload */
// Startup diagnostics must come first: this is the app's very first import, so a
// failure in any module below (or during the first render) is reported instead of
// disappearing into a blank window. See `src/boot.ts`.
import { reportStartupFailure } from "./boot";
// E2E scaffolding (M8): the WebdriverIO Tauri plugin installs `window.wdioTauri`
// and the `invoke` interception the suite's IPC mocks ride on. It is inert in a
// normal run (nothing calls it), so it ships with the app the E2E suite drives.
import "@wdio/tauri-plugin";
import { render } from "solid-js/web";
import { invoke } from "./lib/ipc";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import PopoutApp from "./PopoutApp";

/**
 * How long the popout query may take before the project window is rendered instead.
 * The query answers in milliseconds when it answers at all, so this only ever fires
 * on a wedged command — where the alternative is a window that shows nothing at all.
 */
const POPOUT_QUERY_TIMEOUT_MS = 2_000;

// Mirror Rust logs into the webview console. (The reverse direction does not exist:
// the frontend's `console.*` is not forwarded to the log file — `reportStartupFailure`
// logs explicitly for that.)
void attachConsole();

void start();

/** Render this window: a popout shows a single tool or note, a project window the app. */
async function start(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) {
    reportStartupFailure("the #root element is missing from index.html");
    return;
  }

  const target = await popoutTarget();
  try {
    render(
      () =>
        target ? (
          <PopoutApp
            toolId={target.kind === "tool" ? target.id : undefined}
            noteId={target.kind === "note" ? target.id : undefined}
          />
        ) : (
          <App />
        ),
      root,
    );
  } catch (err) {
    reportStartupFailure("the app failed to render", err);
  }
}

/** What this window pops out: a Workbench **tool** or a **note**, each with its id. */
type PopoutTarget = { kind: "tool"; id: string } | { kind: "note"; id: string };

/**
 * The tool or note this window pops out, or `null` for a regular project window.
 *
 * Rust registers which kind a popout is (ADR-11), so the window asks for both and takes
 * whichever answers (only one can). The first paint must never be gated on a command
 * that can fail or never answer: a rejected query renders the project window (and is
 * reported), and so does one that does not come back within [`POPOUT_QUERY_TIMEOUT_MS`]
 * — a blank window is not a useful failure mode, and on a wedged command it is otherwise
 * all the user ever sees.
 */
async function popoutTarget(): Promise<PopoutTarget | null> {
  const query = Promise.all([
    invoke<string | null>("popout_tool"),
    invoke<string | null>("popout_note"),
  ])
    .then(([tool, note]): PopoutTarget | null => {
      if (tool != null) return { kind: "tool", id: tool };
      if (note != null) return { kind: "note", id: note };
      return null;
    })
    .catch((err) => {
      reportStartupFailure("the popout query failed; rendering the project window", err);
      return null;
    });

  return Promise.race([
    query,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        reportStartupFailure(
          `the popout query did not answer within ${POPOUT_QUERY_TIMEOUT_MS}ms; rendering the project window`,
        );
        resolve(null);
      }, POPOUT_QUERY_TIMEOUT_MS),
    ),
  ]);
}
