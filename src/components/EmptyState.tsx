import { Show } from "solid-js";

/**
 * A prominent, reusable empty state: an icon, a title, and a hint that points the
 * user at what to do next. Used by the analyzer tabs (no audio yet) and the
 * Workbench watermark (no views open).
 */
export default function EmptyState(props: {
  icon: string;
  title: string;
  hint?: string;
  /** Render as an overlay that sits over a chart (e.g. the spectrogram). */
  overlay?: boolean;
}) {
  return (
    <div class="analyzer-empty" classList={{ "analyzer-empty-overlay": props.overlay ?? false }}>
      <span class="empty-state-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span class="empty-state-title">{props.title}</span>
      <Show when={props.hint}>
        <span class="empty-state-hint">{props.hint}</span>
      </Show>
    </div>
  );
}
