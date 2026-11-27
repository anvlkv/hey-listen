/**
 * Element screenshots for the manual and the marketing page.
 *
 * The embedded driver's "take element screenshot" returns the whole viewport, so a
 * clipped shot is a full-viewport capture cropped with ImageMagick. A failed crop keeps
 * the full viewport (better a wide image than no image), and every shot is capped to a
 * sensible width because the app may be maximized.
 *
 * Shared by `e2e/manual/capture.spec.ts` (documentation) and
 * `e2e/screenshots/capture.spec.ts` (the landing) so the technique lives in one place.
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
 * (default centre). `settleMs` is how long to let the reactive repaint before returning;
 * the default is a visible paint, a burst of frames can pass a smaller value. Returns the
 * pointer position it dispatched (CSS px in the page), so a caller can record the cursor.
 */
export async function hoverAt(
  selector: string,
  fx = 0.5,
  fy = 0.5,
  settleMs = 200,
): Promise<{ x: number; y: number }> {
  const point = (await browser.execute(
    (sel: string, fx: number, fy: number) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (els.length === 0) throw new Error(`hoverAt: no element for ${sel}`);
      // uPlot's cursor binds to its `.u-over` div, a **sibling** of the canvases — so an
      // event on the canvas alone never reaches the cursor plugin (and a drill-down card
      // never appears). Prefer the over box when the element lives in a uPlot chart.
      const over =
        (els[0].closest(".uplot")?.querySelector(".u-over") as HTMLElement | null) ?? null;
      const anchor = over ?? els[0];
      const rect = anchor.getBoundingClientRect();
      const clientX = rect.left + rect.width * fx;
      const clientY = rect.top + rect.height * fy;
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        view: window,
      };
      const pointer = { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const targets = over ? [over, ...els] : els;
      for (const el of targets) {
        el.dispatchEvent(new PointerEvent("pointerenter", pointer));
        el.dispatchEvent(new PointerEvent("pointerover", pointer));
        el.dispatchEvent(new MouseEvent("mouseenter", init));
        el.dispatchEvent(new MouseEvent("mouseover", init));
        el.dispatchEvent(new PointerEvent("pointermove", pointer));
        el.dispatchEvent(new MouseEvent("mousemove", init));
      }
      return { x: clientX, y: clientY };
    },
    selector,
    fx,
    fy,
  )) as { x: number; y: number };
  // Let the reactive redraw paint the crosshair before the next capture.
  await browser.pause(settleMs);
  return point;
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
 * Trim a screenshot's uniform padding — a rail's empty lower half — and restore a
 * small margin in the panel's own background colour.
 *
 * The background is read from the image's top-left pixel, so a theme change does not
 * leave a mismatched border. A failed trim keeps the original image.
 */
export function trimUniform(file: string, padding = 14): void {
  try {
    const background = execFileSync("magick", [file, "-format", "%[pixel:p{0,0}]", "info:"], {
      encoding: "utf8",
    }).trim();
    execFileSync("magick", [
      file,
      "-trim",
      "+repage",
      "-bordercolor",
      background,
      "-border",
      String(padding),
      file,
    ]);
  } catch (err) {
    console.warn(`magick trim for "${file}" failed; keeping the full-size PNG:`, err);
  }
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  dpr: number;
}

/** Crop the current viewport to `box` (CSS px × DPR), cap its width, and write `file`. */
async function captureBox(box: Box, file: string, maxWidth: number): Promise<void> {
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

/** Capture the viewport and crop it to `selector`'s bounding box. Writes `file`. */
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
  }, selector)) as Box;

  await captureBox(box, file, maxWidth);
}

/**
 * Crop the union of several elements. Useful when a portaled popup belongs with
 * the panel that opened it (the menu is not inside the panel's DOM box).
 */
export async function captureRegion(
  selectors: string[],
  file: string,
  maxWidth: number,
): Promise<void> {
  const boxes = (await browser.execute((sels: string[]) => {
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
  }, selectors)) as ({ left: number; top: number; width: number; height: number } | null)[];

  const found = boxes.filter(
    (box): box is { left: number; top: number; width: number; height: number } => box !== null,
  );
  if (found.length === 0) throw new Error(`captureRegion: none of ${selectors.join(", ")} exist`);

  const left = Math.min(...found.map((box) => box.left));
  const top = Math.min(...found.map((box) => box.top));
  const right = Math.max(...found.map((box) => box.left + box.width));
  const bottom = Math.max(...found.map((box) => box.top + box.height));
  const dpr = (await browser.execute(() => window.devicePixelRatio || 1)) as number;

  await captureBox({ left, top, width: right - left, height: bottom - top, dpr }, file, maxWidth);
}
