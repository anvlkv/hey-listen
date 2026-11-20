/**
 * The command-registry shapes ([`hotkeys.md`](../../../docs/hotkeys.md) → "Command
 * model"). M24.A ships this seam with undo/redo as its first commands; M24.B fills the
 * registry (palette, shortcuts dialog, rebinding).
 */

/** The region a command belongs to. */
export type CommandScope = "global" | "timeline" | "workbench" | "graph" | "annotations" | "dialog";

/**
 * A command id. Ids are **typed**, never arbitrary strings (ADR-28): M24.B extends this
 * union as it registers the transport / navigation / annotation commands.
 */
export type CommandId = "undo" | "redo";

/** One command: the single declaration the dispatcher and (from M24.B) the palette read. */
export interface CommandDef {
  id: CommandId;
  title: string;
  category: "Transport" | "Timeline" | "Navigate" | "Annotations" | "Graph" | "App";
  /** The binding to dispatch, e.g. `Mod+Z`; `null` = intentionally unbound. */
  defaultBinding: string | null;
  scope: CommandScope;
  /** Whether the command is available right now; `false` leaves the key unclaimed. */
  when?: () => boolean;
  run: () => void | Promise<void>;
  /** Fire while a text field has focus (default `false` — see the docs' "Guards"). */
  allowInInput?: boolean;
  /** Fire on held-key repeats (default `false`). */
  allowRepeat?: boolean;
  /** Extra palette search terms. */
  keywords?: string[];
}
