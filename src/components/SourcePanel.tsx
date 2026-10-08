import { Meter } from "@kobalte/core/meter";
import { NumberField } from "@kobalte/core/number-field";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { createEffect, on, Show } from "solid-js";
import Button from "./Button";
import Combobox from "./Combobox";
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
 * It lives in the bottom-left corner, at the intersection of the Sidebar column
 * and the Timeline row. Changing the source replaces the whole timeline. See
 * `docs/ui-layout.md` and `docs/source-model.md`.
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

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function positive(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export default function SourcePanel() {
  let processesRequested = false;

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

  const deviceOptions = () => toOptions(choice() === "mic" ? micDevices() : systemDevices());

  /** Live kinds (mic/system/process/mix) expose gain, meter and record controls. */
  const liveKind = () => choice() !== "file" && choice() !== "synth";

  const processOptions = () =>
    processes().map((proc) => ({
      value: String(proc.pid),
      label: proc.isOutputActive ? `${proc.name} ●` : proc.name,
    }));

  const readout = () => {
    const target = targetDuration();
    return target > 0
      ? `${formatTime(elapsed())} / ${formatTime(target)}`
      : formatTime(elapsed());
  };

  // Meter fill uses a −60..0 dBFS scale so quiet signal is still visible.
  const meterPercent = () => {
    const value = level();
    if (value <= 0) return 0;
    const db = 20 * Math.log10(value);
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  };

  const meterLabel = () => {
    const value = level();
    return value > 0 ? `${(20 * Math.log10(value)).toFixed(0)} dB` : "—";
  };

  return (
    <aside class="app-source">
      <Select<SourceChoiceOption>
        value={SOURCE_CHOICES.find((item) => item.value === choice())}
        onChange={(value) => {
          const option = Array.isArray(value) ? value[0] : value;
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
        sameWidth
        itemComponent={(item) => (
          <Select.Item item={item.item} class="pop-item">
            <Select.ItemLabel class="pop-item-label">{item.item.rawValue.label}</Select.ItemLabel>
            <Select.ItemIndicator class="pop-item-indicator">✓</Select.ItemIndicator>
          </Select.Item>
        )}
      >
        <Select.Trigger class="select-trigger">
          <Select.Value<SourceChoiceOption> class="select-value">
            {(state) => state.selectedOption()?.label ?? "Audio file"}
          </Select.Value>
          <Select.Icon class="select-icon">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content class="pop-content">
            <Select.Listbox class="pop-listbox" />
          </Select.Content>
        </Select.Portal>
      </Select>

      <Show when={choice() === "file"}>
        <Button class="src-button" disabled={recording()} onClick={() => void openFileDialog()}>
          Open audio file…
        </Button>
      </Show>

      <Show when={choice() === "synth"}>
        <Button class="src-button" onClick={() => openTool("synth")}>
          Open synth graph…
        </Button>
      </Show>

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
        <div class="src-stack">
          <div class="src-field-head">
            <span class="src-label">Application</span>
            <Button class="src-mini" onClick={() => void refreshProcesses()}>
              Refresh
            </Button>
          </div>
          <Combobox
            options={processOptions()}
            value={targetPid() == null ? null : String(targetPid())}
            onChange={(value) => setTargetPid(value == null ? null : Number(value))}
            placeholder="Choose an application…"
            label="Application"
            disabled={recording()}
          />
        </div>
      </Show>

      <Show when={choice() === "mix"}>
        <div class="src-stack">
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

      <Show when={liveKind()}>
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
          value={meterPercent()}
          minValue={0}
          maxValue={100}
          getValueLabel={() => meterLabel()}
          title={monitoring() ? "Input level — live" : "Input level"}
        >
          <Meter.Label class="src-label">Level</Meter.Label>
          <Meter.Track class="src-meter">
            <Meter.Fill class="src-meter-fill" />
          </Meter.Track>
          <span class="src-readout">{meterLabel()}</span>
        </Meter>

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
              Start
            </NumberField.Label>
            <NumberField.Input
              class="src-num"
              title="Delay before recording begins, in seconds"
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
              Stop
            </NumberField.Label>
            <NumberField.Input
              class="src-num"
              placeholder="0"
              title="Stop automatically after this many seconds (0 = until stopped)"
            />
          </NumberField>
          <span class="src-unit">s</span>
        </div>

        <div class="src-actions">
          <Show when={countdown() != null}>
            <Button class="src-button" onClick={cancelCountdown}>
              Cancel ({countdown()})
            </Button>
          </Show>
          <Show when={countdown() == null && !recording()}>
            <Button class="src-button src-record" onClick={() => void startCapture()}>
              ● Record
            </Button>
          </Show>
          <Show when={recording()}>
            <Button class="src-button" onClick={() => void togglePause()}>
              {paused() ? "▶ Resume" : "⏸ Pause"}
            </Button>
            <Button class="src-button src-stop" onClick={() => void stopCapture()}>
              ■ Stop
            </Button>
            <span class="src-readout">{readout()}</span>
          </Show>
        </div>
      </Show>

      <Show
        when={captureError() ?? sourcesError()}
        fallback={
          <Show when={source()}>
            {(s) => (
              <div class="source-summary" title={s().probe?.path ?? s().name}>
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
          <div class="src-error" title={message()}>
            {message()}
          </div>
        )}
      </Show>
    </aside>
  );
}
