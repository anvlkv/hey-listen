import { Show } from "solid-js";
import Button from "../Button";
import Combobox from "../Combobox";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import {
  choice,
  deviceId,
  devices,
  mixMicDeviceId,
  mixSystemDeviceId,
  processes,
  recording,
  refreshProcesses,
  setDeviceId,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setTargetPid,
  targetPid,
} from "../../state/capture";

interface DeviceLike {
  id: string;
  name: string;
}

const micDevices = () => devices().filter((d) => d.sourceKind === "mic" && !d.isLoopback);
const systemDevices = () => devices().filter((d) => d.sourceKind === "system" || d.isLoopback);

const toOptions = (list: DeviceLike[]) =>
  list.map((device) => ({ value: device.id, label: device.name }));

function deviceOptions() {
  return toOptions(choice() === "mic" ? micDevices() : systemDevices());
}

function processOptions() {
  return processes().map((proc) => ({
    value: String(proc.pid),
    label: proc.isOutputActive ? `${proc.name} ●` : proc.name,
  }));
}

/** The device / application / mix inputs for live kinds. */
export default function LiveSourceInputs(props: { compact?: boolean }) {
  return (
    <>
      <Show when={choice() === "mic" || choice() === "system"}>
        <div class="src-field">
          <span class="src-label icon-label">
            <Icon name="headphones" />
            Device
          </span>
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
          <span class="src-label icon-label">
            <Icon name="desktop" />
            Application
          </span>
          <Combobox
            options={processOptions()}
            value={targetPid() == null ? null : String(targetPid())}
            onChange={(value) => setTargetPid(value == null ? null : Number(value))}
            placeholder="Choose an application…"
            label="Application"
            disabled={recording()}
          />
          <Tooltip label="Refresh the application list">
            <Button
              class="src-mini icon-btn"
              aria-label="Refresh applications"
              onClick={() => void refreshProcesses()}
            >
              <Icon name="arrows-rotate" />
            </Button>
          </Tooltip>
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
