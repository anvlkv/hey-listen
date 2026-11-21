import {
  pause,
  playWindow,
  resume,
  returnToStart,
  seek,
  setTransportLoop,
  stop,
  transportLoop,
  transportPosition,
  transportStatus,
} from "../../audio/preview";
import { toggleTransportFollow } from "../../audio/transportFollow";
import { nudgeStep } from "../../components/timeline/announce";
import { invoke } from "../../lib/ipc";
import {
  analyzeAnnotation,
  annotations,
  createAnnotation,
  defaultAnnotationTool,
  deleteAnnotation,
  selectNextAnnotation,
  selectPreviousAnnotation,
  selectedAnnotationId,
  setEditingAnnotationId,
} from "../annotations";
import { sidebarOpen } from "../activityBar";
import { canRedo, canUndo } from "../project/push";
import { toggleAnnotationsPanel } from "../settings";
import { focusAnalyzerSearch } from "../sidebarSearch";
import { source } from "../source";
import { renderSynth, rendering } from "../synth";
import { setWindowEnd, setWindowStart, viewEnd, viewStart } from "../timeline";
import { fitAll, zoomIn, zoomOut, zoomToWindow } from "../timelineView";
import { announcePlayhead } from "../timelineAnnounce";
import { nextWindow, previousWindow } from "../windowHistory";
import { cycleWorkbenchTab, openTool, openTools } from "../workbench";
import { openCommandPalette, openShortcutsWindow } from "./dialogs";
import type { CommandDef, CommandId } from "./types";

/**
 * The command registry ([`hotkeys.md`](../../../docs/hotkeys.md) → "Command model").
 *
 * Each command is declared once here; the dispatcher reads its binding from the store
 * (`DEFAULT_BINDINGS` merged with user overrides), so bindings are never duplicated in
 * this file. Commands call store/action functions rather than components, so the registry
 * stays testable without the shell.
 */

/** Whether a source is open; every transport and timeline command needs one. */
const hasSource = () => source() != null;

/** Whether an annotation is selected; the annotation-scope commands need one. */
const hasSelection = () => selectedAnnotationId() != null;

/** Seek by `steps` nudge steps (1% of the visible span each), then announce. */
function seekSteps(steps: number) {
  seek(transportPosition() + nudgeStep(viewEnd() - viewStart()) * steps);
  announcePlayhead();
}

/** Seek by `frames` sample frames (negative seeks back), then announce. */
function seekFrames(frames: number) {
  seek(transportPosition() + frames / (source()?.sampleRate ?? 1));
  announcePlayhead();
}

/** A history step: enabled only when the core has somewhere to step. */
function historyStep(id: "undo" | "redo", title: string, enabled: () => boolean): CommandDef {
  return {
    id,
    title,
    category: "App",
    scope: "global",
    when: enabled,
    run: () => void invoke(id).catch((err) => console.error(`could not run ${id}`, err)),
    allowInInput: false,
    allowRepeat: false,
  };
}

/** Optional overrides for a transport command. */
interface TransportOptions {
  when?: () => boolean;
  allowRepeat?: boolean;
}

/** A `global`, source-gated transport command. */
function transport(
  id: CommandId,
  title: string,
  run: () => void,
  options: TransportOptions = {},
): CommandDef {
  return {
    id,
    title,
    category: "Transport",
    scope: "global",
    when: options.when ?? hasSource,
    run,
    allowRepeat: options.allowRepeat ?? false,
  };
}

/** A `global`, source-gated timeline (view) command. */
function timelineCommand(id: CommandId, title: string, run: () => void): CommandDef {
  return { id, title, category: "Timeline", scope: "global", when: hasSource, run };
}

/** An `annotations`-scope command that acts on the selected annotation. */
function annotationCommand(id: CommandId, title: string, run: () => void): CommandDef {
  return { id, title, category: "Annotations", scope: "annotations", when: hasSelection, run };
}

/** A `global` navigate command. */
function navigate(id: CommandId, title: string, run: () => void): CommandDef {
  return { id, title, category: "Navigate", scope: "global", run };
}

/** The nine "activate Workbench tab N" ids, in tab order. */
const ACTIVATE_TAB_IDS = [
  "navigate.activateWorkbenchTab1",
  "navigate.activateWorkbenchTab2",
  "navigate.activateWorkbenchTab3",
  "navigate.activateWorkbenchTab4",
  "navigate.activateWorkbenchTab5",
  "navigate.activateWorkbenchTab6",
  "navigate.activateWorkbenchTab7",
  "navigate.activateWorkbenchTab8",
  "navigate.activateWorkbenchTab9",
] as const satisfies readonly CommandId[];

