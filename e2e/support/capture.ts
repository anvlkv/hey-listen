/**
 * Element screenshots for the manual and the marketing page.
 *
 * The embedded driver's "take element screenshot" returns the whole viewport, so a
 * clipped shot is a full-viewport capture cropped with ImageMagick. A failed crop keeps
 * the full viewport (better a wide image than no image), and every shot is capped to a
 * sensible width because the app may be maximized.
 *
 * Shared by `e2e/manual/capture.spec.ts` (documentation) and
 * `e2e/screenshots/capture.spec.ts` (marketing) so the technique lives in one place.
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * Emulate a mouse position over an element so its crosshair (and hover tooltip /
 * readouts) render in the screenshot.
 *
 * uPlot's cursor and the spectrogram's pointer handler both read `clientX` / `clientY`,
 * so a synthetic `pointermove` + `mousemove` at the element's own rect is enough — no
 * trusted pointer required. `fx`/`fy` are fractional offsets into the element's box
 * (default centre).
 */
export async function hoverAt(selector: string, fx = 0.5, fy = 0.5): Promise<void> {
  await browser.execute(
    (sel: string, fx: number, fy: number) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (els.length === 0) throw new Error(`hoverAt: no element for ${sel}`);
      // Position from the first match; uPlot's over canvas shares the plot box.
      const rect = els[0].getBoundingClientRect();
      const clientX = rect.left + rect.width * fx;
      const clientY = rect.top + rect.height * fy;
      const init = { bubbles: true, cancelable: true, clientX, clientY, view: window };
      for (const el of els) {
        el.dispatchEvent(
          new PointerEvent("pointermove", {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
        el.dispatchEvent(new MouseEvent("mousemove", init));
      }
    },
    selector,
    fx,
    fy,
  );
  // Let the reactive redraw paint the crosshair before the next capture.
  await browser.pause(200);
}

/** Cap an image's width (no upscaling) so a maximized window cannot bloat the page. */
export function capWidth(file: string, maxWidth: number): void {
  try {
    execFileSync("magick", [file, "-resize", `${maxWidth}x>`, file]);
  } catch (err) {
    console.warn(`magick resize for "${file}" failed; keeping the full-size PNG:`, err);
  }
}

/**
 * Capture the viewport and crop it to `selector`'s bounding box (CSS px ×
 * `devicePixelRatio`) with ImageMagick, then cap its width. Writes `file`.
 */
export async function captureElement(
  selector: string,
  file: string,
  maxWidth: number,
): Promise<void> {
  const box = (await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`captureElement: no element for ${sel}`);
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      dpr: window.devicePixelRatio || 1,
    };
  }, selector)) as { left: number; top: number; width: number; height: number; dpr: number };

  const full = `${file}.full.png`;
  await browser.saveScreenshot(full);

  const w = Math.round(box.width * box.dpr);
  const h = Math.round(box.height * box.dpr);
  const x = Math.round(box.left * box.dpr);
  const y = Math.round(box.top * box.dpr);
  try {
    execFileSync("magick", [full, "-crop", `${w}x${h}+${x}+${y}`, "+repage", file]);
    capWidth(file, maxWidth);
  } catch (err) {
    console.warn(`magick crop for "${file}" failed; keeping the full viewport shot:`, err);
    await browser.saveScreenshot(file);
  } finally {
    rmSync(full, { force: true });
  }
}
