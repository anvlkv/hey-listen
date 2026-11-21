import { Show } from "solid-js";
import { Switch } from "@kobalte/core/switch";
import Button from "./Button";
import GraphEditor from "./GraphEditor";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { ClearGraphButton, GraphError, GraphNotices } from "./graphEditor/GraphTabChrome";
import { createNumberDrag } from "../lib/dragNumber";
import { SYNTH_GRAPH } from "../state/graph";
import {
  liveEnabled,
  liveRendering,
  renderSynth,
  rendering,
  setLiveEnabled,
  setSynthSeconds,
  synthError,
  synthSeconds,
} from "../state/synth";
import { LIVE_MAX_SECONDS } from "../state/synthLive";

/**
 * Synth graph tab: build a fundsp synth in `solid-flow` (`generators → … → Output`).
 *
 * **Render** is the one-shot/long-form path (a first adoption defines the timeline; an
 * existing synth source is overwritten in place). **Live** re-renders the source in place
 * on every settled edit, so the analysis follows the graph (ADR-21 / M22). Playback is the
 * Timeline's transport — there is no second play control here.
 */
export default function SynthGraphTab() {
  const nodes = () => SYNTH_GRAPH.nodes.length;

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
    <GraphEditor graph="synth">
      <span class="graph-toolbar-title">Synth graph</span>
      <span class="graph-toolbar-hint" data-testid="graph.hint">
        {nodes()} node{nodes() === 1 ? "" : "s"}
      </span>
      <GraphNotices graph="synth" silent="Output is not connected — the render is silent" />
      <Tooltip label="Rendered length, in seconds (drag up/down to change)">
        <label class="graph-field">
          <span>Length</span>
          <input
            class={`graph-number nodrag num-drag${lengthDrag.dragging() ? " num-dragging" : ""}`}
            data-testid="synth.length"
            type="number"
            min={0.1}
            max={60}
            step={0.5}
            value={length()}
            onInput={(event) => setSynthSeconds(Number(event.currentTarget.value))}
            {...lengthDrag.handlers}
          />
          <span>s</span>
        </label>
      </Tooltip>
      <Tooltip label="Overwrite the synth source in place as the graph changes, so the analysis follows">
        <Switch
          class="toolbar-switch graph-live-switch"
          checked={liveEnabled()}
          onChange={(enabled) => setLiveEnabled(enabled)}
        >
          <Switch.Label class="toolbar-label icon-label">
            <Icon name="arrows-rotate" />
            Live
            <span class="graph-live-state">
              {liveRendering() ? "rendering" : liveEnabled() ? "on" : "off"}
            </span>
          </Switch.Label>
          <Switch.Input class="toolbar-switch-input" data-testid="synth.live" />
          <Switch.Control class="toolbar-switch-control">
            <Switch.Thumb class="toolbar-switch-thumb" />
          </Switch.Control>
        </Switch>
      </Tooltip>
      <Show when={liveEnabled() && length() > LIVE_MAX_SECONDS}>
        <span class="graph-warn" data-testid="synth.live.cap">
          Live renders {LIVE_MAX_SECONDS} s — use Render once for longer
        </span>
      </Show>
      <Button
        class="graph-btn graph-btn-primary icon-label"
        data-testid="graph.render"
        disabled={rendering()}
        onClick={() => void renderSynth(length())}
      >
        <Icon name="play" />
        {rendering() ? "Rendering…" : "Render"}
      </Button>
      <GraphError message={synthError} />
      <ClearGraphButton graph="synth" />
    </GraphEditor>
  );
}
