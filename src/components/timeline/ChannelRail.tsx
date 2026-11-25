import { createEffect, For, on } from "solid-js";
import { channel, channelOptions, setChannel } from "../../state/analysis";
import { RAIL_W, RULER_H } from "./constants";

/**
 * The Timeline's **channel rail** (M23): the lane picked next to the waveform — one radio
 * per lane plus a **Downmix** toggle. It writes the shared analysis param
 * (`state/analysis.ts`), so the waveform, the preview and every analyzer agree (ADR-6).
 * Rendered for a 2+ lane view; `Timeline.tsx` decides the count, and `filterOutputs` says
 * how many leading lanes are the filter graph's outputs, so a lane is labelled for what it
 * shows (`Output n`, or a source channel).
 */
export default function ChannelRail(props: { channels: number; filterOutputs: number }) {
  /** One option per lane (`channelOptions` leads with the downmix entry). */
  const picks = () => channelOptions(props.channels, props.filterOutputs).slice(1);

  // Fall back to the mix when the shown lanes no longer include the pick.
  createEffect(
    on(
      () => props.channels,
      (count) => {
        const pick = channel();
        if (typeof pick === "number" && pick >= count) setChannel("mix");
      },
      { defer: true },
    ),
  );

  return (
    <div class="timeline-channel-rail" style={{ top: `${RULER_H}px`, width: `${RAIL_W}px` }}>
      <button
        type="button"
        class="rail-channel rail-mix"
        data-testid="timeline.channel.mix"
        aria-label="Downmix (mono)"
        aria-pressed={channel() === "mix"}
        title="Downmix (mono)"
        onClick={() => setChannel("mix")}
      >
        Σ
      </button>
      <For each={picks()}>
        {(option) => (
          <label class="rail-channel" title={option.label}>
            <input
              type="radio"
              name="timeline-channel"
              value={String(option.value)}
              data-testid={`timeline.channel.${option.value}`}
              aria-label={option.label}
              checked={channel() === option.value}
              onChange={() => setChannel(option.value)}
            />
            <span class="rail-channel-label">{option.label}</span>
          </label>
        )}
      </For>
    </div>
  );
}
