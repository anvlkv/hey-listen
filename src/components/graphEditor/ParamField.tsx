import { Show, untrack } from "solid-js";
import { createNumberDrag } from "../../lib/dragNumber";
import type { ParamDef } from "../../lib/graph";

/**
 * One numeric node parameter: label, value and unit, adjusted by typing or by
 * dragging up/down (see `createNumberDrag`). Shared by the inline node card and the
 * node inspector (D-16), so both wires stay identical.
 */
export default function ParamField(props: {
  param: ParamDef;
  value: number;
  onInput: (value: number) => void;
}) {
  const drag = createNumberDrag({
    value: () => props.value,
    onInput: (value) => props.onInput(value),
    // The bounds come from the static registry (`ParamDef`), so snapshot them once
    // rather than tracking them.
    step: untrack(() => props.param.step),
    min: untrack(() => props.param.min),
    max: untrack(() => props.param.max),
  });

  return (
    <label class="graph-param">
      <span class="graph-param-label">{props.param.label}</span>
      <input
        class={`graph-param-input nodrag nopan num-drag${drag.dragging() ? " num-dragging" : ""}`}
        type="number"
        min={props.param.min}
        max={props.param.max}
        step={props.param.step}
        value={props.value}
        onChange={(event) => props.onInput(Number(event.currentTarget.value))}
        {...drag.handlers}
      />
      <Show when={props.param.unit}>
        <span class="graph-param-unit">{props.param.unit}</span>
      </Show>
    </label>
  );
}
