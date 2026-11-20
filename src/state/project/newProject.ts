import { invoke } from "../../lib/ipc";
import { resetAnalysisParams } from "../analysis";
import { resetToolOptions } from "../analyzer";
import {
  recording,
  setChoice,
  setDeviceId,
  setTargetPid,
  stopCapture,
  stopMonitor,
} from "../capture";
import { resetGraph, setFilterEnabled } from "../graph";
import { resetAnnotations } from "../annotations";
import { closeSource } from "../source";
import { closeAllTools } from "../workbench";
import { resetProjectHistory } from "./push";
import {
  setCreatedMs,
  setProjectError,
  setProjectPath,
  setProjectTitle,
  setReferenceProject,
  setUpgradedFrom,
} from "./signals";

/** Start a fresh project: drop the source, graphs, setup, and Workbench tabs. */
export async function newProject(): Promise<void> {
  if (recording()) await stopCapture();
  await stopMonitor();
  // A new project replaces every view: close the old project's popouts before the reset,
  // so none can push the old UI state back (see `loadProject`).
  await invoke("close_popouts").catch((err) =>
    console.error("could not close the previous popouts", err),
  );
  // A new project has no saved comparisons (M25.C).
  await invoke("clear_compare_saved").catch((err) =>
    console.error("could not clear the saved comparisons", err),
  );

  await invoke("begin_project_baseline");
  setProjectError(null);
  closeAllTools();
  resetGraph("filter");
  resetGraph("synth");
  resetAnalysisParams();
  resetToolOptions();
  setFilterEnabled(true);
  closeSource();
  setChoice("file");
  setDeviceId(null);
  setTargetPid(null);
  setProjectPath(null);
  setProjectTitle(null);
  setCreatedMs(null);
  setReferenceProject(false);
  setUpgradedFrom(null);
  resetAnnotations();
  // Rebase the undo history on the fresh project, so it records no step and cannot step
  // back into the previous one.
  await resetProjectHistory();
  // Re-arm the dirty baseline once the resets have settled, so the fresh project is
  // clean but a later edit flags it again (mirrors `loadProject`).
  await invoke("end_project_baseline");
}
