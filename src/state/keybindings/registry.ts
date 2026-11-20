import { invoke } from "../../lib/ipc";
import { canRedo, canUndo } from "../project/push";
import type { CommandDef } from "./types";

/**
 * The command registry (M24.A's seam; M24.B fills it).
 *
 * Commands call store/action functions rather than components, so the registry stays
 * testable without the shell. Undo and redo go to the **core**, which owns the stacks
 * and broadcasts the restore ([`undo-redo.md`](../../../docs/undo-redo.md)).
 */

/** A history step: enabled only when the core has somewhere to step. */
function historyStep(
  id: "undo" | "redo",
  title: string,
  binding: string,
  enabled: () => boolean,
): CommandDef {
  return {
    id,
    title,
    category: "App",
    defaultBinding: binding,
    scope: "global",
    when: enabled,
    run: () => void invoke(id).catch((err) => console.error(`could not run ${id}`, err)),
    allowInInput: false,
    allowRepeat: false,
  };
}

export const COMMANDS: CommandDef[] = [
  historyStep("undo", "Undo", "Mod+Z", canUndo),
  historyStep("redo", "Redo", "Shift+Mod+Z", canRedo),
];
