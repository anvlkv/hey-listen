/**
 * The command-registry shapes. M24.A shipped this seam with undo/redo as its first
 * commands; M24.B fills the
 * registry (palette, shortcuts dialog, rebinding).
 */

/** The region a command belongs to. */
export type CommandScope = "global" | "timeline" | "workbench" | "graph" | "annotations" | "dialog";

/**
 * A command id. Ids are **typed**, never arbitrary strings (ADR-28): adding a command
 * means extending this union, not passing a literal around.
 */
export type CommandId =
  | "undo"
  | "redo"
  | "transport.playPause"
  | "transport.stop"
  | "transport.loop"
  | "transport.seekBack"
  | "transport.seekForward"
  | "transport.seekBack10x"
  | "transport.seekForward10x"
  | "transport.seekFrameBack"
  | "transport.seekFrameForward"
  | "transport.returnToStart"
  | "transport.jumpToEnd"
  | "transport.windowPrevious"
  | "transport.windowNext"
  | "transport.setWindowStartHere"
  | "transport.setWindowEndHere"
  | "transport.followPlayhead"
  | "timeline.zoomToWindow"
  | "timeline.fitAll"
  | "timeline.zoomIn"
  | "timeline.zoomOut"
  | "annotations.addAtPlayhead"
  | "annotations.togglePanel"
  | "annotations.analyzeSelected"
  | "annotations.editSelected"
  | "annotations.deleteSelected"
  | "navigate.commandPalette"
  | "navigate.keyboardShortcuts"
  | "navigate.nextRegion"
  | "navigate.previousRegion"
  | "navigate.focusAnalyzerSearch"
  | "navigate.nextWorkbenchTab"
  | "navigate.previousWorkbenchTab"
  | "navigate.activateWorkbenchTab1"
  | "navigate.activateWorkbenchTab2"
  | "navigate.activateWorkbenchTab3"
  | "navigate.activateWorkbenchTab4"
  | "navigate.activateWorkbenchTab5"
  | "navigate.activateWorkbenchTab6"
  | "navigate.activateWorkbenchTab7"
  | "navigate.activateWorkbenchTab8"
  | "navigate.activateWorkbenchTab9"
  | "graph.renderSynth";

/** A binding string in portable spelling (`Mod+Shift+K`), or `null` = intentionally unbound. */
export type Binding = string | null;

/** One command: the single declaration the dispatcher and (from M24.B) the palette read. */
export interface CommandDef {
  id: CommandId;
  title: string;
  category: "Transport" | "Timeline" | "Navigate" | "Annotations" | "Graph" | "App";
  scope: CommandScope;
  /** Whether the command is available right now; `false` leaves the key unclaimed. */
  when?: () => boolean;
  run: () => void | Promise<void>;
  /** Fire while a text field has focus (default `false` — see the docs' "Guards"). */
  allowInInput?: boolean;
  /** Fire on held-key repeats (default `false`). */
  allowRepeat?: boolean;
  /** Extra palette search terms. */
  keywords?: string[];
}