/** Activate the Workbench tab at `index` (0-based) when one is open there. */
function activateWorkbenchTab(id: CommandId, index: number): CommandDef {
  return navigate(id, `Activate Workbench tab ${index + 1}`, () => {
    const target = openTools()[index];
    if (target) void openTool(target);
  });
}

export const COMMANDS: CommandDef[] = [
  historyStep("undo", "Undo", canUndo),
  historyStep("redo", "Redo", canRedo),

  transport("transport.playPause", "Play / Pause", () => {
    const status = transportStatus();
    if (status === "playing") pause();
    else if (status === "paused") resume();
    else playWindow();
  }),
  transport("transport.stop", "Stop", () => stop()),
  transport("transport.loop", "Loop", () => setTransportLoop(!transportLoop())),
  transport("transport.seekBack", "Seek back", () => seekSteps(-1), { allowRepeat: true }),
  transport("transport.seekForward", "Seek forward", () => seekSteps(1), { allowRepeat: true }),
  transport("transport.seekBack10x", "Seek back 10×", () => seekSteps(-10), { allowRepeat: true }),
  transport("transport.seekForward10x", "Seek forward 10×", () => seekSteps(10), {
    allowRepeat: true,
  }),
  transport("transport.seekFrameBack", "Seek one frame back", () => seekFrames(-1), {
    allowRepeat: true,
  }),
  transport("transport.seekFrameForward", "Seek one frame forward", () => seekFrames(1), {
    allowRepeat: true,
  }),
  transport("transport.returnToStart", "Return to start", () => {
    returnToStart();
    announcePlayhead();
  }),
  transport("transport.jumpToEnd", "Jump to end", () => {
    seek(source()?.duration ?? 0);
    announcePlayhead();
  }),
  transport("transport.windowPrevious", "Previous analysis window", () => previousWindow()),
  transport("transport.windowNext", "Next analysis window", () => nextWindow()),
  transport("transport.setWindowStartHere", "Set window start at playhead", () =>
    setWindowStart(transportPosition()),
  ),
  transport("transport.setWindowEndHere", "Set window end at playhead", () =>
    setWindowEnd(transportPosition()),
  ),
  transport("transport.followPlayhead", "Toggle follow playhead", () => toggleTransportFollow()),

  timelineCommand("timeline.zoomToWindow", "Zoom to window", () => zoomToWindow()),
  timelineCommand("timeline.fitAll", "Fit all", () => fitAll()),
  timelineCommand("timeline.zoomIn", "Zoom in", () => zoomIn()),
  timelineCommand("timeline.zoomOut", "Zoom out", () => zoomOut()),

  {
    id: "annotations.addAtPlayhead",
    title: "Add annotation at playhead",
    category: "Annotations",
    scope: "global",
    when: hasSource,
    run: () => {
      createAnnotation({ timeSecs: transportPosition(), tool: defaultAnnotationTool() });
    },
  },
  {
    id: "annotations.togglePanel",
    title: "Toggle Annotations panel",
    category: "Annotations",
    scope: "global",
    run: () => toggleAnnotationsPanel(),
  },
  annotationCommand("annotations.analyzeSelected", "Analyze selected annotation", () => {
    const id = selectedAnnotationId();
    if (id) analyzeAnnotation(id);
  }),
  annotationCommand("annotations.editSelected", "Edit selected annotation", () => {
    const id = selectedAnnotationId();
    if (id) setEditingAnnotationId(id);
  }),
  annotationCommand("annotations.deleteSelected", "Delete selected annotation", () => {
    const id = selectedAnnotationId();
    if (id) deleteAnnotation(id);
  }),

  {
    ...navigate("navigate.commandPalette", "Command palette", () => openCommandPalette()),
    allowInInput: true,
  },
  navigate("navigate.keyboardShortcuts", "Keyboard shortcuts", () => openShortcutsWindow()),
  {
    ...navigate("navigate.nextRegion", "Select next annotation", () => selectNextAnnotation()),
    when: () => annotations().length > 0,
  },
  {
    ...navigate("navigate.previousRegion", "Select previous annotation", () =>
      selectPreviousAnnotation(),
    ),
    when: () => annotations().length > 0,
  },
  {
    ...navigate("navigate.focusAnalyzerSearch", "Focus analyzer search", () =>
      focusAnalyzerSearch(),
    ),
    when: () => sidebarOpen(),
  },
  navigate("navigate.nextWorkbenchTab", "Next Workbench tab", () => cycleWorkbenchTab(1)),
  navigate("navigate.previousWorkbenchTab", "Previous Workbench tab", () => cycleWorkbenchTab(-1)),
  ...ACTIVATE_TAB_IDS.map((id, index) => activateWorkbenchTab(id, index)),

  {
    id: "graph.renderSynth",
    title: "Render synth",
    category: "Graph",
    scope: "graph",
    when: () => !rendering(),
    run: () => void renderSynth(5),
  },
];
