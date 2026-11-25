import { Switch } from "@kobalte/core/switch";
import { Show } from "solid-js";
import { returnToStart } from "../../audio/preview";
import { transportFollow, toggleTransportFollow } from "../../audio/transportFollow";
import type { TransportStatus } from "../../audio/transport";
import { filterActive, filterComposed, setFilterEnabled } from "../../state/graph";
import { showTab } from "../../state/activityBar";
import { source, status } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";
import { canGoBack, canGoForward, nextWindow, previousWindow } from "../../state/windowHistory";
import { openTool } from "../../state/workbench";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { formatTime } from "./format";
import TimelineSpeedPopover from "./TimelineSpeedPopover";
import WindowEditPopover from "./WindowEditPopover";

/**
 * The Timeline toolbar, laid out in zones separated by `.toolbar-divider`: the window
 * readout and edit / history, the transport (with the speed popover), the filter switch,
 * the annotation + replace actions, and the zoom controls. Presentational: `status`,
 * `position`, `loop`, `active`, `canAnnotateAtCursor` and the callbacks come from
 * `Timeline.tsx`; the remaining state is read from the stores directly. Conventional
 * controls are icon-only (with an `aria-label` and a Tooltip); only the filter switch and
 * the speed readout carry words. The analysis channel lives on the Timeline's channel
 * rail, not here.
 */
export default function TimelineToolbar(props: {
  status: TransportStatus;
  /** The playhead in source seconds, or `null` without a source. */
  position: number | null;
  loop: boolean;
  active: boolean;
  /** Whether the playhead exists, so an annotation can be dropped at it. */
  canAnnotateAtCursor: boolean;
  onToggle: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onAnnotateAtCursor: () => void;
  onZoomWindow: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  const windowDuration = () => windowEnd() - windowStart();
  const duration = () => source()?.duration ?? Number.NaN;
  const transportLabel = () => (props.status === "playing" ? "Pause" : "Play");

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
        <span class="timeline-position" data-testid="timeline.position">
          <strong>{formatTime(props.position ?? Number.NaN)}</strong>
          <span class="timeline-dim"> / {formatTime(duration())}</span>
        </span>
      </div>
      {/* The window-edit trigger and the history arrows sit right after the readout, which
          stays a plain read-only summary (the E2E suite reads its text). */}
      <div class="toolbar-group">
        <WindowEditPopover />
        <Tooltip label="Previous analysis window">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.windowBack"
            disabled={!canGoBack()}
            aria-label="Previous analysis window"
            onClick={previousWindow}
          >
            <Icon name="arrow-left" />
          </Button>
        </Tooltip>
        <Tooltip label="Next analysis window">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.windowForward"
            disabled={!canGoForward()}
            aria-label="Next analysis window"
            onClick={nextWindow}
          >
            <Icon name="arrow-right" />
          </Button>
        </Tooltip>
      </div>
      <div class="toolbar-divider" />
      <div class="toolbar-group">
        <Tooltip label="Return the playhead to the start">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.start"
            disabled={!source()}
            aria-label="Return the playhead to the start"
            onClick={returnToStart}
          >
            <Icon name="backward-fast" />
          </Button>
        </Tooltip>
        <Tooltip label={transportLabel()}>
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.preview"
            disabled={status() !== "ready"}
            aria-label={transportLabel()}
            onClick={() => props.onToggle()}
          >
            <Icon name={props.status === "playing" ? "pause" : "play"} />
          </Button>
        </Tooltip>
        <Tooltip label="Stop (keeps the playhead where it is)">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.stop"
            disabled={props.status === "idle"}
            aria-label="Stop (keeps the playhead)"
            onClick={() => props.onStop()}
          >
            <Icon name="stop" />
          </Button>
        </Tooltip>
        <Tooltip label={props.loop ? "Looping the window" : "Play once to the window end"}>
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.loop"
            aria-pressed={props.loop}
            disabled={status() !== "ready"}
            aria-label="Loop the window"
            onClick={() => props.onToggleLoop()}
          >
            <Icon name="loop" />
          </Button>
        </Tooltip>
        <Tooltip label="Scroll the view to keep a playing playhead visible">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.follow"
            aria-pressed={transportFollow()}
            aria-label="Follow the playhead"
            onClick={toggleTransportFollow}
          >
            <Icon name="arrows-left-right-to-line" />
          </Button>
        </Tooltip>
        <TimelineSpeedPopover />
      </div>
      <div class="toolbar-divider" />
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
          <Switch.Label class="toolbar-label">
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
      <div class="toolbar-divider" />
      <div class="toolbar-group">
        <Tooltip label="Add an annotation at the playhead">
          <Button
            class="timeline-btn icon-btn"
            data-testid="timeline.annotationAtCursor"
            disabled={!props.canAnnotateAtCursor}
            aria-label="Add an annotation at the playhead"
            onClick={() => props.onAnnotateAtCursor()}
          >
            <Icon name="plus" />
          </Button>
        </Tooltip>
        <Show when={source()}>
          <Tooltip label="Replace source">
            <Button
              class="timeline-btn icon-btn"
              data-testid="timeline.replace"
              aria-label="Replace source"
              onClick={() => showTab("sources")}
            >
              <Icon name="folder-open" />
            </Button>
          </Tooltip>
        </Show>
      </div>
      <div class="toolbar-divider timeline-divider-end" />
      <div class="toolbar-group">
        <Tooltip label="Zoom out">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom out"
            onClick={() => props.onZoomOut()}
          >
            <Icon name="magnifying-glass-minus" />
          </Button>
        </Tooltip>
        <Tooltip label="Zoom in">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom in"
            onClick={() => props.onZoomIn()}
          >
            <Icon name="magnifying-glass-plus" />
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
        <Tooltip label="Zoom the view to the analysis window">
          <Button
            class="timeline-btn icon-btn"
            disabled={!props.active}
            aria-label="Zoom to the analysis window"
            onClick={() => props.onZoomWindow()}
          >
            <Icon name="crosshairs" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
