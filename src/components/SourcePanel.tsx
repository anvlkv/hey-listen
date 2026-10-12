import { Meter } from "@kobalte/core/meter";
import { NumberField } from "@kobalte/core/number-field";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { createEffect, on, onCleanup, Show } from "solid-js";
import Button from "./Button";
import Combobox from "./Combobox";
import { createNumberDrag, type NumberDrag } from "../lib/dragNumber";
import { formatClock, meterDbLabel, meterPercent } from "../lib/format";
import { unwrapSingle } from "../lib/kobalte";
import { createPopupMount } from "../lib/popupMount";
import { openFileDialog, source } from "../state/source";
import { openTool } from "../state/workbench";
import {
  applyGain,
  cancelCountdown,
  captureError,
  choice,
  countdown,
  deviceId,
  devices,
  elapsed,
  gain,
  level,
  mixMicDeviceId,
  mixSystemDeviceId,
  monitoring,
  paused,
  processes,
  recording,
  refreshDevices,
  refreshProcesses,
  setChoice,
  setDeviceId,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setStartDelay,
  setTargetDuration,
  setTargetPid,
  sourcesError,
  startCapture,
  startDelay,
  startMonitor,
  stopMonitor,
  stopCapture,
  targetDuration,
  targetPid,
  togglePause,
  type SourceChoice,
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
 * `Meter`, `Button`); see ADR-8.
 */

interface DeviceLike {
  id: string;
  name: string;
}

interface SourceChoiceOption {
  value: SourceChoice;
  label: string;
}

/** The source kinds the picker offers (synth renders from its Workbench tab). */
const SOURCE_CHOICES: SourceChoiceOption[] = [
  { value: "file", label: "Audio file" },
  { value: "mic", label: "Microphone" },
  { value: "system", label: "System audio" },
  { value: "process", label: "Application" },
  { value: "mix", label: "Mic + system" },
  { value: "synth", label: "Synth (graph)" },
];

const micDevices = () => devices().filter((d) => d.sourceKind === "mic" && !d.isLoopback);
const systemDevices = () => devices().filter((d) => d.sourceKind === "system" || d.isLoopback);

const toOptions = (list: DeviceLike[]) => list.map((device) => ({ value: device.id, label: device.name }));

