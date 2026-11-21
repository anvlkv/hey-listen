import { For } from "solid-js";

/** The zone (and colour) a segment falls into, as a fraction of the meter's length. */
type Zone = "low" | "mid" | "high";

/** Boundaries between the green / amber / red zones, as a fraction of full scale. */
const MID_ZONE = 0.62;
const HIGH_ZONE = 0.82;

function zoneAt(position: number): Zone {
  if (position > HIGH_ZONE) return "high";
  if (position > MID_ZONE) return "mid";
  return "low";
}

/**
 * A segmented, analog-style level meter: discrete bars with rounded corners and small
 * gaps over a dark housing, lit left-to-right in desaturated green / amber / red. The
 * bar under the current decimal value (`value % 1`) is drawn dimmer, so a rising level
 * reads as a brightening bar instead of a jumping one. Shared by the input (source
 * panel), output (toolbar) and `levels` readout meters — see `styles/shared.css`.
 */
export default function SegmentedMeter(props: {
  /** Position on the meter, 0…100. */
  value: number;
  /** Optional peak-hold position (0…100), drawn as a thin marker. */
  hold?: number;
  /** Number of bars; defaults to 24. Ignored values below 1 are clamped. */
  segments?: number;
  class?: string;
}) {
  const count = () => Math.max(1, props.segments ?? 24);
  const filled = () => (Math.max(0, Math.min(100, props.value)) / 100) * count();

  /** How much of segment `index` the value covers: 0 = off, 1 = fully lit. */
  const levelAt = (index: number) => Math.max(0, Math.min(1, filled() - index));

  return (
    <div class={`segmeter ${props.class ?? ""}`} aria-hidden="true">
      <For each={Array.from({ length: count() }, (_, index) => index)}>
        {(index) => {
          const level = () => levelAt(index);
          const partial = () => level() > 0 && level() < 1;
          return (
            <span
              class={`segmeter-seg segmeter-${zoneAt((index + 1) / count())}`}
              classList={{ "segmeter-lit": level() >= 1, "segmeter-partial": partial() }}
              style={{ opacity: partial() ? String(0.22 + 0.6 * level()) : undefined }}
            />
          );
        }}
      </For>
      {props.hold != null && (
        <span
          class="segmeter-hold"
          style={{ left: `${Math.max(0, Math.min(100, props.hold))}%` }}
        />
      )}
    </div>
  );
}
