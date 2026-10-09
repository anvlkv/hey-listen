import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { source } from "../../state/source";
import { setWindowEnd, setWindowStart } from "../../state/timeline";

/** Where to place the menu and the time it targets. */
export interface ReframeTarget {
  /** Pointer position in **client** (viewport) coordinates, px. */
  x: number;
  y: number;
  /** The time under the pointer, in seconds. */
  time: number;
}

/** Clamp a time to the current source's `[0, duration]`. */
function clampToSource(time: number): number {
  const duration = source()?.duration ?? 0;
  return Math.min(Math.max(time, 0), duration);
}

/**
 * Shared right-click context menu for the time-domain analyzer charts (M5+): from
 * the time under the pointer, set the **timeline** analysis-window start or end.
 * Rendered in a portal at the pointer; closes on selection, an outside click, or
 * `Escape`. The charts own the open state (a [`ReframeTarget`] signal). See
 * `docs/ui-layout.md`.
 */
export default function ReframeMenu(props: {
  target: ReframeTarget | null;
  onClose: () => void;
}) {
  let menu!: HTMLDivElement;
  const [hover, setHover] = createSignal<"start" | "end" | null>(null);

  const apply = (which: "start" | "end") => {
    const active = props.target;
    if (!active) return;
    const time = clampToSource(active.time);
    if (which === "start") setWindowStart(time);
    else setWindowEnd(time);
    props.onClose();
  };

  // Close on a click anywhere outside the menu, or on Escape.
  createEffect(() => {
    if (!props.target) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={props.target}>
      {(target) => (
        <Portal>
          <div
            ref={menu}
            class="pop-content reframe-menu"
            role="menu"
            aria-label="Set analysis window"
            onContextMenu={(event) => event.preventDefault()}
            style={{ position: "fixed", left: `${target().x}px`, top: `${target().y}px` }}
          >
            <button
              type="button"
              role="menuitem"
              class="pop-item"
              style={{ background: hover() === "start" ? "var(--control-2)" : undefined }}
              onPointerEnter={() => setHover("start")}
              onPointerLeave={() => setHover(null)}
              onClick={() => apply("start")}
            >
              Set window start here
            </button>
            <button
              type="button"
              role="menuitem"
              class="pop-item"
              style={{ background: hover() === "end" ? "var(--control-2)" : undefined }}
              onPointerEnter={() => setHover("end")}
              onPointerLeave={() => setHover(null)}
              onClick={() => apply("end")}
            >
              Set window end here
            </button>
          </div>
        </Portal>
      )}
    </Show>
  );
}
