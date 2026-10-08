import { NumberField } from "@kobalte/core/number-field";
import { For, Show } from "solid-js";
import SelectField from "../SelectField";
import { analyzerById, setToolOption, toolOptions, type AnalyzerId } from "../../state/analyzer";

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
            <Show
              when={field.kind === "select"}
              fallback={
                <label class="params-field params-field-num" title={field.title}>
                  <span class="params-label">{field.label}</span>
                  <div class="params-range-inputs">
                    <NumberField
                      class="params-num"
                      value={toolOptions[props.id][field.key]}
                      onChange={(value) =>
                        setToolOption(props.id, field.key, clampNumber(value, field.value, field))
                      }
                      minValue={field.min}
                      maxValue={field.max}
                      step={field.step}
                      format={false}
                    >
                      <NumberField.Input class="src-num" aria-label={field.label} />
                    </NumberField>
                    <Show when={field.suffix}>
                      <span class="params-dim">{field.suffix}</span>
                    </Show>
                  </div>
                </label>
              }
            >
              <label class="params-field" title={field.title}>
                <span class="params-label">{field.label}</span>
                <SelectField
                  options={field.options ?? []}
                  value={toolOptions[props.id][field.key]}
                  onChange={(value) => setToolOption(props.id, field.key, value)}
                  label={field.label}
                />
              </label>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

function clampNumber(
  raw: string,
  fallback: number,
  field: { min?: number; max?: number },
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const min = field.min ?? -Infinity;
  const max = field.max ?? Infinity;
  return Math.min(max, Math.max(min, parsed));
}
