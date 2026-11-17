/**
 * Markdown → sanitized HTML for an annotation's body (M14) and an analyzer's About copy.
 *
 * Annotation bodies are **raw markdown** (stored as-is); rendering is **sanitized** so a
 * pasted annotation cannot inject markup, scripts, or event handlers. `marked` renders
 * (GFM), then DOMPurify strips anything outside its HTML allow-list. The About copy
 * is trusted registry text, but rides the same pipeline. See `docs/annotations.md` →
 * Markdown and `docs/dependencies.md`.
 *
 * `marked` and `dompurify` are loaded with a **dynamic import** (and cached): they are
 * only needed once an annotation preview or an About panel is shown, so keeping them out of
 * the initial bundle avoids paying ~130 kB up front. The app can therefore render a
 * preview asynchronously (see `components/AnnotationsPanel.tsx` and
 * `components/analyzer/AnalyzerTab.tsx`). The tooltip hint
 * (`components/MarkdownHint.tsx`) rides the same pipeline.
 *
 * [`markdownSummary`] and [`markdownPlain`] stay synchronous — they trim the copy's
 * source, they do not render it.
 */

type Render = (body: string) => string;

let renderer: Promise<Render> | null = null;

/** Load `marked` + DOMPurify once and return the sanitizing renderer. */
function loadRenderer(): Promise<Render> {
  return (renderer ??= Promise.all([import("marked"), import("dompurify")]).then(
    ([{ marked }, { default: DOMPurify }]) =>
      (body: string) => {
        if (!body.trim()) return "";
        const html = marked.parse(body, { async: false, gfm: true, breaks: false });
        // `async: false` guarantees a string (the promise form is only used when async).
        return DOMPurify.sanitize(typeof html === "string" ? html : "");
      },
  ));
}

/** Render an annotation body to sanitized HTML. */
export async function renderMarkdown(body: string): Promise<string> {
  const render = await loadRenderer();
  return render(body);
}

/** One paragraph of copy as a summary sees it: a plain bold lead-in and its text. */
type SummaryBlock = { title: string; text: string };

/** The wide space that separates a hint's bold title from the copy that follows it. */
const TITLE_GAP = "\u2003";

/** The shortest body worth starting another paragraph for, in a truncated hint. */
const MIN_BLOCK_TEXT = 16;

/** Drop inline emphasis markers (`**`, `*`, `` ` ``, `~`). */
function unmark(text: string): string {
  return text.replace(/[*_`~]/g, "");
}

/**
 * A markdown span with links resolved and block markers (headings, bullets) removed and
 * its whitespace collapsed — but its inline emphasis kept, so a hint can show it.
 */
function inlineMarkdown(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A markdown span as plain text: [`inlineMarkdown`] without the emphasis markers. */
function inlineText(markdown: string): string {
  return unmark(inlineMarkdown(markdown));
}

/** The copy's paragraphs, with a leading `**lead-in**` split off as a plain title. */
function summaryBlocks(body: string): SummaryBlock[] {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lead = /^\*\*([^*]+)\*\*\s*/.exec(block);
      return {
        title: lead ? inlineText(lead[1]) : "",
        text: inlineMarkdown(lead ? block.slice(lead[0].length) : block),
      };
    })
    .filter((block) => block.title.length > 0 || inlineText(block.text).length > 0);
}

/** Cut plain text to `room` characters at a word boundary, marking the cut with `…`. */
function clampWords(text: string, room: number): string {
  if (text.length <= room) return text;
  const cut = text.slice(0, Math.max(0, room)).trimEnd();
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * A **compact, formatted** preview of markdown copy for a tooltip (the Sidebar's analyzer
 * rows): each paragraph keeps its bold lead-in as a title, followed by a wide space, and
 * the paragraphs stay separated — so the hint reads as formatted text rather than one
 * flattened line. Inline emphasis inside a paragraph is kept. The copy is trimmed to
 * about `max` characters at a word boundary with a trailing `…`, which is what keeps the
 * hint smaller than the tool's About popover; the remaining copy lives there. A paragraph
 * cut mid-way is flattened, so a truncation cannot leave half an emphasis span. The
 * output is markdown, rendered by [`renderMarkdown`]. Kept synchronous so it never blocks
 * a hover.
 */
export function markdownSummary(body: string, max?: number): string {
  const budget = max ?? Infinity;
  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  for (const { title, text } of summaryBlocks(body)) {
    const gap = title && text ? TITLE_GAP : "";
    const head = title ? `**${title}**${gap}` : "";
    const room = budget - used - head.length;
    // A later paragraph must fit a meaningful line, or it is left to the About panel.
    if (parts.length > 0 && room < MIN_BLOCK_TEXT) {
      truncated = true;
      break;
    }
    if (text.length > room) {
      parts.push(`${head}${clampWords(unmark(text), room)}`);
      break;
    }
    parts.push(`${head}${text}`);
    // Title + text + the blank line that separates paragraphs.
    used += head.length + text.length + 2;
  }

  const last = parts[parts.length - 1];
  if (truncated && last !== undefined && !last.endsWith("…")) {
    parts[parts.length - 1] = `${last} …`;
  }
  return parts.join("\n\n");
}

/**
 * The same preview flattened to **one plain-text line** (a hint's loading fallback, the
 * About panel's): titles run into their text, emphasis goes, paragraphs join with a
 * space, and `max` optionally ellipsises. Kept synchronous so it never blocks a hover.
 */
export function markdownPlain(body: string, max?: number): string {
  const plain = summaryBlocks(body)
    .map(({ title, text }) => (title ? `${title} ${unmark(text)}` : unmark(text)))
    .join(" ");
  return max === undefined ? plain : clampWords(plain, max);
}
