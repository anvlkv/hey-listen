import { expect, it } from "vitest";
import { markdownPlain, markdownSummary } from "../lib/markdown";

/**
 * Unit checks for the synchronous markdown trims (`src/lib/markdown.ts`), runnable
 * without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * The tooltip hint (`components/MarkdownHint.tsx`) renders the summary, so it must keep
 * the About copy's bold lead-ins as titles, keep paragraphs apart, and trim to its
 * character budget without splitting a word. The plain fallback must stay one line. The
 * sanitizing renderer itself needs a DOM and is not covered here.
 */

const ABOUT =
  "**What it shows.** The signal's *shape* over time.\n\n" +
  "**Why use it.** Spot clipping and `silence` at a glance.\n\n" +
  "**Linked spectrogram.** Turn this on to stack the spectrogram under the waveform.";

it("keeps each bold lead-in as a title with a wide space, one paragraph per block", () => {
  expect(markdownSummary(ABOUT)).toBe(
    "**What it shows.**\u2003The signal's *shape* over time.\n\n" +
      "**Why use it.**\u2003Spot clipping and `silence` at a glance.\n\n" +
      "**Linked spectrogram.**\u2003Turn this on to stack the spectrogram under the waveform.",
  );
});

it("trims to the character budget at a paragraph boundary, marking it dropped", () => {
  expect(markdownSummary(ABOUT, 120)).toBe(
    "**What it shows.**\u2003The signal's *shape* over time.\n\n" +
      "**Why use it.**\u2003Spot clipping and `silence` at a glance. …",
  );
});

it("clamps a long first paragraph at a word boundary", () => {
  const summary = markdownSummary(`**What it shows.** ${"word ".repeat(20)}`, 40);
  expect(summary).toBe("**What it shows.**\u2003word word word word…");
});

it("keeps inline emphasis, and flattens a paragraph it has to cut", () => {
  const body = "**What it shows.** A **tonal** and *noisy* mix.";
  expect(markdownSummary(body)).toBe("**What it shows.**\u2003A **tonal** and *noisy* mix.");
  // The cut paragraph is flattened, so no half emphasis span can reach the renderer.
  expect(markdownSummary(body, 34)).toBe("**What it shows.**\u2003A tonal and…");
});

it("leaves a paragraph without a lead-in as plain text", () => {
  expect(markdownSummary("Just text, no title.")).toBe("Just text, no title.");
  expect(markdownSummary("First.\n\n\n\n  Second.  \n\n")).toBe("First.\n\nSecond.");
  expect(markdownSummary("")).toBe("");
});

it("flattens the same copy to one unformatted line", () => {
  expect(markdownPlain(ABOUT)).toBe(
    "What it shows. The signal's shape over time. Why use it. Spot clipping and silence " +
      "at a glance. Linked spectrogram. Turn this on to stack the spectrogram under the waveform.",
  );
});

it("ellipsises the plain line at a word boundary", () => {
  expect(markdownPlain(ABOUT, 40)).toBe("What it shows. The signal's shape over…");
});
