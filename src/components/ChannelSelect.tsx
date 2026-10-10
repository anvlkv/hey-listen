import { Select } from "@kobalte/core/select";
import { createEffect, on } from "solid-js";
import { channel, channelOptions, setChannel, type ChannelOption } from "../state/analysis";
import { source } from "../state/source";
import { unwrapSingle } from "../lib/kobalte";
import { createPopupMount } from "../lib/popupMount";

/**
 * Channel selector for a multichannel source: **downmix to mono** or analyse a
 * single channel. Writes the shared analysis param (`state/analysis.ts`), which
 * drives the Timeline waveform, the preview playback and (M4+) the analysis.
 */
export default function ChannelSelect() {
  const portal = createPopupMount();
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
    <Select<ChannelOption>
      class="timeline-channel"
      options={options()}
      optionValue="value"
      optionTextValue="label"
      value={current()}
      onChange={(value) => {
        const option = unwrapSingle(value);
        if (option) setChannel(option.value);
      }}
      onOpenChange={(isOpen) => {
        if (isOpen) portal.refresh();
      }}
      sameWidth
      itemComponent={(item) => (
        <Select.Item item={item.item} class="pop-item">
          <Select.ItemLabel class="pop-item-label">{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator class="pop-item-indicator">✓</Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger ref={portal.ref} class="select-trigger channel-trigger" aria-label="Channel to analyse">
        <Select.Value<ChannelOption> class="select-value">
          {(state) => state.selectedOption()?.label ?? "Downmix (mono)"}
        </Select.Value>
        <Select.Icon class="select-icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal mount={portal.mount()}>
        <Select.Content class="pop-content">
          <Select.Listbox class="pop-listbox" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
