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
  // An icon is decorative: a name with no glyph must never break the render, so an
  // unknown name renders nothing rather than throwing (`String.fromCodePoint(NaN)`).
  const glyph = ICON_GLYPHS[props.name] as string | undefined;
  const char = glyph ? String.fromCodePoint(Number.parseInt(glyph, 16)) : "";
  return <i class={`fa ${props.class ?? ""}`} data-icon={char} aria-hidden="true" />;
}
