import { createSignal } from "solid-js";
import type { SourceStorage } from "../bindings/SourceStorage";
import { invoke } from "../lib/ipc";
import { source } from "./source";

/**
 * How the project's audio is stored — the single owner of the mode in the UI.
 *
 * The mode is **project content**: it lives in the file's `SOURCE` section
 * (`SourceDescriptor.storage`), so a save writes it and a load restores it. This module
 * holds the current project's mode, the app-level default remembered in `localStorage`
 * (like the font scale in `state/settings.ts`), and the two promise-based dialogs the
 * open/save paths await (the post-pick chooser and the missing-link notice).
 *
 * `SOURCE` decides *where* the samples come from; this is only the choice of *how* a
 * save persists them — `embedded` writes `DATA`, `linked` points at the file, and
 * `liveLink` does both the pointer and a watcher (`sync_source_watch`). Synth and
 * capture sources are always embedded, so their cards never show.
 */

/** One card of the chooser: the mode, its label and the one-line hint under it. */
export interface StorageOption {
  value: SourceStorage;
  label: string;
  hint: string;
}

/**
 * The three modes, in card order — the one table the Source panel and the post-pick
 * dialog both render. Never spell the modes out again: import this.
 */
export const STORAGE_OPTIONS: readonly StorageOption[] = [
  { value: "embedded", label: "Embedded", hint: "The samples are saved inside the project file." },
  {
    value: "linked",
    label: "Linked",
    hint: "The project points at the audio file — keep them together.",
  },
  {
    value: "liveLink",
    label: "Live link",
    hint: "Points at the file and reloads it whenever the file changes.",
  },
];

/** The card label for `mode` (the panel's badge and the dialog's headings). */
export function storageLabel(mode: SourceStorage): string {
  return STORAGE_OPTIONS.find((option) => option.value === mode)?.label ?? "Embedded";
}

/** Parse a wire mode (`embedded` / `linked` / `liveLink`); an unknown value is an error. */
export function parseStorage(value: string): SourceStorage {
  const match = STORAGE_OPTIONS.find((option) => option.value === value);
  if (!match) throw new Error(`unknown storage: ${value}`);
  return match.value;
}

/**
 * The mode a scripted call names: the wire `storage` value (validated), or the legacy
 * `embedSource` flag of an older caller (`true` → embedded, `false` → linked).
 */
export function resolveStorage(
  storage: string | null,
  embedSource?: boolean,
): SourceStorage | undefined {
  if (storage != null) return parseStorage(storage);
  if (embedSource == null) return undefined;
  return embedSource ? "embedded" : "linked";
}

const STORAGE_KEY = "hey-listen:source-storage";

/** The persisted default (an unknown or unreadable value falls back to `embedded`). */
function loadRemembered(): SourceStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return STORAGE_OPTIONS.find((option) => option.value === raw)?.value ?? "embedded";
  } catch {
    return "embedded";
  }
}

/** The mode a newly opened source starts with, remembered across projects. */
export const [rememberedStorage, setRememberedStorage] =
  createSignal<SourceStorage>(loadRemembered());

/** Remember `mode` as the default for the next source the user opens. */
export function rememberStorage(mode: SourceStorage): void {
  setRememberedStorage(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not persisting is fine; the choice still applies for this session.
  }
}

/** How the current project's source is stored (`embedded` until a source sets one). */
export const [sourceStorage, setSourceStorage] = createSignal<SourceStorage>("embedded");

/**
 * Why the panel may not switch from `from` to `to`, or `null` when it may.
 *
 * Both link modes assert that the file on disk is the project's audio, which an in-memory
 * copy cannot vouch for — so leaving `embedded` needs a fresh read (replace the source)
 * rather than flipping a switch. `linked → embedded` freezes the audio and is always
 * allowed, and `linked ↔ liveLink` only adds or removes the watcher.
 */
export function switchBlocked(from: SourceStorage, to: SourceStorage): string | null {
  return from === "embedded" && to !== "embedded" ? "Replace the source to link it." : null;
}

/** Switch the current source's mode; a blocked pair leaves it unchanged. */
export function setStorage(mode: SourceStorage): boolean {
  if (switchBlocked(sourceStorage(), mode) != null) return false;
  setSourceStorage(mode);
  // An explicit choice is what the next source should start from.
  rememberStorage(mode);
  void syncSourceWatch();
  return true;
}

/**
 * The file the project points at: the loaded source's probe path.
 *
 * `currentDescriptor()` is the other place a path could come from, but it returns `null`
 * without a source and otherwise reports exactly this field — and importing the project
 * snapshot here would drag the whole save/push graph into the source store's import
 * cycle. So the probe is the one answer.
 */
function linkedPath(): string | null {
  return source()?.probe?.path ?? null;
}

/**
 * Point the core's live-link watcher at the project's file, or stop it.
 *
 * The watcher lives in the core (it survives a re-read and emits `source-changed`); the
 * frontend only says which file, if any, to watch for the current mode.
 */
export async function syncSourceWatch(): Promise<void> {
  const path = sourceStorage() === "liveLink" ? linkedPath() : null;
  await invoke("sync_source_watch", { path }).catch((err) =>
    console.error("could not update the source watcher", err),
  );
}

/** The post-pick chooser: the file the user just picked, and who awaits the answer. */
export interface StorageChooser {
  path: string;
  resolve: (mode: SourceStorage | null) => void;
}

export const [storageChooser, setStorageChooser] = createSignal<StorageChooser | null>(null);

/** Ask how to store the picked file; `null` = the user cancelled. */
export function askStorage(path: string): Promise<SourceStorage | null> {
  // A second pick supersedes the first (and must not leave its promise pending).
  storageChooser()?.resolve(null);
  return new Promise((resolve) => setStorageChooser({ path, resolve }));
}

/** What the user chose about a source link that no longer resolves. */
export type BrokenLinkChoice = "locate" | "embed" | "cancel";
/** `save`: the audio is in memory, so embedding is an option. `open`: the timeline is empty. */
export type BrokenLinkMode = "open" | "save";

export interface BrokenLinkRequest {
  mode: BrokenLinkMode;
  path: string | null;
  resolve: (choice: BrokenLinkChoice) => void;
}

export const [brokenLink, setBrokenLink] = createSignal<BrokenLinkRequest | null>(null);

/**
 * Ask what to do about a link that no longer resolves. In `"open"` mode nothing is in
 * memory, so the dialog offers locate / cancel and never resolves `"embed"`.
 */
export function askBrokenLink(
  mode: BrokenLinkMode,
  path: string | null = null,
): Promise<BrokenLinkChoice> {
  brokenLink()?.resolve("cancel");
  return new Promise((resolve) => setBrokenLink({ mode, path: path ?? linkedPath(), resolve }));
}
