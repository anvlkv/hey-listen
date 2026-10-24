import { createSignal, For, Show, type JSX } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import { createNote, defaultNoteTool, notesSorted, openNoteWindow } from "../state/notes";
import { setNotesPanelOpen } from "../state/settings";
import { windowStart } from "../state/timeline";
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
 * **Adding** — `Add` drops a **point** note at the analysis window's start; a **range**
 * is drawn where the audio is, by dragging a span in the note lane of the Timeline or of
 * any time chart (`components/notes/lane.ts`), and its edges are then draggable there.
 *
 * The per-note expand state lives here keyed by note id and is passed to the row as an
 * **accessor** — a store edit replaces the note object and its `<For>` row is
 * recreated, and a plain value read inside the `<For>` mapper would not be reactive.
 */
export default function NotesPanel(props: { style?: JSX.CSSProperties }) {
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  const add = () => createNote({ timeSecs: windowStart(), tool: defaultNoteTool() });

  return (
    <aside class="app-notes" data-testid="region.notes" style={props.style}>
      <div class="notes-header">
        <span class="notes-title">Annotations</span>
        <span class="notes-count" data-testid="notes.count">
          {notesSorted().length}
        </span>
        <div class="notes-header-actions">
          <Tooltip label="Add an annotation at the analysis window">
            <Button
              class="note-icon"
              data-testid="notes.add"
              aria-label="Add annotation"
              onClick={add}
            >
              <Icon name="plus" />
            </Button>
          </Tooltip>
          <Tooltip label="Collapse the annotations panel">
            <Button
              class="note-icon"
              data-testid="notes.collapse"
              aria-label="Collapse the annotations panel"
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
              No annotations yet. Add one with <strong>+</strong> at the analysis window, drag a
              span in the Timeline's annotation lane to mark a range, or right-click a chart and
              choose “Add annotation here”.
            </div>
          }
        >
          <div class="notes-rows" data-testid="notes.rows">
            <For each={notesSorted()}>
              {(note) => (
                <NoteRow
                  note={note}
                  expanded={() => !!expanded()[note.id]}
                  onToggleExpand={() =>
                    setExpanded((map) => ({ ...map, [note.id]: !map[note.id] }))
                  }
                  onPopout={() => void openNoteWindow(note.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </ScrollArea>
    </aside>
  );
}
