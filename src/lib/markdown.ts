/**
 * Markdown → sanitized HTML for a note's body (M14).
 *
 * The body is **raw markdown** (stored as-is); rendering is **sanitized** so a pasted
 * note cannot inject markup, scripts, or event handlers. `marked` renders (GFM), then
 * DOMPurify strips anything outside its HTML allow-list. See `docs/notes.md` →
 * Markdown and `docs/dependencies.md`.
 *
 * `marked` and `dompurify` are loaded with a **dynamic import** (and cached): they are
 * only needed when a note's preview is shown, so keeping them out of the initial bundle
 * avoids paying ~130 kB for a rarely-used surface. The app can therefore render a note
 * preview asynchronously (see `components/NotesPanel.tsx`).
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
