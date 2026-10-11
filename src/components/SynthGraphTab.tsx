import { createSignal, Show } from "solid-js";
import Button from "./Button";
import GraphEditor from "./GraphEditor";
import { createNumberDrag } from "../lib/dragNumber";
import { graphWarning, outputConnected, resetGraph, SYNTH_GRAPH } from "../state/graph";
import { renderSynth, rendering, synthError } from "../state/synth";

/**
 * Synth graph tab: build a fundsp synth in `solid-flow` (`generators → … → Output`)
 * and render it to PCM, which becomes the project's source (replacing the whole
 * timeline, see `docs/source-model.md`).
 */
export default function SynthGraphTab() {
  const [seconds, setSeconds] = createSignal(4);
  const nodes = () => SYNTH_GRAPH.nodes.length;

  // The length field is draggable as well as typed (M7).
  const lengthDrag = createNumberDrag({
    value: seconds,
    onInput: (value) => setSeconds(Math.min(60, Math.max(0.1, value))),
    step: 0.5,
    min: 0.1,
    max: 60,
  });

  return (
    <GraphEditor graph="synth">
      <span class="graph-toolbar-title">Synth graph</span>
      <span class="graph-toolbar-hint">
        {nodes()} node{nodes() === 1 ? "" : "s"}
      </span>
      <Show when={!outputConnected("synth")}>
        <span class="graph-warn" data-testid="graph.warning">
          Output is not connected — the render is silent
        </span>
      </Show>
      <Show when={graphWarning()}>
        {(message) => (
          <span class="graph-warn" data-testid="graph.connection.warning" title={message()}>
            {message()}
          </span>
        )}
      </Show>
      <label class="graph-field" title="Rendered length, in seconds">
        <span>Length</span>
        <input
          class={`graph-number nodrag num-drag${lengthDrag.dragging() ? " num-dragging" : ""}`}
          type="number"
          min={0.1}
          max={60}
          step={0.5}
          value={seconds()}
          onInput={(event) => setSeconds(Number(event.currentTarget.value))}
          {...lengthDrag.handlers}
        />
        <span>s</span>
      </label>
      <Button
        class="graph-btn graph-btn-primary"
        data-testid="graph.render"
        disabled={rendering()}
        onClick={() => void renderSynth(seconds())}
      >
        {rendering() ? "Rendering…" : "Render to timeline"}
      </Button>
      <Show when={synthError()}>
        {(message) => (
          <span class="graph-error" data-testid="graph.error" title={message()}>
            {message()}
          </span>
        )}
      </Show>
      <Button class="graph-btn" data-testid="graph.clear" onClick={() => resetGraph("synth")}>
        Clear graph
      </Button>
    </GraphEditor>
  );
}
