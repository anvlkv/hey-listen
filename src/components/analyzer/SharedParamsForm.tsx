import { NumberField } from "@kobalte/core/number-field";
import { Switch } from "@kobalte/core/switch";
import ChannelSelect from "../ChannelSelect";
import SelectField from "../SelectField";
import Tooltip from "../Tooltip";
import { createNumberDrag } from "../../lib/dragNumber";
import {
  ANALYSIS_RATES,
  FFT_SIZE_HELP,
  FFT_SIZES,
  HOP_OPTIONS,
  WINDOW_FNS,
  fftSize,
  freqMaxHz,
  freqMinHz,
  hop,
  randomizedOverlap,
  resampleTo,
  setFftSize,
  setFreqMaxHz,
  setFreqMinHz,
  setHop,
  setRandomizedOverlap,
  setResampleTo,
  setWindowFn,
  windowFn,
} from "../../state/analysis";

/**
 * The **shared** analysis params (ADR-6), rendered from the main **Toolbar** (via a
 * popover). Editing any control updates the one frontend store, so every open tool
 * re-runs with the same conditioning. Per-tool params are appended by the tool.
 *
 * See `docs/analysis-tools.md` → "Shared parameters".
 */
export default function SharedParamsForm() {
  const fftOptions = FFT_SIZES.map((size) => ({ value: size, label: `${size}` }));
  const hopOptions = HOP_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

  // "When to use which" help for the current choice, surfaced as each field's
  // tooltip. The per-option copy lives in `state/analysis.ts`.
  const fftHelp = () => FFT_SIZE_HELP[fftSize()];
  const hopHelp = () => HOP_OPTIONS.find((option) => option.value === hop())?.help;
  const windowHelp = () => WINDOW_FNS.find((option) => option.value === windowFn())?.help;
  const rateHelp = () => ANALYSIS_RATES.find((option) => option.value === resampleTo())?.help;

  // The frequency-range fields also accept drag-to-adjust (M7).
  const freqMinDrag = createNumberDrag({
    value: freqMinHz,
    onInput: (value) => setFreqMinHz(Math.max(0, Math.round(value))),
    step: 50,
    min: 0,
  });
  const freqMaxDrag = createNumberDrag({
    value: freqMaxHz,
    onInput: (value) => setFreqMaxHz(Math.max(0, Math.round(value))),
    step: 50,
    min: 0,
  });

  return (
    <div class="params-form">
      <div class="params-heading">
        Shared params <span class="params-dim">synced across tools</span>
      </div>

      <Tooltip label={fftHelp()}>
        <label class="params-field">
          <span class="params-label">FFT size</span>
          <SelectField
            options={fftOptions}
            value={fftSize()}
            onChange={setFftSize}
            label="FFT size"
          />
        </label>
      </Tooltip>

      <Tooltip label={hopHelp()}>
        <label class="params-field">
          <span class="params-label">Hop / overlap</span>
          <SelectField options={hopOptions} value={hop()} onChange={setHop} label="Hop / overlap" />
        </label>
      </Tooltip>

      <Tooltip label={windowHelp()}>
        <label class="params-field">
          <span class="params-label">Window</span>
          <SelectField
            options={WINDOW_FNS}
            value={windowFn()}
            onChange={setWindowFn}
            label="Window function"
          />
        </label>
      </Tooltip>

      <Tooltip label="Which channel to analyse. Downmix sums all channels to mono; Left/Right (or Channel N) picks one. Applies to every tool.">
        <label class="params-field">
          <span class="params-label">Channel</span>
          <ChannelSelect />
        </label>
      </Tooltip>

      <Tooltip label={rateHelp()}>
        <label class="params-field">
          <span class="params-label">Analysis rate</span>
          <SelectField
            options={ANALYSIS_RATES}
            value={resampleTo()}
            onChange={setResampleTo}
            label="Analysis sample rate"
          />
        </label>
      </Tooltip>

      <div class="params-field">
        <span class="params-label">Randomized overlap</span>
        <Tooltip label="Average a second STFT offset by half a hop (breaks the frame grid)">
          <Switch
            class="params-switch"
            checked={randomizedOverlap()}
            onChange={setRandomizedOverlap}
          >
            <Switch.Input class="params-switch-input" />
            <Switch.Control class="params-switch-control">
              <Switch.Thumb class="params-switch-thumb" />
            </Switch.Control>
          </Switch>
        </Tooltip>
      </div>

      <Tooltip label="Band-limit spectral and pitch tools to this Hz range (0 Hz max means up to Nyquist).">
        <div class="params-field params-range">
          <span class="params-label">Frequency range</span>
          <div class="params-range-inputs">
            <NumberField
              class="params-num"
              value={freqMinHz()}
              onChange={(value) => setFreqMinHz(nonNegative(value, 0))}
              minValue={0}
              step={50}
              format={false}
            >
              <NumberField.Input
                class={`src-num num-drag${freqMinDrag.dragging() ? " num-dragging" : ""}`}
                aria-label="Minimum frequency (Hz)"
                {...freqMinDrag.handlers}
              />
            </NumberField>
            <span class="params-dim">–</span>
            <NumberField
              class="params-num"
              value={freqMaxHz()}
              onChange={(value) => setFreqMaxHz(nonNegative(value, 0))}
              minValue={0}
              step={50}
              format={false}
            >
              <NumberField.Input
                class={`src-num num-drag${freqMaxDrag.dragging() ? " num-dragging" : ""}`}
                placeholder="Nyquist"
                aria-label="Maximum frequency (Hz)"
                {...freqMaxDrag.handlers}
              />
            </NumberField>
            <span class="params-dim">Hz</span>
          </div>
        </div>
      </Tooltip>

      <div class="params-note">
        0 Hz max means up to Nyquist; the band limit applies to spectral tools.
      </div>
    </div>
  );
}

function nonNegative(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}
