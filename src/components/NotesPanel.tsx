import { createSignal, For, Show, type JSX } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import { createNote, defaultNoteTool, noteById, notesSorted } from "../state/notes";
import { setNotesPanelOpen } from "../state/settings";
import { windowEnd, windowStart } from "../state/timeline";
import { NoteEditorWindow } from "./notes/NoteEditors";
import { NoteRow } from "./notes/NoteRow";

/**
 * The **Notes panel** (M14) — a right rail (a fixed region, not a Workbench tab)
 * listing the project's annotations. There is no separate title field: a note's
 * heading is the **first line** of its markdown body (and is not repeated in the
 * rendered body below it). A row is a **title bar** (heading + the row actions), its
 * tool + time, the **current** values line (with the frozen snapshot struck through
 * when it differs), and the rendered body clamped to a height. Selecting the heading
 * focuses the note. See `docs/notes.md`.
 *
 * The per-note expand/preview state lives here keyed by note id and is passed to the
 * row as **accessors** — a store edit replaces the note object and its `<For>` row is
 * recreated, and a plain value read inside the `<For>` mapper would not be reactive.
 */
export default function NotesPanel(props: { style?: JSX.CSSProperties }) {
  const [asRange, setAsRange] = createSignal(false);
  const [popoutId, setPopoutId] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [previews, setPreviews] = createSignal<Record<string, boolean>>({});

  const add = () => {
    const start = windowStart();
    const end = windowEnd();
    createNote({
      timeSecs: start,
      range: asRange() && end > start ? { startSecs: start, endSecs: end } : null,
      tool: defaultNoteTool(),
    });
  };

  const popoutNote = () => noteById(popoutId());

  return (
    <aside class="app-notes" data-testid="region.notes" style={props.style}>
      <div class="notes-header">
        <span class="notes-title">Notes</span>
        <span class="notes-count" data-testid="notes.count">
          {notesSorted().length}
        </span>
        <div class="notes-header-actions">
          <Tooltip label="Add a note at the analysis window">
            <Button class="note-icon" data-testid="notes.add" aria-label="Add note" onClick={add}>
              <Icon name="plus" />
            </Button>
          </Tooltip>
          <Tooltip label="When on, the new note spans the whole analysis window">
            <Button
              class="note-icon"
              data-testid="notes.range"
              aria-label="Add note as a range"
              aria-pressed={asRange()}
              onClick={() => setAsRange((value) => !value)}
            >
              <Icon name="arrows-left-right-to-line" />
            </Button>
          </Tooltip>
          <Tooltip label="Collapse the notes panel">
            <Button
              class="note-icon"
              data-testid="notes.collapse"
              aria-label="Collapse the notes panel"
              onClick={() => setNotesPanelOpen(false)}
            >
              <Icon name="angle-right" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <ScrollArea class="notes-scroll">
        <Show
          when={notesSorted().length > 0}
          fallback={
            <div class="notes-empty" data-testid="notes.empty">
              No notes yet. Add one at the analysis window, or right-click a chart and choose “Add
              note here”.
            </div>
          }
        >
          <div class="notes-rows" data-testid="notes.rows">
            <For each={notesSorted()}>
              {(note) => (
                <NoteRow
                  note={note}
                  expanded={() => !!expanded()[note.id]}
                  preview={() => !!previews()[note.id]}
                  onToggleExpand={() =>
                    setExpanded((map) => ({ ...map, [note.id]: !map[note.id] }))
                  }
                  onPreview={(on) => setPreviews((map) => ({ ...map, [note.id]: on }))}
                  onPopout={() => setPopoutId(note.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </ScrollArea>

      <Show when={popoutNote()}>
        {(note) => <NoteEditorWindow note={note()} onClose={() => setPopoutId(null)} />}
      </Show>
    </aside>
  );
}
