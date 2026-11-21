import type { CommandId, CommandScope } from "./types";

/**
 * The pure binding helpers — parse, re-serialize, format for display, match a
 * `KeyboardEvent`, and detect a conflict ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Binding syntax"). Nothing here touches `window`, `localStorage` or the DOM, so the
 * node unit suite can exercise every rule.
 *
 * A binding is portable spelling: `Mod` is ⌘ on macOS and Ctrl elsewhere, `Alt` is
 * Option on macOS. `Ctrl` is an **explicit** Ctrl even on macOS.
 */

/** The platform `Mod` resolves against. */
export type Platform = "mac" | "other";

/** A parsed chord: modifier flags plus the normalized key token. */
export interface ParsedBinding {
  /** Resolved to Meta on macOS, Ctrl elsewhere. */
  mod: boolean;
  /** An explicit Ctrl even on macOS. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** The normalized key token, e.g. `ArrowLeft`, `K`, `?`, `Space`. */
  key: string;
}

/** Keys written as other names on input (and in `KeyboardEvent.key`). */
const KEY_ALIASES = new Map<string, string>([
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
  ["esc", "Escape"],
  ["del", "Delete"],
  [" ", "Space"],
]);

/** Named keys, canonical spelling. */
const NAMED_KEYS = [
  "Space",
  "Enter",
  "Escape",
  "Home",
  "End",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Backspace",
  "Tab",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
];

const NAMED_KEY_LOOKUP = new Map(NAMED_KEYS.map((key) => [key.toLowerCase(), key]));

/** Keys matched by the character they type, not by an index. */
const PUNCTUATION = new Set(["[", "]", ",", ".", "/", "?", "=", "-", "+"]);

const MODIFIER_TOKENS = new Set(["mod", "ctrl", "shift", "alt"]);

/** Whether `key` is punctuation, whose shifted character is already in the event key. */
function isPunctuation(key: string): boolean {
  return PUNCTUATION.has(key);
}

/** Normalize one key token, or `null` when it is not a key we accept. */
function normalizeKeyToken(raw: string): string | null {
  if (raw.length === 0) return null;
  const alias = KEY_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9]$/.test(raw)) return raw;
  if (isPunctuation(raw)) return raw;
  return NAMED_KEY_LOOKUP.get(raw.toLowerCase()) ?? null;
}

/**
 * Split a binding into modifier/key segments. A trailing `+` is a key, so `"+"` and
 * `"Mod++"` parse rather than collapsing to an empty key.
 */
function splitBinding(binding: string): string[] {
  if (binding === "+") return ["+"];
  if (binding.endsWith("++")) {
    const head = binding.slice(0, -2);
    return head === "" ? ["+"] : [...head.split("+"), "+"];
  }
  return binding.split("+");
}

/**
 * Parse a binding. Returns `null` for an empty key, an unknown modifier, a duplicated
 * modifier, or a modifier-only chord. Key aliases are normalized to canonical spelling.
 */
export function parseBinding(binding: string): ParsedBinding | null {
  const segments = splitBinding(binding);
  const rawKey = segments[segments.length - 1];
  if (!rawKey) return null;
  const key = normalizeKeyToken(rawKey);
  if (key === null) return null;

  let mod = false;
  let ctrl = false;
  let shift = false;
  let alt = false;
  for (const token of segments.slice(0, -1)) {
    const name = token.toLowerCase();
    if (!MODIFIER_TOKENS.has(name)) return null;
    if (name === "mod") {
      if (mod) return null;
      mod = true;
    } else if (name === "ctrl") {
      if (ctrl) return null;
      ctrl = true;
    } else if (name === "shift") {
      if (shift) return null;
      shift = true;
    } else {
      if (alt) return null;
      alt = true;
    }
  }

  return { mod, ctrl, shift, alt, key };
}

/** Re-serialize in canonical order: `Mod`, `Ctrl`, `Shift`, `Alt`, then the key. */
function serializeParsed(parsed: ParsedBinding): string {
  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.shift) parts.push("Shift");
  if (parsed.alt) parts.push("Alt");
  parts.push(parsed.key);
  return parts.join("+");
}

/**
 * Normalize a binding to canonical spelling (`"shift+z"` → `"Shift+Z"`). Returns `null`
 * when the input is not a valid chord; `null` itself means intentionally unbound and is
 * never passed here.
 */
