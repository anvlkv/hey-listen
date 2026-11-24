import { RadioGroup } from "@kobalte/core/radio-group";
import { For, Show } from "solid-js";
import type { SourceStorage } from "../../bindings/SourceStorage";
import { STORAGE_OPTIONS } from "../../state/sourceStorage";

/**
 * The storage-mode chooser as three stacked radio **cards** (Kobalte `RadioGroup`).
 *
 * One card per entry of `STORAGE_OPTIONS`, so the panel and the post-pick dialog can
 * never drift apart. A mode the panel may not switch to is rendered **disabled**, with
 * the reason as its hint (and `title`): a disabled radio is announced, a hidden one is
 * not. Arrow keys move between cards and select them, as a radio group should.
 */
export default function StorageCards(props: {
  value: SourceStorage;
  onChange: (mode: SourceStorage) => void;
  /** Why `mode` may not be picked (null = allowed); shown under a disabled card. */
  disabledReason?: (mode: SourceStorage) => string | null;
  testIdPrefix?: string;
}) {
  const prefix = () => props.testIdPrefix ?? "source.storage";

  /** Selected and disabled are facts of the controlled value, so they are plain classes. */
  const cardClass = (mode: SourceStorage, reason: string | null) => {
    const selected = props.value === mode ? " storage-card-selected" : "";
    const disabled = reason != null ? " storage-card-disabled" : "";
    return `storage-card${selected}${disabled}`;
  };

  return (
    <RadioGroup
      class="storage-cards"
      value={props.value}
      onChange={(value) => {
        // Kobalte reports the radio's string value; map it back through the one table.
        const option = STORAGE_OPTIONS.find((candidate) => candidate.value === value);
        if (option) props.onChange(option.value);
      }}
      data-testid={prefix()}
      aria-label="How this project stores its audio"
    >
      <For each={STORAGE_OPTIONS}>
        {(option) => {
          const reason = () => props.disabledReason?.(option.value) ?? null;
          return (
            <RadioGroup.Item
              value={option.value}
              class={cardClass(option.value, reason())}
              disabled={reason() != null}
              title={reason() ?? undefined}
              data-testid={`${prefix()}.${option.value}`}
              onClick={() => {
                // Kobalte selects from the control; the whole card is one pointer target
                // for the user (and for a scripted click), so mirror it here.
                if (reason() == null) props.onChange(option.value);
              }}
            >
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="storage-card-control">
                <RadioGroup.ItemIndicator class="storage-card-dot" />
              </RadioGroup.ItemControl>
              <div class="storage-card-copy">
                <RadioGroup.ItemLabel class="storage-card-label">
                  {option.label}
                </RadioGroup.ItemLabel>
                <span class="storage-card-hint">{option.hint}</span>
                <Show when={reason()}>
                  {(text) => <span class="storage-card-blocked">{text()}</span>}
                </Show>
              </div>
            </RadioGroup.Item>
          );
        }}
      </For>
    </RadioGroup>
  );
}
