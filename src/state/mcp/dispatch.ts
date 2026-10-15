import { deepClone } from "../../lib/clone";
import { invoke } from "../../lib/ipc";
import { previewRegion, previewSpeed, stop as stopPreviewAudio } from "../../audio/preview";
import { applySharedParams, sharedParams, type SharedParamsDto } from "../analysis";
import { ANALYZERS, isAnalyzerId, setToolOption, toolOptions, type AnalyzerId } from "../analyzer";
import {
  applyGain,
  recording,
  setChoice,
  setDeviceId,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setTargetPid,
  startCapture,
  stopCapture,
  type SourceChoice,
} from "../capture";
import {
  filterEnabled,
  filterError,
  flushFilterGraph,
  graphLayout,
  loadGraph,
  setFilterEnabled,
  type GraphLayout,
} from "../graph";
import {
  createNote,
  deleteNote,
  focusedNoteId,
  noteById,
  notesSorted,
  setFocusedNote,
  updateNote,
  type NotePatch,
} from "../notes";
import { applyOutputGain, outputGain } from "../output";
import {
  dirty,
  loadProject,
  newProject,
  projectDisplayName,
  projectPath,
  saveProject,
  saveProjectTo,
} from "../project";
import { closeSource, openPath } from "../source";
import { renderSynth } from "../synth";
import { setView, windowEnd, windowStart } from "../timeline";
import {
  activeThemeId,
  exportThemeFile,
  importThemeFile,
  isBuiltinTheme,
  listThemeSummaries,
  setThemePreference,
  themeById,
  themePreference,
  type ThemeMode,
  type ThemePreference,
} from "../themes";
import { dockApi, openTool, openTools } from "../workbench";
import { clampSet, runAnalysis, setAnalysisWindow } from "./analyze";
import {
  applyNullable,
  applyPid,
  analyzerId,
  asArgs,
  bool,
  graphKind,
  num,
  optionalBool,
  optionalNum,
  optionalStr,
  rangeArg,
  requireNote,
  slotThemeId,
  str,
  toolId,
  type Args,
} from "./args";
import { getState, sourceSummary } from "./inspect";

