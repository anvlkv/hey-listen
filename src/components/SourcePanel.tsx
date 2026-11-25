import { createEffect, Show } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import LiveControls from "./source/LiveControls";
import LiveSourceInputs from "./source/LiveSourceInputs";
import SourceKindSelect from "./source/SourceKindSelect";
import StorageCards from "./source/StorageCards";
import SynthSourceControls from "./source/SynthSourceControls";
import Tooltip from "./Tooltip";
import { createNumberDrag } from "../lib/dragNumber";
import { openFileDialog, source } from "../state/source";
import { setStorage, sourceStorage, storageLabel, switchBlocked } from "../state/sourceStorage";
import { openTool } from "../state/workbench";
import {
  captureError,
  choice,
  recording,
  refreshProcesses,
  setStartDelay,
  setTargetDuration,
  sourcesError,
  startDelay,
  targetDuration,
} from "../state/capture";

/**
 * Sources rail (M43): chooses the project's audio source — file, mic, system, process,
 * mix, or synth — and holds the controls that produce it.
 *
 * It is a **Sidebar view** selected from the activity bar's pinned Sources tab, not a
 * fixed region of its own: the controls stack in the rail beside the Workbench, and the
 * Timeline below shows whatever this rail loads. The synth **Length / Render / Live**
 * controls live here too, so the graph is edited in the Workbench and rendered from the
 * rail.
 *
 * Controls are Kobalte primitives (`Select`, `Combobox`, `Slider`, `NumberField`,
 * `Meter`, `Button`); see ADR-8. The pieces live under `components/source/`. The capture
 * session's monitor lifecycle is owned by `state/capture/session.ts`, so switching
 * activity tabs never closes a live input.
 */
export default function SourcePanel() {
  let processesRequested = false;

  // Numeric timing fields also accept drag-to-adjust (M7).
  const startDrag = createNumberDrag({
    value: startDelay,
    onInput: (value) => setStartDelay(Math.max(0, Math.round(value))),
    step: 1,
    min: 0,
  });
  const stopDrag = createNumberDrag({
    value: targetDuration,
    onInput: (value) => setTargetDuration(Math.max(0, Math.round(value))),
    step: 1,
    min: 0,
  });

  // Fetch the process list the first time "Application" is selected. Capture
  // *devices* are never listed here: `ensureSession` requests them after the
  // monitoring session opens, because macOS refuses to enumerate inputs until that
  // session has answered the microphone consent prompt — asking earlier would show
  // an error while the prompt was still up.
  createEffect(() => {
    if (choice() === "process" && !processesRequested) {
      processesRequested = true;
      void refreshProcesses();
    }
  });

  /** Live kinds (mic/system/process/mix) expose gain, meter and record controls. */
  const liveKind = () => choice() !== "file" && choice() !== "synth";

  return (
    <div class="app-source" data-testid="region.source">
      <div class="src-heading">{source() ? "Replace source" : "Add audio"}</div>
      <Show when={!source()}>
        <span class="src-hero-hint">
          Open a file, record from a mic / system / application, or build a synth — it becomes the
          timeline.
        </span>
      </Show>

      <div class="src-controls">
        <Show when={!recording()}>
          <SourceKindSelect />

          <Show when={choice() === "file"}>
            <Tooltip label="Open audio file">
              <Button
                class="src-button icon-btn"
                aria-label="Open audio file"
                disabled={recording()}
                data-testid="source.openFile"
                onClick={() => void openFileDialog()}
              >
                <Icon name="folder-open" />
              </Button>
            </Tooltip>
            {/* How a save keeps this file's audio. The post-pick chooser decides it for
                the first open; here it can be switched (or frozen) while the source is
                loaded. A mode the current source cannot switch to shows why instead of
                disappearing. */}
            <Show when={source()}>
              <StorageCards
                value={sourceStorage()}
                onChange={setStorage}
                disabledReason={(mode) => switchBlocked(sourceStorage(), mode)}
                testIdPrefix="source.storage"
              />
            </Show>
          </Show>

          <Show when={choice() === "synth"}>
            <Button class="src-button" onClick={() => openTool("synth")}>
              Open synth graph…
            </Button>
            <SynthSourceControls />
          </Show>

          <LiveSourceInputs />
        </Show>

        <Show when={liveKind()}>
          <LiveControls startDrag={startDrag} stopDrag={stopDrag} />
        </Show>
      </div>

      {/* The summary and the error are separate facts: an error about a capture attempt must
          not hide which source the project holds — or how it will be stored. */}
      <Show when={source()}>
        {(s) => (
          <div
            class="source-summary"
            data-testid="source.summary"
            title={s().probe?.path ?? s().name}
          >
            <span class="source-name">
              {s().name}
              {s().live ? " ●" : ""}
            </span>
            <span class="source-meta">
              {s().detail} · {s().sampleRate} Hz · {s().channels} ch
            </span>
            {/* Synth and capture sources are always embedded, so only a file says how. */}
            <Show when={choice() === "file"}>
              <span class="source-storage-badge" data-testid="source.storage.badge">
                {storageLabel(sourceStorage())}
                {sourceStorage() === "liveLink" ? " · watching" : ""}
              </span>
            </Show>
          </div>
        )}
      </Show>

      {/* A capture/enumeration error belongs to a live input. A file or synth source shows
          the summary alone: a failure from an earlier capture attempt must not follow the
          project into a source that cannot capture anything. */}
      <Show when={liveKind() ? (captureError() ?? sourcesError()) : null}>
        {(message) => (
          <div class="src-error" data-testid="source.error" title={message()}>
            {message()}
          </div>
        )}
      </Show>
    </div>
  );
}
