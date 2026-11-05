import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Which kind of window this webview is.
 *
 * - `main` / `project-*` — a project window: the full app, its own project.
 * - `popout-*` / `annotation-*` / `compare-*` — a view of a project, showing one tool,
 *   one annotation, or one comparison in its own window.
 *
 * The label is available synchronously from the Tauri API, so this is a plain
 * constant (no async round-trip).
 */
export const windowLabel = getCurrentWindow().label;

/** A project window (the shell with its own source), as opposed to a view popout. */
export const isProjectWindow = windowLabel === "main" || windowLabel.startsWith("project-");

/** A popped-out tool/annotation/comparison view (`isProjectWindow` is false). */
export const isPopoutWindow = !isProjectWindow;
