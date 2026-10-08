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
      <button type="button" class="zoom-btn" title="Zoom out" onClick={() => props.onZoomOut()}>
        −
      </button>
      <button type="button" class="zoom-btn" title="Zoom in" onClick={() => props.onZoomIn()}>
        +
      </button>
      <button type="button" class="zoom-btn" title="Fit to the whole window" onClick={() => props.onFit()}>
        Fit
      </button>
      <span class="zoom-readout">{props.label}</span>
    </div>
  );
}