export function normalizeBinding(binding: string): string | null {
  const parsed = parseBinding(binding);
  return parsed ? serializeParsed(parsed) : null;
}

/** macOS display names for keys whose glyph differs from the token. */
const MAC_KEY_LABELS = new Map<string, string>([
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["Backspace", "⌫"],
  ["Enter", "↩"],
  ["Escape", "Esc"],
  ["PageUp", "PgUp"],
  ["PageDown", "PgDn"],
  ["Space", "Space"],
]);

/**
 * Format a binding for display: platform glyphs on macOS (`⌘⇧K`), `Ctrl+Shift+K` on the
 * other platforms. An unparsable value is shown as written.
 */
export function formatBinding(binding: string, platform: Platform): string {
  const parsed = parseBinding(binding);
  if (!parsed) return binding;

  if (platform === "other") {
    const modifiers: string[] = [];
    // `Mod` and `Ctrl` are the same physical key off macOS, so render it once.
    if (parsed.mod || parsed.ctrl) modifiers.push("Ctrl");
    if (parsed.shift) modifiers.push("Shift");
    if (parsed.alt) modifiers.push("Alt");
    return [...modifiers, parsed.key].join("+");
  }

  let glyphs = "";
  if (parsed.mod) glyphs += "⌘";
  if (parsed.ctrl) glyphs += "⌃";
  if (parsed.shift) glyphs += "⇧";
  if (parsed.alt) glyphs += "⌥";
  return glyphs + (MAC_KEY_LABELS.get(parsed.key) ?? parsed.key);
}

/** The `KeyboardEvent` fields matching reads. */
export interface KeyboardEventLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Whether `event` presses `binding`. Punctuation ignores Shift, because the shifted
 * character is already encoded in `event.key` (`?` needs Shift on most layouts but its
 * binding is just `"?"`).
 */
export function matchBinding(
  binding: string,
  event: KeyboardEventLike,
  platform: Platform,
): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) return false;
  const eventKey = normalizeKeyToken(event.key);
  if (eventKey === null) return false;

  const singleCharacter = /^[a-z0-9]$/i.test(parsed.key);
  const keyMatches = singleCharacter
    ? eventKey.toLowerCase() === parsed.key.toLowerCase()
    : eventKey === parsed.key;
  if (!keyMatches) return false;

  if (event.altKey !== parsed.alt) return false;
  if (!isPunctuation(parsed.key) && event.shiftKey !== parsed.shift) return false;

  if (platform === "mac") {
    if (event.metaKey !== parsed.mod) return false;
    if (event.ctrlKey !== parsed.ctrl) return false;
  } else if (event.ctrlKey !== (parsed.mod || parsed.ctrl)) {
    // Off macOS `Mod` IS Ctrl, so the two spellings share one physical key.
    return false;
  }
  return true;
}

/** Whether two scopes could ever claim the same chord. */
export function SCOPES_OVERLAP(a: CommandScope, b: CommandScope): boolean {
  return a === b || a === "global" || b === "global";
}

/**
 * The canonical chord used for conflict comparison. Off macOS `Mod` and `Ctrl` are the
 * same physical key, so they fold together; on macOS they stay distinct.
 */
function conflictKey(binding: string, platform: Platform): string | null {
  const parsed = parseBinding(binding);
  if (!parsed) return null;
  if (platform === "mac") return serializeParsed(parsed);
  return serializeParsed({ ...parsed, mod: parsed.mod || parsed.ctrl, ctrl: false });
}

/**
 * The first `other` command (different id) that would claim `candidate`'s chord in an
 * overlapping scope, or `null`. Chords compare on their canonical spelling, with `Mod`
 * and `Ctrl` folded together on the platforms where they are one key.
 */
export function findConflict(
  candidate: { id: CommandId; binding: string },
  others: { id: CommandId; binding: string; scope: CommandScope }[],
  scope: CommandScope,
  platform: Platform,
): { id: CommandId } | null {
  const normalized = conflictKey(candidate.binding, platform);
  if (normalized === null) return null;
  const conflicting = others.find((other) => {
    if (other.id === candidate.id) return false;
    if (!SCOPES_OVERLAP(scope, other.scope)) return false;
    return conflictKey(other.binding, platform) === normalized;
  });
  return conflicting ? { id: conflicting.id } : null;
}
