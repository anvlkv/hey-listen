import { expect, it } from "vitest";
import {
  SCOPES_OVERLAP,
  findConflict,
  formatBinding,
  matchBinding,
  normalizeBinding,
  parseBinding,
} from "../state/keybindings/parse";

/**
 * Unit checks for the pure binding helpers (`src/state/keybindings/parse.ts`): the
 * portable spelling, canonical normalization, platform display glyphs, event matching,
 * and conflict detection.
 */

interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** A `KeyboardEvent` stand-in with every modifier released unless overridden. */
function keyEvent(key: string, mods: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
  return {
    key,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  };
}

it("parses a chord into modifier flags and a normalized key", () => {
  expect(parseBinding("Mod+Z")).toEqual({
    mod: true,
    ctrl: false,
    shift: false,
    alt: false,
    key: "Z",
  });
  expect(parseBinding("Shift+Mod+Z")).toEqual({
    mod: true,
    ctrl: false,
    shift: true,
    alt: false,
    key: "Z",
  });
  expect(parseBinding("Ctrl+Tab")).toEqual({
    mod: false,
    ctrl: true,
    shift: false,
    alt: false,
    key: "Tab",
  });
});

it("accepts modifiers case-insensitively and uppercases letters", () => {
  expect(parseBinding("shift+mod+k")).toEqual({
    mod: true,
    ctrl: false,
    shift: true,
    alt: false,
    key: "K",
  });
});

it("normalizes key aliases", () => {
  const key = (binding: string) => parseBinding(binding)?.key;
  expect(key("left")).toBe("ArrowLeft");
  expect(key("Right")).toBe("ArrowRight");
  expect(key("Up")).toBe("ArrowUp");
  expect(key("down")).toBe("ArrowDown");
  expect(key("Esc")).toBe("Escape");
  expect(key("escape")).toBe("Escape");
  expect(key("Del")).toBe("Delete");
  expect(key(" ")).toBe("Space");
  expect(key("space")).toBe("Space");
});

it("accepts punctuation and digits as single-character keys", () => {
  expect(parseBinding("?")?.key).toBe("?");
  expect(parseBinding("Mod+/")?.key).toBe("/");
  expect(parseBinding("5")?.key).toBe("5");
  // A trailing plus is the key, not an empty last segment.
  expect(parseBinding("+")?.key).toBe("+");
  expect(parseBinding("Mod++")?.key).toBe("+");
});

it("rejects empty, modifier-only, unknown and malformed chords", () => {
  for (const bad of [
    "",
    "Mod",
    "Shift",
    "Ctrl+Shift",
    "Mod+Mod+Z",
    "Shift+shift+Z",
    "Alt+alt+Z",
    "Hyper+Z",
    "Meta+Z",
    "Foo",
    "ab",
    "F0",
  ]) {
    expect(parseBinding(bad)).toBeNull();
  }
});

it("re-serializes in canonical modifier order", () => {
  expect(normalizeBinding("shift+z")).toBe("Shift+Z");
  expect(normalizeBinding("left")).toBe("ArrowLeft");
  expect(normalizeBinding("Ctrl+Shift+Tab")).toBe("Ctrl+Shift+Tab");
  expect(normalizeBinding("Shift+Mod+Z")).toBe("Mod+Shift+Z");
  expect(normalizeBinding("shift+mod+k")).toBe("Mod+Shift+K");
  expect(normalizeBinding("z")).toBe("Z");
  expect(normalizeBinding("+")).toBe("+");
  expect(normalizeBinding("")).toBeNull();
  expect(normalizeBinding("Mod+Shift")).toBeNull();
});

it("formats with macOS glyphs and plain tokens elsewhere", () => {
  expect(formatBinding("Mod+Shift+K", "mac")).toBe("⌘⇧K");
  expect(formatBinding("Mod+Shift+K", "other")).toBe("Ctrl+Shift+K");
  expect(formatBinding("Ctrl+Tab", "mac")).toBe("⌃Tab");
  expect(formatBinding("Shift+Mod+Z", "mac")).toBe("⌘⇧Z");
  expect(formatBinding("Mod+1", "other")).toBe("Ctrl+1");
  expect(formatBinding("Space", "mac")).toBe("Space");
  expect(formatBinding("ArrowLeft", "mac")).toBe("←");
  expect(formatBinding("Backspace", "mac")).toBe("⌫");
  expect(formatBinding("Enter", "mac")).toBe("↩");
  expect(formatBinding("Escape", "mac")).toBe("Esc");
  expect(formatBinding("PageUp", "mac")).toBe("PgUp");
  expect(formatBinding("PageDown", "mac")).toBe("PgDn");
});

it("matches plain and shifted named keys", () => {
  expect(matchBinding("Space", keyEvent(" "), "mac")).toBe(true);
  expect(matchBinding("Space", keyEvent(" ", { shiftKey: true }), "mac")).toBe(false);
  expect(matchBinding("Shift+Space", keyEvent(" ", { shiftKey: true }), "mac")).toBe(true);
  expect(matchBinding("ArrowLeft", keyEvent("ArrowLeft"), "other")).toBe(true);
  // The short alias normalizes on both sides.
  expect(matchBinding("ArrowLeft", keyEvent("Left"), "other")).toBe(true);
});

it("matches letters case-insensitively and requires the declared Shift", () => {
  expect(matchBinding("L", keyEvent("l"), "other")).toBe(true);
  expect(matchBinding("L", keyEvent("L", { shiftKey: true }), "other")).toBe(false);
  expect(
    matchBinding("Shift+ArrowRight", keyEvent("ArrowRight", { shiftKey: true }), "other"),
  ).toBe(true);
  expect(matchBinding("Shift+ArrowRight", keyEvent("ArrowRight"), "other")).toBe(false);
});

