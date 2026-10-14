import Icon from "../Icon";
import Tooltip from "../Tooltip";

/**
 * Zoom controls overlaid on an analyzer chart: zoom out, zoom in, fit, and a
 * readout of the visible range. Callbacks are supplied per chart (uPlot tabs pass
 * the [`createUplotZoom`](./uplotZoom.ts) handle; the spectrogram passes its own
 * view controller).
 */
export default function ZoomControls(props: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  label: string;
}) {
  return (
    <div class="zoom-controls">
      <Tooltip label="Zoom out">
        <button
          type="button"
          class="zoom-btn icon-btn"
          aria-label="Zoom out"
          onClick={() => props.onZoomOut()}
        >
          <Icon name="minus" />
        </button>
      </Tooltip>
      <Tooltip label="Zoom in">
        <button
          type="button"
          class="zoom-btn icon-btn"
          aria-label="Zoom in"
          onClick={() => props.onZoomIn()}
        >
          <Icon name="plus" />
        </button>
      </Tooltip>
      <Tooltip label="Fit to the whole window">
        <button
          type="button"
          class="zoom-btn icon-btn"
          aria-label="Fit to the whole window"
          onClick={() => props.onFit()}
        >
          <Icon name="expand" />
        </button>
      </Tooltip>
      <span class="zoom-readout">{props.label}</span>
    </div>
  );
}
