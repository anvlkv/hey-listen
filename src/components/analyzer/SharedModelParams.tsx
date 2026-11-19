import { NumberField } from "@kobalte/core/number-field";
import { Show } from "solid-js";
import { createNumberDrag } from "../../lib/dragNumber";
import { analyzerById } from "../../state/analyzer/lookup";
import {
  fanOutOption,
  sharedOptionValue,
  toolsDeclaring,
  type SharedModelOption,
} from "../../state/analyzer/options";
import type { ToolParamField } from "../../state/analyzer/types";

/**
 * **Model** params (D-07 / D-08): one control per option whose value means the same
 * thing in every tool that declares it — the pitch f0 band and the perception
 * calibration. Editing a field fans the value out to each declaring tool's own store
 * entry, so per-tool overrides and project persistence keep working and no shared IPC
 * field (or project-file schema) is added.
 *
 * Which tools a row reaches comes from the catalog through `toolsDeclaring`; a row is
 * hidden when no tool declares its key.
 */
export default function SharedModelParams() {
  const pitch = () => toolsDeclaring("minF0Hz").length > 0 || toolsDeclaring("maxF0Hz").length > 0;
  const calibration = () => toolsDeclaring("calibrationDbSpl").length > 0;

  return (
    <Show when={pitch() || calibration()}>
      <div class="params-form">
        <div class="params-heading">
          Model params <span class="params-dim">applies to every matching tool</span>
        </div>

        <Show when={pitch()}>
          <ModelField option="minF0Hz" label="Min f0" testid="shared.pitch.min" />
          <ModelField option="maxF0Hz" label="Max f0" testid="shared.pitch.max" />
          <div class="params-note">The f0 search band for every pitch tool.</div>
        </Show>

        <Show when={calibration()}>
          <ModelField option="calibrationDbSpl" label="Calibration" testid="shared.calibration" />
          <div class="params-note">
            0 dB SPL means uncalibrated; absolute sones/phons/aspers/vacils need a value.
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** One fanned-out number field: step, suffix and range come from the catalog. */
function ModelField(props: { option: SharedModelOption; label: string; testid: string }) {
  const fields = () => declarationsOf(props.option);
  const first = () => fields()[0];
  const step = () => first()?.step ?? 5;
  const min = () => lowest(fields());
  const max = () => highest(fields());

  const current = () => sharedOptionValue(props.option) ?? first()?.value ?? 0;
  const commit = (raw: string | number) => {
    const parsed = parseNumber(raw);
    if (parsed == null) return;
    fanOutOption(props.option, clamp(parsed, min(), max()));
  };

  // Dragging is the same gesture as the frequency-range fields (M7).
  const drag = createNumberDrag({
    value: current,
    onInput: commit,
    step: step(),
    min: min(),
    max: max(),
  });

  return (
    <Show when={fields().length > 0}>
      <div class="params-field params-field-num" data-testid={props.testid}>
        <span class="params-label">{props.label}</span>
        <div class="params-range-inputs">
          <NumberField
            class="params-num"
            value={current()}
            onChange={commit}
            minValue={min()}
            maxValue={max()}
            step={step()}
            format={false}
          >
            <NumberField.Input
              class={`src-num num-drag${drag.dragging() ? " num-dragging" : ""}`}
              aria-label={first()?.suffix ? `${props.label} (${first()?.suffix})` : props.label}
              {...drag.handlers}
            />
          </NumberField>
          <Show when={first()?.suffix}>
            <span class="params-dim">{first()?.suffix}</span>
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** Every catalog declaration of one model option, in Sidebar order. */
function declarationsOf(option: SharedModelOption): ToolParamField[] {
  const fields: ToolParamField[] = [];
  for (const id of toolsDeclaring(option)) {
    for (const field of analyzerById(id).params ?? []) {
      if (field.key === option) fields.push(field);
    }
  }
  return fields;
}

/** The union of the declaring tools' lower bounds (the widest range any of them allows). */
function lowest(fields: ToolParamField[]): number | undefined {
  const bounds = fields.map((field) => field.min).filter((value): value is number => value != null);
  return bounds.length > 0 ? Math.min(...bounds) : undefined;
}

/** The union of the declaring tools' upper bounds. */
function highest(fields: ToolParamField[]): number | undefined {
  const bounds = fields.map((field) => field.max).filter((value): value is number => value != null);
  return bounds.length > 0 ? Math.max(...bounds) : undefined;
}

/** Clamp into the declaring tools' union, so every tool receives a value it accepts. */
function clamp(value: number, min: number | undefined, max: number | undefined): number {
  const above = min == null ? value : Math.max(min, value);
  return max == null ? above : Math.min(max, above);
}

/** A typed or dragged value; `null` for an empty or non-numeric entry (never written). */
function parseNumber(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
