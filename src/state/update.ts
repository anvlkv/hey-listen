import { Channel } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { createSignal } from "solid-js";
import type { DownloadEvent } from "../bindings/DownloadEvent";
import type { UpdateMetadata } from "../bindings/UpdateMetadata";
import { invoke, errorMessage } from "../lib/ipc";

/** Where a self-update stands (M33.C). See `docs/updater.md` and ADR-30. */
export type UpdatePhase =
  | "idle" // nothing asked yet
  | "checking" // asking the feed
  | "upToDate" // the feed has nothing newer
  | "available" // offered, waiting for the user
  | "downloading"
  | "ready"; // installed; restart to run it

export interface UpdateState {
  phase: UpdatePhase;
  /** The offered update, kept from `available` until it installs. */
  update: UpdateMetadata | null;
  /** Bytes received, and the total when the server announces it. */
  received: number;
  total: number | null;
  /** Why the last check or install failed; cleared when the next one starts. */
  error: string | null;
}

const IDLE: UpdateState = { phase: "idle", update: null, received: 0, total: null, error: null };

/**
 * The self-update state the About dialog renders.
 *
 * The frontend drives **one** path: the core's `check_update` keeps the offered update,
 * `install_update` downloads and installs it (streaming `Started` / `Progress` /
 * `Finished` over a channel), and `restartToUpdate` relaunches into the new build.
 * Nothing installs silently — the dialog asks first, and a CLI invocation never reaches
 * the feed because the core registers the updater plugin for the GUI only.
 */
const [updateState, setUpdateState] = createSignal<UpdateState>(IDLE);

export { updateState };

/** Ask the feed for a newer build; the dialog shows the answer. */
export async function checkForUpdates(): Promise<void> {
  const phase = updateState().phase;
  if (phase === "checking" || phase === "downloading") return;

  setUpdateState({ ...IDLE, phase: "checking" });
  try {
    const update = await invoke<UpdateMetadata | null>("check_update");
    setUpdateState({ ...IDLE, phase: update ? "available" : "upToDate", update });
  } catch (err) {
    setUpdateState({ ...IDLE, error: errorMessage(err) });
  }
}

/** Download and install the offered update — only on an explicit user click. */
export async function installUpdate(): Promise<void> {
  const { update, phase } = updateState();
  if (!update || phase === "downloading") return;

  const onEvent = new Channel<DownloadEvent>();
  onEvent.onmessage = (event) => {
    switch (event.event) {
      case "Started":
        setUpdateState((state) => ({
          ...state,
          phase: "downloading",
          received: 0,
          total: event.data.contentLength,
        }));
        break;
      case "Progress":
        setUpdateState((state) => ({
          ...state,
          received: state.received + event.data.chunkLength,
        }));
        break;
      case "Finished":
        break;
    }
  };

  setUpdateState({ ...IDLE, phase: "downloading", update });
  try {
    await invoke<void>("install_update", { onEvent });
    setUpdateState({ ...IDLE, phase: "ready", update });
  } catch (err) {
    // The core keeps the offer pending, so the install button is ready for another try.
    setUpdateState({ ...IDLE, phase: "available", update, error: errorMessage(err) });
  }
}

/** Restart into the installed build (macOS/Linux; Windows restarts itself). */
export async function restartToUpdate(): Promise<void> {
  await relaunch();
}
