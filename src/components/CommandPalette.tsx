import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ANALYZER_SECTIONS } from "../state/analyzer/defs";
import { analyzerById, isAnalyzerId } from "../state/analyzer/lookup";
import { paletteOpen, setPaletteOpen } from "../state/keybindings/dialogs";
import { formatBinding, type Platform } from "../state/keybindings/parse";
import { rankPaletteItems, type PaletteItem } from "../state/keybindings/palette";
import { COMMANDS } from "../state/keybindings/registry";
import { getBinding } from "../state/keybindings/store";
import { openTool, openTools, TOOLS, type ToolId } from "../state/workbench";

/**
 * The **Command Palette** ([`hotkeys.md`](../../../docs/hotkeys.md) → "Command
 * palette"): one fuzzy list over the command registry, the Workbench tools, and the
 * tabs already open. Mouse and keyboard share one highlight, Enter runs the highlighted
 * row, and running anything closes the dialog.
 *
 * The dialog self-controls through the `paletteOpen` signal (the registry's
 * `navigate.commandPalette` command flips it), so `App` only mounts it. Ranking lives
 * in [`rankPaletteItems`](../state/keybindings/palette.ts) so it can be unit-tested.
 */

/** `Mod` is ⌘ on macOS and Ctrl elsewhere. */
const PLATFORM: Platform = /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "other";

/** A searchable row plus the action it runs. */
interface PaletteRow {
  /** Unique DOM/ARIA key — a tool id can appear under both Tools and Open tabs. */
  key: string;
  item: PaletteItem;
  run: () => void;
}

/** The display name of an analyzer's section, or `"Graph"` for the two graph editors. */
function toolCategory(id: ToolId): string {
  if (id === "filter" || id === "synth") return "Graph";
  if (!isAnalyzerId(id)) return "";
  const section = analyzerById(id).section;
  return ANALYZER_SECTIONS.find((entry) => entry.id === section)?.title ?? section;
}

/** One row per command, with its current binding as a display chip. */
function commandRows(): PaletteRow[] {
  return COMMANDS.map((command) => {
    const binding = getBinding(command.id);
    return {
      key: `command:${command.id}`,
      item: {
        id: command.id,
        title: command.title,
        category: command.category,
        keywords: command.keywords,
        binding: binding ? formatBinding(binding, PLATFORM) : null,
        kind: "command",
      },
      run: () => void command.run(),
    };
  });
}

/** One row per Workbench tool (the graph editors plus every analyzer). */
function toolRows(): PaletteRow[] {
  return TOOLS.map((tool) => ({
    key: `tool:${tool.id}`,
    item: {
      id: tool.id,
      title: tool.title,
      category: toolCategory(tool.id),
      description: tool.description,
      kind: "tool",
    },
    run: () => void openTool(tool.id),
  }));
}

/** One row per tab already open in the Workbench. */
function tabRows(): PaletteRow[] {
  return openTools().flatMap((id) => {
    const tool = TOOLS.find((entry) => entry.id === id);
    if (!tool) return [];
    return [
      {
        key: `tab:${tool.id}`,
        item: {
          id: tool.id,
          title: tool.title,
          category: toolCategory(tool.id),
          kind: "tool" as const,
        },
        run: () => void openTool(tool.id),
      },
    ];
  });
}

/** Rank one section's rows, preserving the section's own id space. */
function rankRows(query: string, rows: PaletteRow[]): PaletteRow[] {
  const byId = new Map(rows.map((row) => [row.item.id, row]));
  return rankPaletteItems(
    query,
    rows.map((row) => row.item),
  ).map((item) => byId.get(item.id)!);
}

export default function CommandPalette() {
  const [search, setSearch] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);
  let input!: HTMLInputElement;

  // Reset on every open (and focus after Kobalte's focus trap has run).
  createEffect(() => {
    if (!paletteOpen()) return;
    setSearch("");
    setHighlight(0);
    queueMicrotask(() => input?.focus());
  });

  // Sections keep their fixed order (Commands, Tools, Open tabs) and are ranked
  // independently; `start` is the row's index in the flattened highlight order.
  const groups = createMemo(() => {
    const query = search();
    const sections = [
      { title: "Commands", rows: rankRows(query, commandRows()) },
      { title: "Tools", rows: rankRows(query, toolRows()) },
      { title: "Open tabs", rows: rankRows(query, tabRows()) },
    ].filter((section) => section.rows.length > 0);

    let offset = 0;
    return sections.map((section) => {
      const start = offset;
      offset += section.rows.length;
      return { ...section, start };
    });
  });

  const flatRows = createMemo(() => groups().flatMap((group) => group.rows));

  /** The highlighted row, clamped when the filtered list shrinks under it. */
  const activePosition = () => {
    const length = flatRows().length;
    return length === 0 ? -1 : Math.min(highlight(), length - 1);
  };

  /** Run a row after closing the palette (so the action sees no modal). */
  function run(row: PaletteRow | undefined) {
    if (!row) return;
    setPaletteOpen(false);
    row.run();
  }

  function onKeyDown(event: KeyboardEvent) {
    const length = flatRows().length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (length > 0) setHighlight((activePosition() + 1) % length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (length > 0) setHighlight((activePosition() - 1 + length) % length);
    } else if (event.key === "Enter") {
      // A focused row button already runs itself on Enter; only the input needs this.
      if (event.target !== input) return;
      event.preventDefault();
      run(flatRows()[activePosition()]);
    }
  }

  return (
    <Dialog open={paletteOpen()} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="palette-dialog" data-testid="palette.dialog" onKeyDown={onKeyDown}>
          <Dialog.Title class="palette-title">Command Palette</Dialog.Title>
          <Dialog.Description class="palette-hint">
            Search commands, tools, and open tabs. Enter runs the highlighted row.
          </Dialog.Description>

          <input
            ref={(node) => (input = node)}
            class="palette-input"
            data-testid="palette.input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={
              activePosition() >= 0
                ? `palette-option-${flatRows()[activePosition()]?.key ?? ""}`
                : undefined
            }
            aria-autocomplete="list"
            placeholder="Type a command or tool…"
            value={search()}
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              setHighlight(0);
            }}
          />

          <div class="palette-list" id="palette-listbox" role="listbox">
            <For each={groups()}>
              {(group) => (
                <>
                  <div class="palette-section-title" role="presentation">
                    {group.title}
                  </div>
                  <For each={group.rows}>
                    {(row, index) => {
                      const position = () => group.start + index();
                      return (
                        <button
                          type="button"
                          id={`palette-option-${row.key}`}
                          class="palette-item"
                          classList={{ "palette-item-active": position() === activePosition() }}
                          data-testid={`palette.item.${row.item.id}`}
                          role="option"
                          aria-selected={position() === activePosition()}
                          onMouseEnter={() => setHighlight(position())}
                          onClick={() => run(row)}
                        >
                          <span class="palette-item-title">{row.item.title}</span>
                          <Show when={row.item.category}>
                            {(category) => <span class="palette-item-category">{category()}</span>}
                          </Show>
                          <Show when={row.item.binding}>
                            {(binding) => <kbd class="palette-chip">{binding()}</kbd>}
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </>
              )}
            </For>
            <Show when={flatRows().length === 0}>
              <div class="palette-empty">No matching commands or tools.</div>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
