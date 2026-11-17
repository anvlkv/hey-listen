import { createResource, Show } from "solid-js";
import { markdownPlain, renderMarkdown } from "../lib/markdown";

/**
 * A **formatted**, compact markdown hint for a [`Tooltip`](./Tooltip.tsx)'s content —
 * the Sidebar's analyzer rows hover copy.
 *
 * The source is a tool's compact preview (`lib/markdown.ts` → [`markdownSummary`]:
 * bold lead-ins as titles, paragraphs kept apart, trimmed to a few lines). It is
 * rendered by the same sanitizing pipeline as the About panel (`renderMarkdown`, a
 * dynamic import), with the plain-text version shown while that chunk loads. The
 * shared `.markdown-body` styles carry its paragraphs and inline code; `.tooltip-markdown`
 * only softens the body text under the popup's type scale.
 */
export default function MarkdownHint(props: { source: string }) {
  const [html] = createResource(() => props.source, renderMarkdown);

  return (
    <Show when={html()} fallback={markdownPlain(props.source)}>
      {(body) => (
        <div
          class="tooltip-markdown markdown-body"
          // `renderMarkdown` output (marked + DOMPurify sanitized).
          // eslint-disable-next-line solid/no-innerhtml -- sanitized registry copy
          innerHTML={body()}
        />
      )}
    </Show>
  );
}
