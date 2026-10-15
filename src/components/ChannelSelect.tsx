import { createEffect, on } from "solid-js";
import { channel, channelOptions, setChannel } from "../state/analysis";
import { source } from "../state/source";
import SelectTrigger from "./SelectTrigger";

/**
 * Channel selector for a multichannel source: **downmix to mono** or analyse a
 * single channel. Writes the shared analysis param (`state/analysis.ts`), which
 * drives the Timeline waveform, the preview playback and (M4+) the analysis.
 */
export default function ChannelSelect() {
  const channels = () => Math.max(1, source()?.channels ?? 1);
  const options = () => channelOptions(channels());
  const current = () => options().find((option) => option.value === channel()) ?? options()[0];

  // Fall back to the mix when a new source has fewer channels than the pick.
  createEffect(
    on(
      channels,
      (count) => {
        const pick = channel();
        if (typeof pick === "number" && pick >= count) setChannel("mix");
      },
      { defer: true },
    ),
  );

  return (
    <SelectTrigger
      class="timeline-channel"
      options={options()}
      value={current()}
      onChange={(value) => setChannel(value)}
      placeholder="Downmix (mono)"
      triggerClass="channel-trigger"
      ariaLabel="Channel to analyse"
    />
  );
}
