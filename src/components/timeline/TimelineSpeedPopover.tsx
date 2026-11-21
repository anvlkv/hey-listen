import { Slider } from "@kobalte/core/slider";
import { previewSpeed, setPreviewSpeed } from "../../audio/transportSpeed";
import { positionToSpeed, speedToPosition } from "../../lib/previewSpeed";
import Popover from "../Popover";

/** `1.25×`, but `1×` rather than `1.00×` for a whole rate. */
const speedLabel = (speed: number) => `${Number(speed.toFixed(2))}×`;

/**
 * The Timeline toolbar's **preview speed** trigger (M23): a label-only button showing the
 * current varispeed rate (the words carry the meaning, so it takes no icon) that opens the
 * log slider in a portaled popover. The rate is a transport control — it shifts pitch and
 * never affects analysis, which always reads the source at 1×. See
 * `docs/annotations.md` → "Preview playback and the shared playhead".
 */
export default function TimelineSpeedPopover() {
  return (
    <Popover
      label="Preview speed"
      title="Preview speed (varispeed — shifts pitch)"
      triggerClass="timeline-btn timeline-speed-trigger"
      triggerAriaLabel={`Preview speed (${speedLabel(previewSpeed())})`}
      testid="timeline.speed.trigger"
      panelClass="timeline-speed-panel"
      trigger={
        <span class="timeline-speed-value" data-testid="timeline.speed.value">
          {speedLabel(previewSpeed())}
        </span>
      }
    >
      <div class="timeline-speed" title="Preview speed (varispeed — shifts pitch)">
        <Slider
          class="timeline-speed-slider"
          minValue={-1}
          maxValue={1}
          step={0.01}
          value={[speedToPosition(previewSpeed())]}
          onChange={(values) => setPreviewSpeed(positionToSpeed(values[0]))}
          aria-label="Preview speed"
        >
          <Slider.Track class="gain-track">
            <Slider.Fill class="gain-fill" />
            <Slider.Thumb class="gain-thumb" aria-label="Preview speed">
              <Slider.Input
                class="gain-input"
                data-testid="timeline.speed"
                aria-label="Preview speed"
              />
            </Slider.Thumb>
          </Slider.Track>
        </Slider>
      </div>
    </Popover>
  );
}
