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
import { resetHistory } from "../history";
import { resetNotes } from "../notes";
import { closeSource } from "../source";
import { closeAllTools } from "../workbench";
import { beginBaseline, endBaseline } from "./dirty";
import { setCreatedMs, setProjectError, setProjectPath, setProjectTitle } from "./signals";

/** Start a fresh project: drop the source, graphs, setup, and Workbench tabs. */
export async function newProject(): Promise<void> {
  if (recording()) await stopCapture();
  await stopMonitor();
  // A new project replaces every view: close the old project's popouts before the reset,
  // so none can push the old UI state back (see `loadProject`).
  await invoke("close_popouts").catch((err) =>
    console.error("could not close the previous popouts", err),
  );

  beginBaseline();
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
  resetNotes();
  resetHistory();
  // Re-arm the dirty baseline once the resets have settled, so the fresh project is
  // clean but a later edit flags it again (mirrors `loadProject`).
  endBaseline();
}
