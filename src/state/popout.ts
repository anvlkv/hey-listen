import { createSignal } from "solid-js";
import { invoke } from "../lib/ipc";
import { parseSystemScope } from "../lib/graph";
import { isAnalyzerId } from "./analyzer/lookup";
import { subsystems, type SubsystemScope } from "./subsystems";
import { dockApi } from "./dockApi";
import { TOOLS } from "./tools";

/**
 * Popped-out views (M7): what a Workbench panel **is** (a tool tab or a subsystem), and
 * how a tab moves into a native window of its own.
 *
 * A popout is a *view* of the project (ADR-11), not a project: the core aliases its
 * window to the parent's, so it shows the same source and edits the same graphs. This
 * module names those views and asks the core to open one; the tab registry
 * (`state/workbench.ts`) owns the tab itself.
 */

/** Whether a panel id is a subsystem tab (`system:<parent>/<node>`). */
export function isSystemPanel(id: string): boolean {
  return parseSystemScope(id) != null;
}

/** Whether a Workbench panel can live in its own window: a tool tab, or a subsystem. */
export function isPopoutView(id: string): boolean {
  return TOOLS.some((tool) => tool.id === id) || isSystemPanel(id);
}

/** Whether a view is a graph editor: a tool that is not an analyzer, or a subsystem. */
export function isGraphView(view: string | undefined): boolean {
  if (view == null) return false;
  if (isSystemPanel(view)) return true;
  return TOOLS.some((tool) => tool.id === view) && !isAnalyzerId(view);
}

/** A subsystem tab's window title: its user name, or a plain fallback when it is gone. */
export function systemTitle(scope: SubsystemScope): string {
  const system = subsystems().find((item) => item.scope === scope);
  return system ? `Subsystem · ${system.label}` : "Subsystem";
}

/** A popout view's window title: a tool's title, or the subsystem's own title. */
export function viewTitle(view: string): string {
  const tool = TOOLS.find((item) => item.id === view);
  if (tool) return tool.title;
  return isSystemPanel(view) ? systemTitle(view as SubsystemScope) : view;
}

/**
 * The views popped out of this window's project, as the core reports them.
 *
 * A project window keeps this current so a window-scoped workflow can tell its editor is
 * open in another window — the synth **Live** scheduler keeps rendering while the synth
 * editor is popped out (it is the project window that adopts the rendered source).
 */
export const [poppedViews, setPoppedViews] = createSignal<string[]>([]);

/** Refresh [`poppedViews`] from the core. */
export async function refreshPoppedViews(): Promise<void> {
  setPoppedViews(await invoke<string[]>("popout_tools").catch(() => []));
}

/**
 * Pop a Workbench view out into its own window: a tool tab (`filter`, `synth`, an
 * analyzer) or a subsystem tab (`system:<parent>/<node>`, M40).
 *
 * Only Tauri/wry manage windows — the UI just renders data — so this asks the core to
 * open a native window that shows the single view, then removes the tab from the main
 * grid. The popout window's label is aliased to this window's project state, so it
 * analyses the same source and edits the same graphs.
 */
export async function popoutView(view: string) {
  try {
    await invoke("open_popout_window", { view });
    dockApi()?.getPanel(view)?.api.close();
    void refreshPoppedViews();
  } catch (err) {
    console.error("could not pop out view", err);
  }
}
