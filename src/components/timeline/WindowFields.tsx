import { createEffect, createSignal, For } from "solid-js";
import Hint from "../Hint";
import { source } from "../../state/source";
import { reframeWindow, windowEnd, windowStart } from "../../state/timeline";
import { formatTime, parseTime } from "./format";
import { minWindowFor } from "./selection";

/** One editable window coordinate and the text currently in its field. */
type Field = "start" | "end" | "duration";

const FIELDS: { key: Field; label: string; testid: string }[] = [
  { key: "start", label: "Start", testid: "window.start" },
  { key: "end", label: "End", testid: "window.end" },
  { key: "duration", label: "Duration", testid: "window.duration" },
];

/** The formatted text of the three fields, read from the committed window. */
function displayed(): Record<Field, string> {
  return {
    start: formatTime(windowStart()),
    end: formatTime(windowEnd()),
    duration: formatTime(windowEnd() - windowStart()),
  };
}

/**
 * The Timeline's **Window** form (D-05): the analysis window's start, end and duration
 * as editable text, rendered in the popover opened from the toolbar's window-edit
 * trigger. The toolbar readout (`.timeline-readout`) stays a read-only summary and is
 * not touched by this form.
 *
 * A field commits on `Enter` and on blur; `Escape` (and any text [`parseTime`] rejects)
 * reverts to the committed value. Every commit goes through [`reframeWindow`] **without**
 * `frame`, so it clamps to the source and orders the ends exactly like a selection drag;
 * this form only computes the pair the edited field implies (see [`spanFor`]).
 */
export default function WindowFields() {
  // The draft text is local, so typing never writes the window; it re-seeds from the
  // store whenever the committed window (or the source) changes underneath.
  const [draft, setDraft] = createSignal<Record<Field, string>>(displayed());

  const minWindow = () => minWindowFor(source()?.sampleRate);
  const disabled = () => !source();

  createEffect(() => {
    source();
    windowStart();
    windowEnd();
    setDraft(displayed());
  });

  /**
   * The window a field's committed value implies. Only the edited end moves where the
   * rule allows it, the span never drops under the source's minimum, and the result stays
   * inside `[0, duration]` — typing past the end cannot collapse the window to nothing.
   */
  function spanFor(field: Field, value: number): { start: number; end: number } {
    const min = minWindow();
    const start = windowStart();
    const end = windowEnd();
    const duration = source()?.duration ?? Number.POSITIVE_INFINITY;
    const cap = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    switch (field) {
      case "start": {
        const nextStart = Math.max(0, Math.min(value, Math.max(0, cap - min)));
        return { start: nextStart, end: Math.max(nextStart + min, end) };
      }
      case "end": {
        const nextEnd = Math.max(min, Math.min(value, cap));
        return { start: Math.min(start, Math.max(0, nextEnd - min)), end: nextEnd };
      }
      case "duration": {
        const nextEnd = Math.min(cap, start + Math.max(min, value));
        return { start, end: Math.max(nextEnd, Math.min(cap, start + min)) };
      }
    }
  }

  /** The live value the edited field shows, for the no-op check. */
  function current(field: Field): number {
    if (field === "start") return windowStart();
    if (field === "end") return windowEnd();
    return windowEnd() - windowStart();
  }

  /** Parse the field's text, reframe, then show what was actually committed. */
  function commit(field: Field) {
    const value = disabled() ? null : parseTime(draft()[field]);
    // A blur without an edit (or a value the window already has) must not re-round the
    // committed window: the fields display two decimals, so writing them back would drift.
    if (value != null && Math.abs(value - current(field)) > 1e-3) {
      const span = spanFor(field, value);
      reframeWindow({ start: span.start, end: span.end });
    }
    setDraft(displayed());
  }

  /** Replace one field's draft text, leaving the other two alone. */
  function editDraft(field: Field, text: string) {
    setDraft((current) => {
      const next: Record<Field, string> = { ...current };
      next[field] = text;
      return next;
    });
  }

  function onKeyDown(event: KeyboardEvent, field: Field) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(field);
    } else if (event.key === "Escape") {
      // Revert and keep the popover open: Kobalte dismisses on Escape from a
      // document-level listener, which only `stopImmediatePropagation` reaches.
      event.preventDefault();
      event.stopImmediatePropagation();
      setDraft(displayed());
    }
  }

  return (
    <div class="params-form">
      <div class="params-heading">
        Window <span class="params-dim">analysis region</span>
      </div>
      <For each={FIELDS}>
        {(field) => (
          <label class="params-field">
            <span class="params-label">{field.label}</span>
            <input
              class="src-num timeline-window-field"
              type="text"
              aria-label={`Analysis window ${field.label.toLowerCase()}`}
              data-testid={field.testid}
              value={draft()[field.key]}
              disabled={disabled()}
              onInput={(event) => editDraft(field.key, event.currentTarget.value)}
              onBlur={() => commit(field.key)}
              onKeyDown={(event) => onKeyDown(event, field.key)}
            />
          </label>
        )}
      </For>
      <Hint>
        <code>m:ss.mmm</code>, <code>h:mm:ss</code> or bare seconds. Enter applies, Escape reverts.
      </Hint>
    </div>
  );
}
