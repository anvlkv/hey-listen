import type { JSX } from "solid-js";

/**
 * Hint — a compact, framed help line inside a popover.
 *
 * Popover copy is scanned, not read: it sits at a smaller type scale than the
 * controls around it (`.pop-hint` in `styles/popover.css`) and is kept to one short
 * sentence. Name the owner of a rule instead of restating its list.
 *
 * ```tsx
 * <Hint>0 Hz max = Nyquist. The band limit applies to spectral tools.</Hint>
 * ```
 */
export default function Hint(props: { class?: string; children: JSX.Element }) {
  return <p class={props.class ? `pop-hint ${props.class}` : "pop-hint"}>{props.children}</p>;
}
