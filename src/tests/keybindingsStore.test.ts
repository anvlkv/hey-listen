import { expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../state/keybindings/defaults";
import {
  BINDINGS_STORAGE_KEY,
  BINDINGS_VERSION,
  mergeBindings,
  parseStored,
  serializeStored,
} from "../state/keybindings/model";
import {
  allResolvedBindings,
  bindingFor,
  getBinding,
  isModified,
  resetAllBindings,
  resetBinding,
  setBinding,
} from "../state/keybindings/store";

/**
 * Unit checks for the binding persistence model and the reactive store
 * (`src/state/keybindings/model.ts`, `store.ts`). The store must import safely without a
 * DOM, so this suite runs it in the node environment with no `localStorage`.
 * See `docs/hotkeys.md` → "Persistence".
 */

it("pins the storage key and schema version", () => {
  expect(BINDINGS_STORAGE_KEY).toBe("hey-listen:keybindings");
  expect(BINDINGS_VERSION).toBe(1);
});

it("merges overrides over the defaults and drops unknown or invalid entries", () => {
  const overrides = {
    undo: null,
    "transport.playPause": "Mod+P",
    "made.up": "Q",
    redo: 7,
  } as unknown as Record<string, string | null>;

  const merged = mergeBindings(DEFAULT_BINDINGS, overrides);

  expect(merged.undo).toBeNull();
  expect(merged["transport.playPause"]).toBe("Mod+P");
  // An invalid override falls back to the default…
  expect(merged.redo).toBe(DEFAULT_BINDINGS.redo);
  // …and an unknown id is dropped.
  expect(Object.keys(merged)).not.toContain("made.up");
  expect(merged["transport.loop"]).toBe(DEFAULT_BINDINGS["transport.loop"]);
});

it("reads an empty override map from missing or malformed storage", () => {
  expect(parseStored(null)).toEqual({});
  expect(parseStored("{")).toEqual({});
  expect(parseStored('"a string"')).toEqual({});
  expect(parseStored("42")).toEqual({});
  expect(parseStored("[]")).toEqual({});
  expect(parseStored("{}")).toEqual({});
  expect(parseStored('{"bindings": null}')).toEqual({});
  expect(parseStored('{"bindings": []}')).toEqual({});
});

it("keeps string and null overrides and drops every other value", () => {
  const raw = JSON.stringify({
    version: 1,
    bindings: {
      undo: "Mod+Shift+U",
      redo: null,
      "transport.loop": 5,
      "transport.stop": false,
      other: { nested: true },
    },
    extra: true,
  });

  expect(parseStored(raw)).toEqual({ undo: "Mod+Shift+U", redo: null });
});

it("serializes a versioned document and round-trips the overrides", () => {
  const overrides = { undo: "Mod+Shift+U", "transport.loop": null };
  const raw = serializeStored(overrides);

  expect(JSON.parse(raw)).toEqual({ version: BINDINGS_VERSION, bindings: overrides });
  expect(parseStored(raw)).toEqual(overrides);
});

it("exposes the defaults before any rebinding", () => {
  expect(getBinding("undo")).toBe("Mod+Z");
  expect(bindingFor("transport.playPause")()).toBe("Space");
  expect(isModified("undo")).toBe(false);
  expect(allResolvedBindings().undo).toBe("Mod+Z");
});

it("normalizes, remembers and resets a single override", () => {
  setBinding("undo", "shift+mod+k");
  expect(getBinding("undo")).toBe("Mod+Shift+K");
  expect(isModified("undo")).toBe(true);

  // An unparsable chord is ignored rather than clearing the binding.
  setBinding("undo", "not a chord");
  expect(getBinding("undo")).toBe("Mod+Shift+K");

  resetBinding("undo");
  expect(getBinding("undo")).toBe("Mod+Z");
  expect(isModified("undo")).toBe(false);
});

it("can unbind a command deliberately", () => {
  setBinding("transport.loop", null);
  expect(getBinding("transport.loop")).toBeNull();
  expect(isModified("transport.loop")).toBe(true);

  resetBinding("transport.loop");
  expect(getBinding("transport.loop")).toBe("L");
  expect(isModified("transport.loop")).toBe(false);
});

it("resetAllBindings restores every default", () => {
  setBinding("transport.loop", null);
  setBinding("undo", "Mod+Shift+U");

  resetAllBindings();

  expect(allResolvedBindings()).toEqual({ ...DEFAULT_BINDINGS });
  expect(isModified("transport.loop")).toBe(false);
  expect(isModified("undo")).toBe(false);
});
