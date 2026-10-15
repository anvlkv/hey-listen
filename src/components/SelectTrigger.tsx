import { Select } from "@kobalte/core/select";
import { unwrapSingle } from "../lib/kobalte";
import { createPopupMount } from "../lib/popupMount";

/** The `{ value, label }` option shape every select in the app shares. */
export interface SelectOption<T> {
  value: T;
  label: string;
}

/**
 * SelectTrigger — the single Kobalte `Select` behind every `{ value, label }`
 * dropdown in the app (the analyzer params, the timeline channel picker, the
 * source-kind picker).
 *
 * It owns the trigger chrome (value readout + chevron) and the portaled popup, so
 * the `select-trigger` / `select-value` / `select-icon` / `pop-*` markup lives in
 * one place; callers pass the options, the selected option and the change handler.
 * Keyboard support, typeahead and ARIA wiring come from Kobalte (ADR-8).
 */
export interface SelectTriggerProps<T> {
  options: SelectOption<T>[];
  /** The selected option, or `undefined` for none. */
  value: SelectOption<T> | undefined;
  onChange: (value: T) => void;
  /** Readout text shown while nothing is selected. */
  placeholder: string;
  /** Class for the `Select` root. */
  class?: string;
  /** Extra class(es) for the trigger, appended to `select-trigger`. */
  triggerClass?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
}

export default function SelectTrigger<T>(props: SelectTriggerProps<T>) {
  const portal = createPopupMount();

  return (
    <Select<SelectOption<T>>
      class={props.class}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={props.value}
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
      <Select.Trigger
        ref={portal.ref}
        class={props.triggerClass ? `select-trigger ${props.triggerClass}` : "select-trigger"}
        aria-label={props.ariaLabel}
        data-testid={props.testId}
      >
        <Select.Value<SelectOption<T>> class="select-value">
          {(state) => state.selectedOption()?.label ?? props.placeholder}
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
