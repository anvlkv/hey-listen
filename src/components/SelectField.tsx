import { Select } from "@kobalte/core/select";
import { unwrapSingle } from "../lib/kobalte";
import { createPopupMount } from "../lib/popupMount";

/**
 * SelectField — a labeled Kobalte `Select` over `{ value, label }` options, shared
 * by the analyzer params popovers. Keyboard support, typeahead and ARIA wiring come
 * from Kobalte (ADR-8); we only supply appearance via the existing `select-*` /
 * `pop-*` classes.
 */
export interface SelectOption<T> {
  value: T;
  label: string;
}

export default function SelectField<T>(props: {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const portal = createPopupMount();
  const current = () =>
    props.options.find((option) => option.value === props.value) ?? props.options[0];

  return (
    <Select<SelectOption<T>>
      class={`select-field ${props.class ?? ""}`}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={current()}
      disabled={props.disabled}
      onChange={(value) => {
        const option = unwrapSingle(value);
        if (option) props.onChange(option.value);
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
      <Select.Trigger ref={portal.ref} class="select-trigger" aria-label={props.ariaLabel ?? props.label}>
        <Select.Value<SelectOption<T>> class="select-value">
          {(state) => state.selectedOption()?.label ?? ""}
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
