import { Combobox as KCombobox } from "@kobalte/core/combobox";
import { createMemo } from "solid-js";
import { createPopupMount } from "../lib/popupMount";

export interface ComboOption {
  value: string;
  label: string;
}

/**
 * Source-panel combobox: filters a list of options and shows the current choice.
 *
 * A thin wrapper over Kobalte's accessible `Combobox`, keeping our own
 * `{ value, label }` contract with `null` meaning "none". The popup is portaled
 * and positioned by Kobalte/Floating UI, so it flips above the bottom-left panel
 * instead of being clipped by it.
 */
export default function Combobox(props: {
  options: ComboOption[];
  /** Selected option value, or `null` for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Label for an explicit "empty" option (value `null`), if any. */
  emptyLabel?: string;
  placeholder?: string;
  /** Accessible name for the input. */
  label?: string;
  disabled?: boolean;
}) {
  const portal = createPopupMount();
  const all = createMemo<ComboOption[]>(() =>
    props.emptyLabel ? [{ value: "", label: props.emptyLabel }, ...props.options] : props.options,
  );

  const selected = createMemo(() => all().find((option) => option.value === (props.value ?? "")));

  // Kobalte deals in option objects; keep `multiple` off so it is always a single option.
  const pick = (value: ComboOption | ComboOption[] | null): ComboOption | undefined => {
    if (value == null) return undefined;
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <KCombobox<ComboOption>
      class="combo"
      options={all()}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled={() => false}
      value={selected()}
      onChange={(value) => {
        const option = pick(value);
        props.onChange(!option || option.value === "" ? null : option.value);
      }}
      placeholder={props.placeholder}
      disabled={props.disabled}
      triggerMode="focus"
      onOpenChange={(isOpen) => {
        if (isOpen) portal.refresh();
      }}
      sameWidth
      itemComponent={(item) => (
        <KCombobox.Item item={item.item} class="pop-item">
          <KCombobox.ItemLabel class="pop-item-label">
            {item.item.rawValue.label}
          </KCombobox.ItemLabel>
          <KCombobox.ItemIndicator class="pop-item-indicator">✓</KCombobox.ItemIndicator>
        </KCombobox.Item>
      )}
    >
      <KCombobox.Control class="combo-control">
        <KCombobox.Input ref={portal.ref} class="combo-input" aria-label={props.label} />
        <KCombobox.Trigger class="combo-trigger">
          <KCombobox.Icon class="combo-icon">▾</KCombobox.Icon>
        </KCombobox.Trigger>
      </KCombobox.Control>
      <KCombobox.Portal mount={portal.mount()}>
        <KCombobox.Content class="pop-content">
          <KCombobox.Listbox class="pop-listbox" />
        </KCombobox.Content>
      </KCombobox.Portal>
    </KCombobox>
  );
}