it("resolves Mod per platform and keeps an explicit Ctrl distinct", () => {
  expect(matchBinding("Mod+K", keyEvent("k", { metaKey: true }), "mac")).toBe(true);
  expect(matchBinding("Mod+K", keyEvent("k", { ctrlKey: true }), "mac")).toBe(false);
  expect(matchBinding("Mod+K", keyEvent("k"), "mac")).toBe(false);
  expect(matchBinding("Mod+K", keyEvent("k", { ctrlKey: true }), "other")).toBe(true);
  expect(matchBinding("Mod+K", keyEvent("k"), "other")).toBe(false);

  expect(matchBinding("Ctrl+Tab", keyEvent("Tab", { ctrlKey: true }), "mac")).toBe(true);
  expect(matchBinding("Ctrl+Tab", keyEvent("Tab", { ctrlKey: true, metaKey: true }), "mac")).toBe(
    false,
  );
  // An extra Mod on a Mod-only chord is still a mismatch.
  expect(matchBinding("Mod+Z", keyEvent("z", { metaKey: true, ctrlKey: true }), "mac")).toBe(false);
  expect(matchBinding("Alt+ArrowRight", keyEvent("ArrowRight", { altKey: true }), "mac")).toBe(
    true,
  );
  expect(matchBinding("Alt+ArrowRight", keyEvent("ArrowRight"), "mac")).toBe(false);
});

it("ignores Shift for punctuation, because the typed character encodes it", () => {
  for (const key of ["?", "=", "-", "[", "]"]) {
    expect(matchBinding(key, keyEvent(key, { shiftKey: true }), "other")).toBe(true);
    expect(matchBinding(key, keyEvent(key), "other")).toBe(true);
  }
  expect(matchBinding("+", keyEvent("+", { shiftKey: true }), "mac")).toBe(true);
  // The typed key must still match exactly.
  expect(matchBinding("[", keyEvent("{", { shiftKey: true }), "other")).toBe(false);
  // Ignoring Shift does not ignore the other modifiers.
  expect(matchBinding("?", keyEvent("?", { shiftKey: true, metaKey: true }), "mac")).toBe(false);
});

it("never matches a malformed binding", () => {
  expect(matchBinding("Mod+Mod+K", keyEvent("k", { metaKey: true }), "mac")).toBe(false);
  expect(matchBinding("", keyEvent("k"), "other")).toBe(false);
});

it("overlaps global with everything and a scope with itself only", () => {
  expect(SCOPES_OVERLAP("global", "graph")).toBe(true);
  expect(SCOPES_OVERLAP("timeline", "global")).toBe(true);
  expect(SCOPES_OVERLAP("timeline", "timeline")).toBe(true);
  expect(SCOPES_OVERLAP("timeline", "workbench")).toBe(false);
});

it("finds a conflict for the same chord in the same scope", () => {
  const conflict = findConflict(
    { id: "transport.playPause", binding: "Space" },
    [{ id: "transport.stop", binding: "Space", scope: "global" }],
    "global",
    "mac",
  );
  expect(conflict).toEqual({ id: "transport.stop" });
});

it("treats a global binding as overlapping a scoped one", () => {
  const conflict = findConflict(
    { id: "timeline.zoomIn", binding: "=" },
    [{ id: "graph.renderSynth", binding: "=", scope: "global" }],
    "timeline",
    "other",
  );
  expect(conflict).toEqual({ id: "graph.renderSynth" });
});

it("does not conflict across disjoint scopes or against itself", () => {
  expect(
    findConflict(
      { id: "graph.renderSynth", binding: "Mod+Enter" },
      [{ id: "annotations.analyzeSelected", binding: "Mod+Enter", scope: "annotations" }],
      "graph",
      "mac",
    ),
  ).toBeNull();
  expect(
    findConflict(
      { id: "undo", binding: "Mod+Z" },
      [{ id: "undo", binding: "Mod+Z", scope: "global" }],
      "global",
      "other",
    ),
  ).toBeNull();
  expect(
    findConflict(
      { id: "undo", binding: "Mod+Z" },
      [{ id: "redo", binding: "Mod+X", scope: "global" }],
      "global",
      "mac",
    ),
  ).toBeNull();
});

it("compares the canonical spelling and rejects an unparsable candidate", () => {
  const conflict = findConflict(
    { id: "undo", binding: "Mod+Z" },
    [{ id: "redo", binding: "mod+z", scope: "global" }],
    "global",
    "mac",
  );
  expect(conflict).toEqual({ id: "redo" });
  // Off macOS Mod and Ctrl are one physical key, so they also conflict…
  expect(
    findConflict(
      { id: "undo", binding: "Mod+Z" },
      [{ id: "redo", binding: "Ctrl+Z", scope: "global" }],
      "global",
      "other",
    ),
  ).toEqual({ id: "redo" });
  // …but on macOS they are distinct chords.
  expect(
    findConflict(
      { id: "undo", binding: "Mod+Z" },
      [{ id: "redo", binding: "Ctrl+Z", scope: "global" }],
      "global",
      "mac",
    ),
  ).toBeNull();
  expect(
    findConflict(
      { id: "undo", binding: "" },
      [{ id: "redo", binding: "Mod+Z", scope: "global" }],
      "global",
      "mac",
    ),
  ).toBeNull();
});
