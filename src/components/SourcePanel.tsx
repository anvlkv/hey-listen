import { createEffect, on, onCleanup, Show } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import LiveControls from "./source/LiveControls";
import LiveSourceInputs from "./source/LiveSourceInputs";
import SourceKindSelect from "./source/SourceKindSelect";
import StorageCards from "./source/StorageCards";
import Tooltip from "./Tooltip";
import { createNumberDrag } from "../lib/dragNumber";
import { openFileDialog, source } from "../state/source";
import { setStorage, sourceStorage, storageLabel, switchBlocked } from "../state/sourceStorage";
import { openTool } from "../state/workbench";
import {
  captureError,
  choice,
  deviceId,
  mixMicDeviceId,
  mixSystemDeviceId,
  recording,
  refreshProcesses,
  setStartDelay,
  setTargetDuration,
  sourcesError,
  startDelay,
  startMonitor,
  stopMonitor,
  targetDuration,
  targetPid,
} from "../state/capture";

/**
 * Source picker (fixed region): chooses the project's audio source — file, mic,
 * system, process, or mix — and (for live sources) holds the capture controls.
 *
 * When there is no source yet the whole bottom row is a compact, horizontal
 * "Add audio" strip; once a source exists (or while
 * recording) the panel is the narrow left-hand column beside the timeline. Both
 * layouts show the *same* controls — the strip is a two-column grid (copy, then a
 * grid of controls with usable minimum widths).
 *
 * Controls are Kobalte primitives (`Select`, `Combobox`, `Slider`, `NumberField`,
 * `Meter`, `Button`); see ADR-8. The pieces live under `components/source/`.
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

  // The panel is hidden once a source exists (see `App.tsx`), so release the live
  // capture session on unmount — a hidden panel should not hold the microphone open.
  onCleanup(() => {
    void stopMonitor();
  });

  // Fetch the process list the first time "Application" is selected. Capture
  // *devices* are never listed here: `ensureSession` requests them after the
  // monitoring session opens, because macOS refuses to enumerate inputs until that
  // session has answered the microphone consent prompt — asking earlier would show
  // an error while the prompt was still up.
  // permissions.

  createEffect(() => {
    if (choice() === "process" && !processesRequested) {
      processesRequested = true;
      void refreshProcesses();
    }
  });

  // Keep a capture session open for live kinds, so the input meter shows level
  // while idle. Re-opens whenever the kind or its device/process selection changes.
  createEffect(
    on(
      () => [choice(), deviceId(), targetPid(), mixMicDeviceId(), mixSystemDeviceId()] as const,
      ([kind, , pid]) => {
        if (kind === "file" || kind === "synth" || (kind === "process" && pid == null))
          void stopMonitor();
        else void startMonitor();
      },
    ),
  );

  /** Live kinds (mic/system/process/mix) expose gain, meter and record controls. */
  const liveKind = () => choice() !== "file" && choice() !== "synth";

  /** No source yet, not recording → the compact horizontal "Add audio" strip. */
  const isEmpty = () => source() == null && !recording();

  return (
    <aside
      class="app-source"
      data-testid="region.source"
      classList={{ "app-source-hero": isEmpty() }}
    >
      <Show
        when={isEmpty()}
        fallback={<div class="src-heading">{source() ? "Replace source" : "Add audio"}</div>}
      >
        <div class="src-hero-copy">
          <span class="src-hero-title">Add audio</span>
          <span class="src-hero-hint">
            Open a file, record from a mic / system / application, or build a synth — it becomes the
            timeline.
          </span>
        </div>
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
          </Show>

          <LiveSourceInputs compact={isEmpty()} />
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

      <Show when={captureError() ?? sourcesError()}>
        {(message) => (
          <div class="src-error" data-testid="source.error" title={message()}>
            {message()}
          </div>
        )}
      </Show>
    </aside>
  );
}
