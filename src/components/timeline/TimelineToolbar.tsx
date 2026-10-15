import { Show } from "solid-js";
import { filterEnabled } from "../../state/graph";
import { setSourcePanelPinned, sourcePanelPinned } from "../../state/settings";
import { source, status } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";
import Button from "../Button";
import ChannelSelect from "../ChannelSelect";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { formatTime } from "./format";

/**
 * The Timeline toolbar (readout, filter indicator, channel picker and the
 * replace / preview / zoom actions). Presentational: `previewing` and `active` and
 * the zoom/preview callbacks come from `Timeline.tsx`; the remaining state is read
 * from the stores directly.
 */
export default function TimelineToolbar(props: {
  previewing: boolean;
  active: boolean;
  onTogglePreview: () => void;
  onZoomWindow: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  const windowDuration = () => windowEnd() - windowStart();

  return (
    <div class="timeline-toolbar">
      <div class="timeline-readout">
        <span>
          <strong>{formatTime(windowStart())}</strong> – <strong>{formatTime(windowEnd())}</strong>
        </span>
        <span class="timeline-dim">Δ {formatTime(windowDuration())}</span>
      </div>
      <span
        class="timeline-filter"
        title={
          filterEnabled()
            ? "The filter graph is applied to the signal"
            : "The filter graph is bypassed"
        }
        style={{
          "font-size": "11px",
          padding: "1px 6px",
          "border-radius": "4px",
          "white-space": "nowrap",
          color: filterEnabled() ? "#ffb454" : "#8a8a8a",
          border: `1px solid ${filterEnabled() ? "#6b4a1f" : "#3a3a3a"}`,
          background: filterEnabled() ? "rgba(255, 180, 84, 0.12)" : "transparent",
        }}
      >
        {filterEnabled() ? "Filter on" : "Filter off"}
      </span>
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
            disabled={status() !== "ready"}
            onClick={() => props.onTogglePreview()}
          >
            <Icon name={props.previewing ? "stop" : "play"} />
            {props.previewing ? "Stop" : "Preview"}
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
