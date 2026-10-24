import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { source } from "../../state/source";
import { createNote } from "../../state/notes";
import { setWindowEnd, setWindowStart } from "../../state/timeline";
import type { AnalyzerId } from "../../state/analyzer";

/** Where to place the menu, the time it targets, and the chart's plot rectangle. */
export interface ReframeTarget {
  /** Pointer position in **client** (viewport) coordinates, px. */
  x: number;
  y: number;
  /** The time under the pointer, in seconds (source seconds). */
  time: number;
  /** The chart's plot area in client coordinates, so the callout marks the chart
   * itself rather than the whole window. */
  top: number;
  height: number;
}

/** Clamp a time to the current source's `[0, duration]`. */
function clampToSource(time: number): number {
  const duration = source()?.duration ?? 0;
  return Math.min(Math.max(time, 0), duration);
}

/**
 * Shared right-click context menu for the time-domain analyzer charts (M5+): from
 * the time under the pointer, set the **timeline** analysis-window start or end, or
 * add a **note** at that time (M14). A vertical callout marks the exact time on the
 * chart; the menu closes on selection, an outside click, or `Escape`. See
 * `docs/ui-layout.md` and `docs/notes.md`.
 */
export default function ReframeMenu(props: {
  target: ReframeTarget | null;
  onClose: () => void;
  /** The chart's analyzer id — the tool a note added here is attached to. */
  tool?: AnalyzerId;
}) {
  let menu!: HTMLDivElement;
  const [hover, setHover] = createSignal<"start" | "end" | "note" | null>(null);

  const apply = (which: "start" | "end") => {
    const active = props.target;
    if (!active) return;
    const time = clampToSource(active.time);
    if (which === "start") setWindowStart(time);
    else setWindowEnd(time);
    props.onClose();
  };

  const addNote = () => {
    const active = props.target;
    if (!active) return;
    createNote({ timeSecs: clampToSource(active.time), tool: props.tool ?? null });
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
          {/* Callout line marking the exact time on the chart (bounded to it). */}
          <div
            class="reframe-callout"
            style={{
              left: `${target().x}px`,
              top: `${target().top}px`,
              height: `${target().height}px`,
            }}
            aria-hidden="true"
          />
          <div
            ref={(node) => (menu = node)}
            class="reframe-menu"
            role="menu"
            aria-label="Set analysis window"
            onContextMenu={(event) => event.preventDefault()}
            style={{ position: "fixed", left: `${target().x}px`, top: `${target().y}px` }}
          >
            <div class="reframe-menu-title">Set window at {target().time.toFixed(3)} s</div>
            <button
              type="button"
              role="menuitem"
              class="reframe-btn"
              data-hover={hover() === "start" || undefined}
              onPointerEnter={() => setHover("start")}
              onPointerLeave={() => setHover(null)}
              onClick={() => apply("start")}
            >
              Set window start here
            </button>
            <button
              type="button"
              role="menuitem"
              class="reframe-btn"
              data-hover={hover() === "end" || undefined}
              onPointerEnter={() => setHover("end")}
              onPointerLeave={() => setHover(null)}
              onClick={() => apply("end")}
            >
              Set window end here
            </button>
            <button
              type="button"
              role="menuitem"
              class="reframe-btn"
              data-hover={hover() === "note" || undefined}
              onPointerEnter={() => setHover("note")}
              onPointerLeave={() => setHover(null)}
              onClick={addNote}
            >
              Add annotation here
            </button>
          </div>
        </Portal>
      )}
    </Show>
  );
}
