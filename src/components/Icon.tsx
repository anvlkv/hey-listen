import { ICON_GLYPHS, type IconName } from "../lib/icons";

/**
 * A Font Awesome glyph. The code point is written to `data-icon` and rendered by the
 * `.fa` rule in `src/icons.css`, so one bundled font covers every icon and
 * `src/lib/icons.ts` stays the single source of truth for the set.
 *
 * The icon is decorative (`aria-hidden`); the surrounding control carries the
 * accessible name (`aria-label`), which keeps the accessible tree clean.
 */
export default function Icon(props: { name: IconName; class?: string }) {
  return (
    <i class={`fa ${props.class ?? ""}`} data-icon={glyphChar(props.name)} aria-hidden="true" />
  );
}

/**
 * The glyph code point for `name`, or `""` for an unknown one: a decorative icon must
 * never break the render, so a missing glyph renders nothing rather than throwing
 * (`String.fromCodePoint(NaN)`).
 */
function glyphChar(name: IconName): string {
  const glyph = ICON_GLYPHS[name] as string | undefined;
  return glyph ? String.fromCodePoint(Number.parseInt(glyph, 16)) : "";
}
