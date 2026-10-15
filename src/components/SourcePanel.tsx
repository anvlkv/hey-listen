import { createEffect, on, onCleanup, Show } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import LiveControls from "./source/LiveControls";
import LiveSourceInputs from "./source/LiveSourceInputs";
import SourceKindSelect from "./source/SourceKindSelect";
import { usesDevices } from "./source/kinds";
import { createNumberDrag } from "../lib/dragNumber";
import { openFileDialog, source } from "../state/source";
import { openTool } from "../state/workbench";
import {
  captureError,
  choice,
  deviceId,
  mixMicDeviceId,
  mixSystemDeviceId,
  recording,
  refreshDevices,
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
 * "Add audio" strip (see `docs/ui-layout.md`); once a source exists (or while
 * recording) the panel is the narrow left-hand column beside the timeline. Both
 * layouts show the *same* controls — the strip just lays them out inline and
 * wraps.
 *
 * Controls are Kobalte primitives (`Select`, `Combobox`, `Slider`, `NumberField`,
 * `Meter`, `Button`); see ADR-8. The pieces live under `components/source/`.
 */
export default function SourcePanel() {
  let processesRequested = false;
  let devicesRequested = false;

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

  // Enumerate as late as possible. Walking the OS audio stack asks the OS for
  // access on macOS (a mic TCC prompt), so it must never happen for a project that
  // stays on a file / synth source — only once a live kind is picked here or a live
  // kind is restored with a project. See `docs/source-model.md` → OS permissions.
  createEffect(() => {
    if (!devicesRequested && usesDevices(choice())) {
      devicesRequested = true;
      void refreshDevices();
    }
  });

  // Fetch the process list the first time "Application" is selected.
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
            <Button
              class="src-button icon-label"
              disabled={recording()}
              data-testid="source.openFile"
              onClick={() => void openFileDialog()}
            >
              <Icon name="folder-open" />
              Open audio file…
            </Button>
          </Show>

          <Show when={choice() === "synth"}>
            <Button class="src-button icon-label" onClick={() => openTool("synth")}>
              <Icon name="wand-magic-sparkles" />
              Open synth graph…
            </Button>
          </Show>

          <LiveSourceInputs compact={isEmpty()} />
        </Show>

        <Show when={liveKind()}>
          <LiveControls startDrag={startDrag} stopDrag={stopDrag} />
        </Show>
      </div>

      <Show
        when={captureError() ?? sourcesError()}
        fallback={
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
              </div>
            )}
          </Show>
        }
      >
        {(message) => (
          <div class="src-error" data-testid="source.error" title={message()}>
            {message()}
          </div>
        )}
      </Show>
    </aside>
  );
}
