import { createMemo } from "solid-js";
import SelectTrigger, { type SelectOption } from "./SelectTrigger";

export type { SelectOption };

/**
 * SelectField — a labeled Kobalte `Select` over `{ value, label }` options, shared
 * by the analyzer params popovers. Keyboard support, typeahead and ARIA wiring come
 * from Kobalte (ADR-8); we only supply appearance via the existing `select-*` /
 * `pop-*` classes. The markup itself lives in `SelectTrigger`.
 */
export default function SelectField<T>(props: {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  // A memo, not a plain function, so the lookup (and the option the `Select` receives as
  // its value) keeps its identity between unrelated re-renders.
  const current = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? props.options[0],
  );

  return (
    <SelectTrigger
      class={`select-field ${props.class ?? ""}`}
      options={props.options}
      value={current()}
      onChange={props.onChange}
      placeholder=""
      ariaLabel={props.ariaLabel ?? props.label}
      disabled={props.disabled}
    />
  );
}
