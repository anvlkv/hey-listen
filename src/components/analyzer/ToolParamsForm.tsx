import { NumberField } from "@kobalte/core/number-field";
import { Switch as KSwitch } from "@kobalte/core/switch";
import { For, Match, Show, Switch, untrack } from "solid-js";
import SelectField from "../SelectField";
import Tooltip from "../Tooltip";
import { createNumberDrag } from "../../lib/dragNumber";
import {
  analyzerById,
  setToolOption,
  toolOptions,
  type AnalyzerId,
  type ToolParamField,
} from "../../state/analyzer";

/**
 * Per-tool params (not shared), rendered in the analyzer's params popover below the
 * shared params form. The fields come from the tool's registry entry, so a new tool
 * only declares its params — no bespoke form component.
 *
 * See `docs/analysis-tools.md` → "Per-tool params".
 */
export default function ToolParamsForm(props: { id: AnalyzerId }) {
  const fields = () => analyzerById(props.id).params ?? [];

  return (
    <Show when={fields().length > 0}>
      <div class="params-form params-tool">
        <div class="params-heading">
          Tool params <span class="params-dim">this tool only</span>
        </div>
        <For each={fields()}>
          {(field) => (
            <Switch fallback={<NumericParam id={props.id} field={field} />}>
              <Match when={field.kind === "select"}>
                <Tooltip label={field.title ?? field.label}>
                  <label class="params-field" data-testid={`toolparam.${props.id}.${field.key}`}>
                    <span class="params-label">{field.label}</span>
                    <SelectField
                      options={field.options ?? []}
                      value={toolOptions[props.id][field.key]}
                      onChange={(value) => setToolOption(props.id, field.key, value)}
                      label={field.label}
                    />
                  </label>
                </Tooltip>
              </Match>
              <Match when={field.kind === "toggle"}>
                <ToggleParam id={props.id} field={field} />
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Show>
  );
}

/** An on/off tool param, rendered as a switch (0/1 crossing IPC unchanged). */
function ToggleParam(props: { id: AnalyzerId; field: ToolParamField }) {
  const on = () => toolOptions[props.id][props.field.key] !== 0;
  return (
    <Tooltip label={props.field.title ?? props.field.label}>
      <label class="params-field" data-testid={`toolparam.${props.id}.${props.field.key}`}>
        <span class="params-label">{props.field.label}</span>
        <KSwitch
          class="params-switch"
          checked={on()}
          onChange={(checked) => setToolOption(props.id, props.field.key, checked ? 1 : 0)}
        >
          <KSwitch.Input class="params-switch-input" />
          <KSwitch.Control class="params-switch-control">
            <KSwitch.Thumb class="params-switch-thumb" />
          </KSwitch.Control>
        </KSwitch>
      </label>
    </Tooltip>
  );
}

/** A numeric tool param, draggable up/down as well as typed (M7). */
function NumericParam(props: { id: AnalyzerId; field: ToolParamField }) {
  const drag = createNumberDrag({
    value: () => toolOptions[props.id][props.field.key],
    onInput: (value) =>
      setToolOption(props.id, props.field.key, clampNumber(value, props.field.value, props.field)),
    step: untrack(() => props.field.step ?? 1),
    min: untrack(() => props.field.min),
    max: untrack(() => props.field.max),
  });

  return (
    <Tooltip label={props.field.title ?? props.field.label}>
      <label
        class="params-field params-field-num"
        data-testid={`toolparam.${props.id}.${props.field.key}`}
      >
        <span class="params-label">{props.field.label}</span>
        <div class="params-range-inputs">
          <NumberField
            class="params-num"
            value={toolOptions[props.id][props.field.key]}
            onChange={(value) =>
              setToolOption(
                props.id,
                props.field.key,
                clampNumber(value, props.field.value, props.field),
              )
            }
            minValue={props.field.min}
            maxValue={props.field.max}
            step={props.field.step}
            format={false}
          >
            <NumberField.Input
              class={`src-num num-drag${drag.dragging() ? " num-dragging" : ""}`}
              aria-label={props.field.label}
              {...drag.handlers}
            />
          </NumberField>
          <Show when={props.field.suffix}>
            <span class="params-dim">{props.field.suffix}</span>
          </Show>
        </div>
      </label>
    </Tooltip>
  );
}

function clampNumber(
  raw: string | number,
  fallback: number,
  field: { min?: number; max?: number },
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const min = field.min ?? -Infinity;
  const max = field.max ?? Infinity;
  return Math.min(max, Math.max(min, parsed));
}
