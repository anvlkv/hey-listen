import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Listen to an event **addressed to this window**.
 *
 * Tauri matches a listener's own target *before* applying the emit's target filter
 * (`match_any_or_filter` in `tauri/src/event/listener.rs`), so a listener registered with
 * the API's default `{ kind: "Any" }` also receives every `emit_to(other_label, …)`. That
 * is invisible with one project window, but with several it makes a `ui-state` patch, a
 * File/Edit menu action, an MCP request, or a capture-status event for one project run in
 * every *other* project's window too.
 *
 * Registering this window's label as the target restores the scoping the core intends:
 * an emit for another label no longer matches, while a **global** `app.emit` still reaches
 * every listener (an unfiltered emit matches any target). See `docs/architecture.md`
 * (ADR-11) and the R spec in `docs/testing.md`.
 */
export function listenThisWindow<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, handler, {
    target: { kind: "WebviewWindow", label: getCurrentWindow().label },
  });
}
