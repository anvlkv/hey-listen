import { Meter } from "@kobalte/core/meter";
import { NumberField } from "@kobalte/core/number-field";
import { Slider } from "@kobalte/core/slider";
import { Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import type { NumberDrag } from "../../lib/dragNumber";
import { formatClock, meterDbLabel, meterPercent } from "../../lib/format";
import {
  applyGain,
  cancelCountdown,
  countdown,
  elapsed,
  gain,
  level,
  monitoring,
  paused,
  recording,
  setStartDelay,
  setTargetDuration,
  startCapture,
  startDelay,
  stopCapture,
  targetDuration,
  togglePause,
} from "../../state/capture";

function positive(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function readout() {
  const target = targetDuration();
  return target > 0 ? `${formatClock(elapsed())} / ${formatClock(target)}` : formatClock(elapsed());
}

/** Gain, level meter, timing, and record/stop controls for live kinds. */
export default function LiveControls(props: { startDrag: NumberDrag; stopDrag: NumberDrag }) {
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
        <Slider.Label class="src-label icon-label">
          <Icon name="sliders" />
          Gain
        </Slider.Label>
        <Slider.Track class="gain-track">
          <Slider.Fill class="gain-fill" />
          <Slider.Thumb class="gain-thumb">
            <Slider.Input class="gain-input" />
          </Slider.Thumb>
        </Slider.Track>
        <span class="src-readout">{Math.round(gain() * 100)}%</span>
      </Slider>

      <Tooltip label={monitoring() ? "Input level — live" : "Input level"}>
        <Meter
          class="src-field"
          value={meterPercent(level())}
          minValue={0}
          maxValue={100}
          getValueLabel={() => meterDbLabel(level())}
        >
          <Meter.Label class="src-label icon-label">
            <Icon name="gauge-high" />
            Level
          </Meter.Label>
          <Meter.Track class="src-meter">
            <Meter.Fill class="src-meter-fill" />
          </Meter.Track>
          <span class="src-readout">{meterDbLabel(level())}</span>
        </Meter>
      </Tooltip>

      <Show when={!recording()}>
        <div class="src-field src-timing">
          <Tooltip label="Delay before recording begins, in seconds (drag up/down to change)">
            <NumberField
              class="src-numfield"
              value={startDelay()}
              onChange={(value) => setStartDelay(positive(value, 0))}
              minValue={0}
              step={1}
              format={false}
            >
              <NumberField.Label class="src-label">Start in</NumberField.Label>
              <NumberField.Input
                class={`src-num num-drag${props.startDrag.dragging() ? " num-dragging" : ""}`}
                {...props.startDrag.handlers}
              />
            </NumberField>
          </Tooltip>
          <span class="src-unit">s</span>

          <Tooltip label="Stop automatically after this many seconds (0 = until stopped); drag up/down to change">
            <NumberField
              class="src-numfield"
              value={targetDuration()}
              onChange={(value) => setTargetDuration(positive(value, 0))}
              minValue={0}
              step={1}
              format={false}
            >
              <NumberField.Label class="src-label">Stop after</NumberField.Label>
              <NumberField.Input
                class={`src-num num-drag${props.stopDrag.dragging() ? " num-dragging" : ""}`}
                placeholder="0"
                {...props.stopDrag.handlers}
              />
            </NumberField>
          </Tooltip>
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
          <Button
            class="src-button src-record icon-label"
            data-testid="source.record"
            onClick={() => void startCapture()}
          >
            <Icon name="record-vinyl" />
            Record
          </Button>
        </Show>
        <Show when={recording()}>
          <Button
            class="src-button icon-label"
            data-testid="source.pause"
            onClick={() => void togglePause()}
          >
            <Icon name={paused() ? "circle-play" : "circle-pause"} />
            {paused() ? "Resume" : "Pause"}
          </Button>
          <Button
            class="src-button src-stop icon-label"
            data-testid="source.stop"
            onClick={() => void stopCapture()}
          >
            <Icon name="circle-stop" />
            Stop
          </Button>
          <span class="src-readout">{readout()}</span>
        </Show>
      </div>
    </>
  );
}
