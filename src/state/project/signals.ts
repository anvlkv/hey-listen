import { createSignal } from "solid-js";
import { source } from "../source";

/**
 * The project's identity, status, and dirty-marker signals.
 *
 * The display name follows an explicit title (set on save/load) or, until one
 * exists, the current source's name — with `*` marking unsaved edits. Popouts sync
 * the title via `applyProjectTitle` (see `state/uiState.ts`).
 */

export const [projectPath, setProjectPath] = createSignal<string | null>(null);
/** An explicit project title (from a save/load); `null` = follow the source name. */
export const [projectTitle, setProjectTitle] = createSignal<string | null>(null);
/** Whether there are unsaved edits (drives the title `*` and the close/new/open prompts). */
export const [dirty, setDirty] = createSignal(false);
/** The project's clean display name (no unsaved marker); shared with popouts. */
export const projectDisplayName = () => projectTitle() ?? source()?.name ?? "Untitled project";
/** The project's display name: the explicit title, else the current source's name. */
export const projectName = () => projectDisplayName() + (dirty() ? " *" : "");
/** Apply the project title (used when a remote window syncs its project name). */
export function applyProjectTitle(name: string | null) {
  setProjectTitle(name);
}
export const [projectStatus, setProjectStatus] = createSignal<"idle" | "saving" | "loading">(
  "idle",
);
export const [projectError, setProjectError] = createSignal<string | null>(null);
/** Creation time of the loaded project, preserved across re-saves. */
export const [createdMs, setCreatedMs] = createSignal<number | null>(null);
/**
 * The format version a loaded project was migrated from, or `null` when the file was
 * current (`docs/project-file-format.md` → Migrations). An upgraded project stays dirty
 * until a save writes the current version, so the notice and the dirty marker agree.
 */
export const [upgradedFrom, setUpgradedFrom] = createSignal<number | null>(null);
/**
 * Whether the project is a **reference** project: it references its source file instead of
 * embedding the audio (`docs/project-file-format.md` → Reference projects). A re-save
 * keeps it that way, so a small project does not silently grow into a full copy.
 */
export const [referenceProject, setReferenceProject] = createSignal(false);