/** Dispatch one tool by name. Throws (bubbled to the agent) on failure. */
export async function run(tool: string, args: Args, target?: string): Promise<unknown> {
  switch (tool) {
    case "get_state":
      return getState(target);
    case "list_analyzers":
      return ANALYZERS.map((def) => ({
        id: def.id,
        title: def.title,
        description: def.description,
        section: def.section,
        keywords: def.keywords,
      }));

    // --- source -------------------------------------------------------------
    case "open_audio_file":
      await openPath(str(args, "path"), !optionalBool(args, "replace"));
      return sourceSummary();
    case "close_source":
      closeSource();
      return { source: null };
    case "render_synth":
      await renderSynth(optionalNum(args, "seconds") ?? 5, !optionalBool(args, "replace"));
      return sourceSummary();

    // --- analysis -----------------------------------------------------------
    case "run_analysis":
      return runAnalysis(args);
    case "set_analysis_window": {
      const span = setAnalysisWindow(num(args, "start"), num(args, "end"));
      return { window: span };
    }
    case "set_view": {
      const span = clampSet(num(args, "start"), num(args, "end"), setView);
      return { view: span };
    }
    case "set_shared_params":
      applySharedParams(asArgs(args.params) as Partial<SharedParamsDto>);
      return { params: sharedParams() };
    case "set_tool_options": {
      const id = analyzerId(args);
      for (const [key, value] of Object.entries(asArgs(args.options))) {
        if (typeof value === "number") setToolOption(id, key, value);
      }
      return { tool: id, options: deepClone(toolOptions[id]) };
    }

    // --- workbench ----------------------------------------------------------
    case "open_tool":
      await openTool(toolId(str(args, "tool")));
      return { openTools: openTools() };
    case "close_tool": {
      const id = toolId(str(args, "tool"));
      dockApi()?.getPanel(id)?.api.close();
      return { openTools: openTools() };
    }

    // --- graphs -------------------------------------------------------------
    case "get_graph":
      return { graph: str(args, "graph"), layout: deepClone(graphLayout(graphKind(args))) };
    case "set_filter_graph": {
      if ("graph" in args) {
        const graph = args.graph;
        if (graph === null) loadGraph("filter", undefined);
        else loadGraph("filter", asArgs(graph) as Partial<GraphLayout>);
      }
      if ("enabled" in args) setFilterEnabled(bool(args, "enabled"));
      await flushFilterGraph();
      return { enabled: filterEnabled(), error: filterError() };
    }
    case "set_synth_graph":
      loadGraph("synth", asArgs(args.graph) as Partial<GraphLayout>);
      return { layout: deepClone(graphLayout("synth")) };

    // --- playback -----------------------------------------------------------
    case "preview": {
      const start = optionalNum(args, "start") ?? windowStart();
      const end = optionalNum(args, "end") ?? windowEnd();
      previewRegion(start, end, optionalBool(args, "loop") ?? true, optionalNum(args, "speed"));
      return { start, end, speed: previewSpeed() };
    }
    case "stop_preview":
      stopPreviewAudio();
      return { playing: false };
    case "set_output_gain":
      applyOutputGain(num(args, "gain"));
      return { gain: outputGain() };

    // --- enumeration --------------------------------------------------------
    case "list_output_devices":
      return invoke("list_output_devices");
    case "list_input_devices":
      return invoke("list_devices");
    case "list_processes":
      return invoke("list_processes");

    // --- capture ------------------------------------------------------------
    case "start_capture": {
      const kind = str(args, "kind");
      if (!["mic", "system", "process", "mix"].includes(kind)) {
        throw new Error(`unknown capture kind: ${kind}`);
      }
      setChoice(kind as SourceChoice);
      applyNullable(args, "deviceId", setDeviceId);
      applyNullable(args, "mixMicDeviceId", setMixMicDeviceId);
      applyNullable(args, "mixSystemDeviceId", setMixSystemDeviceId);
      applyPid(args, "targetPid", setTargetPid);
      if (optionalNum(args, "gain") != null) await applyGain(num(args, "gain"));
      await startCapture();
      return { recording: recording() };
    }
    case "stop_capture":
      await stopCapture();
      return { recording: recording() };

    // --- project ------------------------------------------------------------
    case "save_project": {
      const path = optionalStr(args, "path");
      if (path) {
        const ok = await saveProjectTo(path);
        if (!ok) throw new Error("could not save the project");
      } else {
        await saveProject();
      }
      return { path: projectPath(), name: projectDisplayName(), dirty: dirty() };
    }
    case "open_project":
      await loadProject(str(args, "path"));
      return getState();
    case "new_project":
      await newProject();
      return getState();

    // --- notes (app-only; a note lives in a project) ------------------------
    case "list_notes":
      return { notes: notesSorted() };
    case "get_note":
      return { note: requireNote(str(args, "id")) };
    case "create_note": {
      const tool = optionalStr(args, "tool");
      if (tool && !isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
      const note = createNote({
        timeSecs: num(args, "time"),
        range: "range" in args ? rangeArg(args.range) : null,
        tool: (tool as AnalyzerId | null) ?? null,
        title: optionalStr(args, "title"),
        body: typeof args.body === "string" ? args.body : "",
        // The tool creates data, it does not steal the UI focus (use set_focused_note).
        focus: false,
      });
      return { note };
    }
    case "update_note": {
      const id = str(args, "id");
      requireNote(id);
      const patch: NotePatch = {};
      if ("title" in args) patch.title = optionalStr(args, "title");
      if ("body" in args) {
        if (typeof args.body !== "string") throw new Error("`body` must be a string");
        patch.body = args.body;
      }
      if ("time" in args) patch.timeSecs = num(args, "time");
      if ("range" in args) patch.range = rangeArg(args.range);
      if ("tool" in args) {
        const tool = optionalStr(args, "tool");
        if (tool && !isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
        patch.tool = (tool as AnalyzerId | null) ?? null;
      }
      if (optionalBool(args, "recomputeValues")) patch.recomputeValues = true;
      return { note: updateNote(id, patch) };
    }
    case "delete_note": {
      const id = str(args, "id");
      deleteNote(id);
      return { id };
    }
    case "set_focused_note": {
      const id = optionalStr(args, "id");
      if (id && !noteById(id)) throw new Error(`unknown note: ${id}`);
      setFocusedNote(id);
      return { focusedNoteId: focusedNoteId() };
    }

    // --- themes (app chrome) ------------------------------------------------
    case "list_themes":
      return {
        themes: listThemeSummaries(),
        active: { ...themePreference(), activeId: activeThemeId() },
      };
    case "get_theme": {
      const id = optionalStr(args, "id") ?? activeThemeId();
      const theme = themeById(id);
      if (!theme) throw new Error(`unknown theme: ${id}`);
      return {
        theme: deepClone(theme),
        builtin: isBuiltinTheme(id),
        active: { ...themePreference(), activeId: activeThemeId() },
      };
    }
    case "set_theme": {
      const patch: Partial<ThemePreference> = {};
      if ("mode" in args) {
        const mode = str(args, "mode");
        if (!["auto", "dark", "light"].includes(mode)) {
          throw new Error(`unknown theme mode: ${mode}`);
        }
        patch.mode = mode as ThemeMode;
      }
      if ("darkThemeId" in args) patch.darkThemeId = slotThemeId(args, "darkThemeId");
      if ("lightThemeId" in args) patch.lightThemeId = slotThemeId(args, "lightThemeId");
      setThemePreference(patch);
      return { ...themePreference(), activeId: activeThemeId() };
    }
    case "import_theme":
      return { theme: await importThemeFile(str(args, "path")) };
    case "export_theme": {
      const id = optionalStr(args, "id") ?? activeThemeId();
      const path = str(args, "path");
      await exportThemeFile(id, path);
      return { id, path };
    }

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}
