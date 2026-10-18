/**
 * Markdown → sanitized HTML for a note's body (M14) and an analyzer's About copy.
 *
 * Note bodies are **raw markdown** (stored as-is); rendering is **sanitized** so a
 * pasted note cannot inject markup, scripts, or event handlers. `marked` renders
 * (GFM), then DOMPurify strips anything outside its HTML allow-list. The About copy
 * is trusted registry text, but rides the same pipeline. See `docs/notes.md` →
 * Markdown and `docs/dependencies.md`.
 *
 * `marked` and `dompurify` are loaded with a **dynamic import** (and cached): they are
 * only needed once a note preview or an About panel is shown, so keeping them out of
 * the initial bundle avoids paying ~130 kB up front. The app can therefore render a
 * preview asynchronously (see `components/NotesPanel.tsx` and
 * `components/analyzer/AnalyzerTab.tsx`).
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

/** Render a note body to sanitized HTML. */
export async function renderMarkdown(body: string): Promise<string> {
  const render = await loadRenderer();
  return render(body);
}

/**
 * A single-line plain-text preview of markdown copy (tooltips, loading fallbacks):
 * strips headings, list bullets, links, and emphasis, collapses whitespace, and
 * optionally ellipsises. Kept synchronous so it never blocks a hover.
 */
export function markdownSummary(body: string, max?: number): string {
  const plain = body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (max === undefined) return plain;
  const chars: string[] = Array.from(plain);
  if (chars.length <= max) return plain;
  // Prefer the last word boundary so the ellipsis does not split a word.
  const cut = chars.slice(0, max).join("");
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
