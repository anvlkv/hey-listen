import type { CommandId } from "./types";

/**
 * The default binding table. Portable spelling: `Mod` is ⌘ on macOS and Ctrl
 * elsewhere, `Alt` is Option
 * on macOS. `null` means intentionally unbound.
 *
 * This is the fallback the store merges user overrides over; a stored value replaces the
 * entry, a missing one falls back to this table.
 */
export const DEFAULT_BINDINGS: Record<CommandId, string | null> = {
  undo: "Mod+Z",
  redo: "Shift+Mod+Z",

  "transport.playPause": "Space",
  "transport.stop": "Shift+Space",
  "transport.loop": "L",
  "transport.seekBack": "ArrowLeft",
  "transport.seekForward": "ArrowRight",
  "transport.seekBack10x": "Shift+ArrowLeft",
  "transport.seekForward10x": "Shift+ArrowRight",
  "transport.seekFrameBack": "Alt+ArrowLeft",
  "transport.seekFrameForward": "Alt+ArrowRight",
  "transport.returnToStart": "Home",
  "transport.jumpToEnd": "End",
  "transport.windowPrevious": "PageUp",
  "transport.windowNext": "PageDown",
  "transport.setWindowStartHere": "[",
  "transport.setWindowEndHere": "]",
  "transport.followPlayhead": "F",

  "timeline.zoomToWindow": "Z",
  "timeline.fitAll": "0",
  "timeline.zoomIn": "=",
  "timeline.zoomOut": "-",

  "annotations.addAtPlayhead": "N",
  "annotations.togglePanel": "Mod+Shift+A",
  "annotations.analyzeSelected": "Mod+Enter",
  "annotations.editSelected": "E",
  "annotations.deleteSelected": "Mod+Backspace",

  "navigate.commandPalette": "Mod+K",
  "navigate.keyboardShortcuts": "?",
  "navigate.nextRegion": "F6",
  "navigate.previousRegion": "Shift+F6",
  "navigate.focusAnalyzerSearch": "Mod+Shift+F",
  "navigate.nextWorkbenchTab": "Ctrl+Tab",
  "navigate.previousWorkbenchTab": "Ctrl+Shift+Tab",
  "navigate.activateWorkbenchTab1": "Mod+1",
  "navigate.activateWorkbenchTab2": "Mod+2",
  "navigate.activateWorkbenchTab3": "Mod+3",
  "navigate.activateWorkbenchTab4": "Mod+4",
  "navigate.activateWorkbenchTab5": "Mod+5",
  "navigate.activateWorkbenchTab6": "Mod+6",
  "navigate.activateWorkbenchTab7": "Mod+7",
  "navigate.activateWorkbenchTab8": "Mod+8",
  "navigate.activateWorkbenchTab9": "Mod+9",

  "graph.renderSynth": "Mod+Enter",
};
