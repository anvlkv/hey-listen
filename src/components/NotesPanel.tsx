import { createEffect, createMemo, createResource, createSignal, For, on, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import Button from "./Button";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import type { Note } from "../bindings/Note";
import { analyzerById, isAnalyzerId } from "../state/analyzer";
import { VIEW_ICONS } from "../lib/icons";
import {
  createNote,
  defaultNoteTool,
  deleteNote,
  editingNoteId,
  focusNote,
  focusedNoteId,
  liveValues,
  noteById,
  noteValuesStale,
  notesSorted,
  setEditingNoteId,
  updateNote,
} from "../state/notes";
import { setNotesPanelOpen } from "../state/settings";
import { windowEnd, windowStart } from "../state/timeline";
import { noteBody, noteHeading, noteTimeText } from "../lib/note";
import { renderMarkdown } from "../lib/markdown";

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
            <Button
              class="note-icon"
              data-testid="notes.add"
              aria-label="Add note"
              onClick={add}
            >
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
              No notes yet. Add one at the analysis window, or right-click a chart and choose
              “Add note here”.
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

/** One note: the title bar (heading + actions), meta, values, and the body. */
function NoteRow(props: {
  note: Note;
  expanded: () => boolean;
  preview: () => boolean;
  onToggleExpand: () => void;
  onPreview: (on: boolean) => void;
  onPopout: () => void;
}): JSX.Element {
  const focused = () => focusedNoteId() === props.note.id;
  const editing = () => editingNoteId() === props.note.id;

  const def = () => {
    const tool = props.note.tool;
    return tool && isAnalyzerId(tool) ? analyzerById(tool) : null;
  };
  const toolTitle = () => def()?.title ?? "Timeline";

  // Current values (live) with the frozen snapshot struck through when it differs.
  const live = createMemo(() => liveValues(props.note));
  const stale = createMemo(() => noteValuesStale(props.note));
  const currentText = () => live()?.text ?? props.note.values?.text ?? null;
  const oldText = () => (stale() ? (props.note.values?.text ?? null) : null);

  return (
    <div
      class="note-row"
      classList={{ "note-row-focused": focused() }}
      data-testid={`note.row.${props.note.id}`}
    >
      <div class="note-titlebar">
        <button
          type="button"
          class="note-title"
          onClick={() => focusNote(props.note.id)}
          title="Focus this note"
          data-testid={`note.heading.${props.note.id}`}
        >
          {noteHeading(props.note.body) || "Note"}
        </button>
        <div class="note-titlebar-actions">
          <Show when={def()}>
            {(tool) => (
              <Tooltip label={`Open the ${tool().title} chart`}>
                <Button
                  class="note-icon"
                  data-testid={`note.open.${props.note.id}`}
                  aria-label="Open the chart"
                  onClick={() => focusNote(props.note.id)}
                >
                  <Icon name={VIEW_ICONS[tool().view.kind]} />
                </Button>
              </Tooltip>
            )}
          </Show>
          <Tooltip label="Edit">
            <Button
              class="note-icon"
              data-testid={`note.edit.${props.note.id}`}
              aria-label="Edit the note"
              onClick={() => {
                props.onPreview(false);
                setEditingNoteId(props.note.id);
              }}
            >
              <Icon name="pencil" />
            </Button>
          </Tooltip>
          <Tooltip label="Open the editor in a larger view">
            <Button
              class="note-icon"
              data-testid={`note.popout.${props.note.id}`}
              aria-label="Open the editor in a larger view"
              onClick={() => {
                setEditingNoteId(null);
                props.onPopout();
              }}
            >
              <Icon name="arrow-up-right-from-square" />
            </Button>
          </Tooltip>
          <Tooltip label="Delete">
            <Button
              class="note-icon"
              data-testid={`note.delete.${props.note.id}`}
              aria-label="Delete the note"
              onClick={() => deleteNote(props.note.id)}
            >
              <Icon name="trash" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div class="note-row-meta">
        {toolTitle()} · {noteTimeText(props.note)}
      </div>

      <Show when={currentText()}>
        <div class="note-values">
          <span class="note-values-current" data-testid={`note.values.${props.note.id}`}>
            {currentText()}
          </span>
          <Show when={oldText()}>
            <span class="note-values-old">{oldText()}</span>
          </Show>
        </div>
      </Show>

      <NoteBody body={props.note.body} id={props.note.id} expanded={props.expanded} onToggle={props.onToggleExpand} />

      <Show when={editing()}>
        <NoteEditor
          note={props.note}
          preview={props.preview}
          onPreview={props.onPreview}
          onDone={() => setEditingNoteId(null)}
        />
      </Show>
    </div>
  );
}

/** The rendered body (heading line removed), clamped to a height with a chevron. */
function NoteBody(props: {
  body: string;
  id: string;
  expanded: () => boolean;
  onToggle: () => void;
}): JSX.Element {
  const rest = () => noteBody(props.body);
  const [html] = createResource(rest, (text) => renderMarkdown(text));
  const long = () => rest().split("\n").filter((line) => line.trim().length > 0).length > 3;
  return (
    <Show when={rest().length > 0}>
      <div class="note-body-wrap">
        <div
          class="note-body markdown-body"
          classList={{ "note-body-clamped": !props.expanded() }}
          data-testid={`note.body.${props.id}`}
          innerHTML={html() ?? ""}
        />
        <Show when={long()}>
          <button
            type="button"
            class="note-body-toggle"
            aria-label={props.expanded() ? "Collapse the note" : "Expand the note"}
            onClick={props.onToggle}
          >
            <Icon name={props.expanded() ? "chevron-up" : "chevron-down"} />
          </button>
        </Show>
      </div>
    </Show>
  );
}

/** The inline markdown editor: textarea ↔ rendered preview on focus loss. */
function NoteEditor(props: {
  note: Note;
  preview: () => boolean;
  onPreview: (on: boolean) => void;
  onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.note.body);
  const [html] = createResource(
    () => (props.preview() ? noteBody(draft()) : null),
    (text) => renderMarkdown(text),
  );

  const commit = () =>
    updateNote(props.note.id, { title: null, body: draft(), recomputeValues: true });

  return (
    <div class="note-editor">
      <Show
        when={props.preview()}
        fallback={
          <textarea
            class="note-textarea"
            data-testid={`note.bodyInput.${props.note.id}`}
            placeholder="Write markdown… (the first line is the title)"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => {
              commit();
              props.onPreview(true);
            }}
          />
        }
      >
        <div
          class="note-preview markdown-body"
          data-testid={`note.preview.${props.note.id}`}
          title="Click to keep editing"
          onClick={() => props.onPreview(false)}
          innerHTML={html() || "<p><em>Nothing below the title</em></p>"}
        />
      </Show>
      <div class="note-editor-actions">
        <Button
          class="notes-btn"
          data-testid={`note.done.${props.note.id}`}
          onClick={() => {
            commit();
            props.onDone();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** The popped-out editor: a large, edit-only overlay (M14). */
function NoteEditorWindow(props: { note: Note; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.note.body);

  // Re-seed the draft if the popout is switched to another note.
  createEffect(
    on(
      () => props.note.id,
      () => setDraft(props.note.body),
    ),
  );

  const tool = () => {
    const id = props.note.tool;
    return id && isAnalyzerId(id) ? analyzerById(id).title : "Timeline";
  };

  const commit = () =>
    updateNote(props.note.id, { title: null, body: draft(), recomputeValues: true });

  const close = () => {
    commit();
    props.onClose();
  };

  return (
    <Portal>
      <div class="note-popout-scrim" onClick={close}>
        <div
          class="note-popout"
          data-testid="notes.popout"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="note-popout-header">
            <span class="note-popout-title">
              {tool()} · {noteTimeText(props.note)}
            </span>
            <Button class="note-icon" aria-label="Close the editor" onClick={close}>
              <Icon name="xmark" />
            </Button>
          </div>
          <textarea
            class="note-popout-textarea"
            data-testid="notes.popout.body"
            placeholder="Write markdown… (the first line is the title)"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <div class="note-editor-actions">
            <Button class="notes-btn" data-testid="notes.popout.done" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