function positive(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function deviceOptions() {
  return toOptions(choice() === "mic" ? micDevices() : systemDevices());
}

function processOptions() {
  return processes().map((proc) => ({
    value: String(proc.pid),
    label: proc.isOutputActive ? `${proc.name} ●` : proc.name,
  }));
}

/** Kinds whose inputs list devices (see `LiveSourceInputs`); the rest need none. */
function usesDevices(kind: SourceChoice): boolean {
  return kind === "mic" || kind === "system" || kind === "mix";
}

function readout() {
  const target = targetDuration();
  return target > 0
    ? `${formatClock(elapsed())} / ${formatClock(target)}`
    : formatClock(elapsed());
}

/** The source-kind picker, shared by the hero and the replace controls. */
function SourceKindSelect() {
  const portal = createPopupMount();
  return (
    <Select<SourceChoiceOption>
      value={SOURCE_CHOICES.find((item) => item.value === choice())}
      onChange={(value) => {
        const option = unwrapSingle(value);
        if (!option) return;
        setChoice(option.value);
        // Selections are per-kind: a mic device id is not valid for system, etc.
        setDeviceId(null);
        setTargetPid(null);
      }}
      options={SOURCE_CHOICES}
      optionValue="value"
      optionTextValue="label"
      disabled={recording()}
      onOpenChange={(isOpen) => {
        if (isOpen) portal.refresh();
      }}
      sameWidth
      itemComponent={(item) => (
        <Select.Item item={item.item} class="pop-item">
          <Select.ItemLabel class="pop-item-label">{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator class="pop-item-indicator">✓</Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger ref={portal.ref} class="select-trigger" data-testid="source.kind">
        <Select.Value<SourceChoiceOption> class="select-value">
          {(state) => state.selectedOption()?.label ?? "Audio file"}
        </Select.Value>
        <Select.Icon class="select-icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal mount={portal.mount()}>
        <Select.Content class="pop-content">
          <Select.Listbox class="pop-listbox" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

/** The device / application / mix inputs for live kinds. */
function LiveSourceInputs(props: { compact?: boolean }) {
  return (
    <>
      <Show when={choice() === "mic" || choice() === "system"}>
        <div class="src-field">
          <span class="src-label">Device</span>
          <Combobox
            options={deviceOptions()}
            value={deviceId()}
            onChange={setDeviceId}
            emptyLabel="System default"
            label="Device"
            disabled={recording()}
          />
        </div>
      </Show>

      <Show when={choice() === "process"}>
        <div class={props.compact ? "src-field" : "src-stack"}>
          <span class="src-label">Application</span>
          <Combobox
            options={processOptions()}
            value={targetPid() == null ? null : String(targetPid())}
            onChange={(value) => setTargetPid(value == null ? null : Number(value))}
            placeholder="Choose an application…"
            label="Application"
            disabled={recording()}
          />
          <Button class="src-mini" onClick={() => void refreshProcesses()}>
            Refresh
          </Button>
        </div>
      </Show>

      <Show when={choice() === "mix"}>
        <div class={props.compact ? "src-field" : "src-stack"}>
          <Combobox
            options={toOptions(micDevices())}
            value={mixMicDeviceId()}
            onChange={setMixMicDeviceId}
            emptyLabel="Mic: default"
            label="Microphone device"
            disabled={recording()}
          />
          <Combobox
            options={toOptions(systemDevices())}
            value={mixSystemDeviceId()}
            onChange={setMixSystemDeviceId}
            emptyLabel="System: default"
            label="System device"
            disabled={recording()}
          />
        </div>
      </Show>
    </>
  );
}

/** Gain, level meter, timing, and record/stop controls for live kinds. */
function LiveControls(props: { startDrag: NumberDrag; stopDrag: NumberDrag }) {
  return (
    <>
      <Slider
        class="src-field"
        value={[gain()]}
        onChange={(values) => void applyGain(values[0])}
        minValue={0}
        maxValue={4}
        step={0.05}
        aria-label="Input gain"
      >
        <Slider.Label class="src-label">Gain</Slider.Label>
        <Slider.Track class="gain-track">
          <Slider.Fill class="gain-fill" />
          <Slider.Thumb class="gain-thumb">
            <Slider.Input class="gain-input" />
          </Slider.Thumb>
        </Slider.Track>
        <span class="src-readout">{Math.round(gain() * 100)}%</span>
      </Slider>

      <Meter
        class="src-field"
        value={meterPercent(level())}
        minValue={0}
        maxValue={100}
        getValueLabel={() => meterDbLabel(level())}
        title={monitoring() ? "Input level — live" : "Input level"}
      >
        <Meter.Label class="src-label">Level</Meter.Label>
        <Meter.Track class="src-meter">
          <Meter.Fill class="src-meter-fill" />
        </Meter.Track>
        <span class="src-readout">{meterDbLabel(level())}</span>
      </Meter>

      <Show when={!recording()}>
        <div class="src-field src-timing">
          <NumberField
            class="src-numfield"
            value={startDelay()}
            onChange={(value) => setStartDelay(positive(value, 0))}
            minValue={0}
            step={1}
            format={false}
          >
            <NumberField.Label class="src-label" title="Delay before recording begins">
              Start in
            </NumberField.Label>
            <NumberField.Input
              class={`src-num num-drag${props.startDrag.dragging() ? " num-dragging" : ""}`}
              title="Delay before recording begins, in seconds (drag up/down to change)"
              {...props.startDrag.handlers}
            />
          </NumberField>
          <span class="src-unit">s</span>

          <NumberField
            class="src-numfield"
            value={targetDuration()}
            onChange={(value) => setTargetDuration(positive(value, 0))}
            minValue={0}
            step={1}
            format={false}
          >
            <NumberField.Label class="src-label" title="Stop automatically after this many seconds">
              Stop after
            </NumberField.Label>
            <NumberField.Input
              class={`src-num num-drag${props.stopDrag.dragging() ? " num-dragging" : ""}`}
              placeholder="0"
              title="Stop automatically after this many seconds (0 = until stopped); drag up/down to change"
              {...props.stopDrag.handlers}
            />
          </NumberField>
          <span class="src-unit">s</span>
        </div>
      </Show>

      <div class="src-actions">
        <Show when={countdown() != null}>
          <Button class="src-button" onClick={cancelCountdown}>
            Cancel ({countdown()})
          </Button>
        </Show>
        <Show when={countdown() == null && !recording()}>
          <Button class="src-button src-record" data-testid="source.record" onClick={() => void startCapture()}>
            ● Record
          </Button>
        </Show>
        <Show when={recording()}>
          <Button class="src-button" data-testid="source.pause" onClick={() => void togglePause()}>
            {paused() ? "▶ Resume" : "⏸ Pause"}
          </Button>
          <Button class="src-button src-stop" data-testid="source.stop" onClick={() => void stopCapture()}>
            ■ Stop
          </Button>
          <span class="src-readout">{readout()}</span>
        </Show>
      </div>
    </>
  );
}

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
    <aside class="app-source" data-testid="region.source" classList={{ "app-source-hero": isEmpty() }}>
      <Show
        when={isEmpty()}
        fallback={<div class="src-heading">{source() ? "Replace source" : "Add audio"}</div>}
      >
        <div class="src-hero-copy">
          <span class="src-hero-title">Add audio</span>
          <span class="src-hero-hint">
            Open a file, record from a mic / system / application, or build a synth —
            it becomes the timeline.
          </span>
        </div>
      </Show>

      <div class="src-controls">
        <Show when={!recording()}>
          <SourceKindSelect />

          <Show when={choice() === "file"}>
            <Button class="src-button" disabled={recording()} data-testid="source.openFile" onClick={() => void openFileDialog()}>
              Open audio file…
            </Button>
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

      <Show
        when={captureError() ?? sourcesError()}
        fallback={
          <Show when={source()}>
            {(s) => (
              <div class="source-summary" data-testid="source.summary" title={s().probe?.path ?? s().name}>
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
