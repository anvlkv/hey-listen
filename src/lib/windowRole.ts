import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Which kind of window this webview is.
 *
 * - `main` / `project-*` — a project window: the full app, its own project.
 * - `popout-*` — a popped-out tab: a view of a project, showing one tool.
 *
 * The label is available synchronously from the Tauri API, so this is a plain
 * constant (no async round-trip).
 */
export const windowLabel = getCurrentWindow().label;
export const isPopoutWindow = windowLabel.startsWith("popout-");
