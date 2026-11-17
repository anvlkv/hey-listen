import type { JSX } from "solid-js";
import LogView from "./components/log/LogView";
import "./App.css";

/**
 * The **log preview** window (ADR-33).
 *
 * A popout window (ADR-11) rather than a Workbench tab: the tab set is fixed to the graph
 * editors and the analyzer tabs (`docs/ui-layout.md`), and a modal would block the
 * interaction that produces the log. The window is opened from Help → Show Log… (handled
 * natively in the core) and is a singleton.
 *
 * Its **content** is app-wide; `LogView` polls the log file directly (§5 of
 * `docs/logging.md`), so it starts no project state and asks the core for no source.
 */
export default function LogApp(): JSX.Element {
  return (
    <div class="popout-shell" data-testid="log.window">
      <LogView />
    </div>
  );
}
