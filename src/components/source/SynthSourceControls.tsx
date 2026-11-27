import { Show } from "solid-js";
import { Switch } from "@kobalte/core/switch";
import Button from "../Button";
import Tooltip from "../Tooltip";
import { GraphError } from "../graphEditor/GraphTabChrome";
import { createNumberDrag } from "../../lib/dragNumber";
import { LIVE_MAX_SECONDS, liveTooLong } from "../../lib/synthPlan";
import {
  liveEnabled,
  liveRendering,
  renderSynth,
  rendering,
  setLiveEnabled,
  setSynthSeconds,
  synthError,
  synthSeconds,
} from "../../state/synth";

/**
 * The synth's **Length**, **Render** and **Live** controls (M43), shown in the Sources
 * rail while the synth kind is selected.
 *
 * They used to sit in the synth graph tab. Moving them here lets the graph be edited in
 * the Workbench and rendered from the rail, and gives a popout (which has no rail) only
 * the editing chrome — it renders in the project window.
 */
export default function SynthSourceControls() {
  // The length field is draggable as well as typed (M7). It lives in the store because
  // the Live scheduler re-renders on its changes (`state/synthLive.ts`).
  const lengthDrag = createNumberDrag({
    value: synthSeconds,
    onInput: (value) => setSynthSeconds(Math.min(60, Math.max(0.1, value))),
    step: 0.5,
    min: 0.1,
    max: 60,
  });
  const length = () => synthSeconds();

  return (
    <div class="src-controls">
      <Tooltip label="Rendered length, in seconds (drag up/down to change)">
        <label class="src-field">
          <span class="src-label">Length</span>
          <input
            class={`src-num nodrag num-drag${lengthDrag.dragging() ? " num-dragging" : ""}`}
            data-testid="synth.length"
            type="number"
            min={0.1}
            max={60}
            step={0.5}
            value={length()}
            onInput={(event) => setSynthSeconds(Number(event.currentTarget.value))}
            {...lengthDrag.handlers}
          />
          <span class="src-unit">s</span>
        </label>
      </Tooltip>

      <Tooltip label="Overwrite the synth source in place as the graph changes, so the analysis follows">
        <Switch
          class="toolbar-switch src-live-switch"
          checked={liveEnabled()}
          onChange={(enabled) => setLiveEnabled(enabled)}
        >
          <Switch.Label class="toolbar-label">
            Live
            <span class="src-live-state">
              {liveRendering() ? "rendering" : liveEnabled() ? "on" : "off"}
            </span>
          </Switch.Label>
          <Switch.Input class="toolbar-switch-input" data-testid="synth.live" />
          <Switch.Control class="toolbar-switch-control">
            <Switch.Thumb class="toolbar-switch-thumb" />
          </Switch.Control>
        </Switch>
      </Tooltip>

      <Show when={liveEnabled() && liveTooLong(length())}>
        <span class="graph-warn" data-testid="synth.live.cap">
          Live is limited to {LIVE_MAX_SECONDS} s — use Render once for longer
        </span>
      </Show>

      <Button
        class="src-button"
        data-testid="graph.render"
        disabled={rendering()}
        onClick={() => void renderSynth(length())}
      >
        {rendering() ? "Rendering…" : "Render"}
      </Button>

      <GraphError message={synthError} />
    </div>
  );
}
