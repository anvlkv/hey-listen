import Tooltip from "./Tooltip";
import type { SplitterHandlers } from "../lib/splitter";

interface SplitterProps {
  /** Which axis it resizes: `vertical` a column (width), `horizontal` a row (height). */
  orientation: "horizontal" | "vertical";
  /** `data-testid` for the E2E suite. */
  testId: string;
  /** Tooltip text. */
  label: string;
  /** Accessible name for the `separator`. */
  ariaLabel: string;
  handlers: SplitterHandlers;
}

/** A draggable layout splitter (a `separator`) with its tooltip chrome. */
export default function Splitter(props: SplitterProps) {
  return (
    <Tooltip label={props.label}>
      <div
        class={props.orientation === "vertical" ? "app-vsplitter" : "app-splitter"}
        data-testid={props.testId}
        role="separator"
        aria-orientation={props.orientation}
        aria-label={props.ariaLabel}
        onPointerDown={(event) => props.handlers.onPointerDown(event)}
        onPointerMove={(event) => props.handlers.onPointerMove(event)}
        onPointerUp={(event) => props.handlers.onPointerUp(event)}
        onPointerCancel={(event) => props.handlers.onPointerUp(event)}
      />
    </Tooltip>
  );
}
