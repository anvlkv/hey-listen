import { Slider } from "@kobalte/core/slider";
import { Switch } from "@kobalte/core/switch";
import { Show } from "solid-js";
import { previewSpeed, setPreviewSpeed } from "../../audio/preview";
import { positionToSpeed, speedToPosition } from "../../lib/previewSpeed";
import { filterActive, filterComposed, setFilterEnabled } from "../../state/graph";
import { setSourcePanelPinned, sourcePanelPinned } from "../../state/settings";
import { source, status } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";
import { openTool } from "../../state/workbench";
import Button from "../Button";
import ChannelSelect from "../ChannelSelect";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { formatTime } from "./format";

/** `1.25×`, but `1×` rather than `1.00×` for a whole rate. */
const speedLabel = (speed: number) => `${Number(speed.toFixed(2))}×`;

/**
 * The Timeline toolbar (readout, filter indicator, channel picker and the
 * replace / preview / speed / note / zoom actions). Presentational: `previewing`,
 * `active`, `canNoteAtCursor` and the callbacks come from `Timeline.tsx`; the remaining
 * state is read from the stores directly.
 */
export default function TimelineToolbar(props: {
  previewing: boolean;
  active: boolean;
  /** Whether a preview is playing, so a note can be dropped at the playhead. */
  canNoteAtCursor: boolean;
  onTogglePreview: () => void;
  onNoteAtCursor: () => void;
  onZoomWindow: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  const windowDuration = () => windowEnd() - windowStart();

  function onFilterChange(enabled: boolean) {
    setFilterEnabled(enabled);
    // Nothing to apply yet: take the user where they can compose a filter, and the
    // switch follows once the graph does something.
    if (enabled && !filterComposed()) void openTool("filter");
  }

  return (
    <div class="timeline-toolbar">
      <div class="timeline-readout">
        <span>
          <strong>{formatTime(windowStart())}</strong> – <strong>{formatTime(windowEnd())}</strong>
        </span>
        <span class="timeline-dim">Δ {formatTime(windowDuration())}</span>
      </div>
      <Tooltip
        label={
          filterActive()
            ? "The filter graph is applied to the signal"
            : "The filter graph is bypassed"
        }
      >
        <Switch
          class="toolbar-switch timeline-filter"
          checked={filterActive()}
          onChange={onFilterChange}
        >
          <Switch.Label class="toolbar-label icon-label">
            <Icon name="filter" />
            Filter
            <span class="timeline-filter-state">{filterActive() ? "on" : "off"}</span>
          </Switch.Label>
          <Switch.Input
            class="toolbar-switch-input"
            data-testid="toolbar.filter"
            data-composed={filterComposed()}
          />
          <Switch.Control class="toolbar-switch-control">
            <Switch.Thumb class="toolbar-switch-thumb" />
          </Switch.Control>
        </Switch>
      </Tooltip>
      <Show when={(source()?.channels ?? 1) > 1}>
        <ChannelSelect />
      </Show>
      <div class="timeline-actions">
        <Show when={source()}>
          <Tooltip label="Show the source controls to replace the source">
            <Button
              class="timeline-btn icon-btn"
              data-testid="timeline.replace"
              aria-pressed={sourcePanelPinned()}
              aria-label="Replace source"
              onClick={() => setSourcePanelPinned(!sourcePanelPinned())}
            >
              <Icon name="folder-open" />
            </Button>
          </Tooltip>
        </Show>
        <Tooltip label="Preview the analysis window">
          <Button
            class="timeline-btn icon-label"
            data-testid="timeline.preview"
            disabled={status() !== "ready"}
            onClick={() => props.onTogglePreview()}
          >
            <Icon name={props.previewing ? "stop" : "play"} />
            {props.previewing ? "Stop" : "Preview"}
          </Button>
        </Tooltip>
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
              <Slider.Thumb class="gain-thumb">
                <Slider.Input
                  class="gain-input"
                  data-testid="timeline.speed"
                  aria-label="Preview speed"
                />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <span class="timeline-speed-value" data-testid="timeline.speed.value">
            {speedLabel(previewSpeed())}
          </span>
        </div>
        <Tooltip label="Add a note at the playhead">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.noteAtCursor"
            disabled={!props.canNoteAtCursor}
            aria-label="Add a note at the playhead"
            onClick={() => props.onNoteAtCursor()}
          >
            <Icon name="note-sticky" />
          </Button>
        </Tooltip>
        <Tooltip label="Zoom the view to the analysis window">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom to the analysis window"
            onClick={() => props.onZoomWindow()}
          >
            <Icon name="magnifying-glass" />
          </Button>
        </Tooltip>
        <Tooltip label="Zoom out">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom out"
            onClick={() => props.onZoomOut()}
          >
            <Icon name="minus" />
          </Button>
        </Tooltip>
        <Tooltip label="Zoom in">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom in"
            onClick={() => props.onZoomIn()}
          >
            <Icon name="plus" />
          </Button>
        </Tooltip>
        <Tooltip label="Fit the whole source">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Fit the whole source"
            onClick={() => props.onFit()}
          >
            <Icon name="expand" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
