import { Button as KButton } from "@kobalte/core/button";
import type { ComponentProps } from "solid-js";

/**
 * Button — a thin wrapper over Kobalte's `Button`, so every button in the app
 * goes through the same primitive (consistent focus/disabled handling, and
 * `data-disabled` / `data-pressed` hooks for styling). Defaults to
 * `type="button"` since none of our buttons submit a form.
 */
export default function Button(props: ComponentProps<"button">) {
  return <KButton type="button" {...props} />;
}
