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

  beginBaseline();
  setProjectError(null);
  closeAllTools();
  // A popout is a view of *this* window's project, so the previous project's windows would
  // now show the fresh one. Close them with the tabs.
  void invoke("sync_popouts", { tools: [] }).catch(() => {});
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
