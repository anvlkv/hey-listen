import { createMemo, createResource, Show, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import type { Note } from "../../bindings/Note";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { VIEW_ICONS } from "../../lib/icons";
import {
  deleteNote,
  editingNoteId,
  focusNote,
  focusedNoteId,
  liveValues,
  noteValuesStale,
  setEditingNoteId,
} from "../../state/notes";
import { noteBody, noteHeading, noteTimeText } from "../../lib/note";
import { renderMarkdown } from "../../lib/markdown";
import { NoteEditor } from "./NoteEditors";

/** One note: the title bar (heading + actions), meta, values, and the body. */
export function NoteRow(props: {
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

      <NoteBody
        body={props.note.body}
        id={props.note.id}
        expanded={props.expanded}
        onToggle={props.onToggleExpand}
      />

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
  const long = () =>
    rest()
      .split("\n")
      .filter((line) => line.trim().length > 0).length > 3;
  return (
    <Show when={rest().length > 0}>
      <div class="note-body-wrap">
        <div
          class="note-body markdown-body"
          classList={{ "note-body-clamped": !props.expanded() }}
          data-testid={`note.body.${props.id}`}
          // The HTML is `renderMarkdown` output (marked + DOMPurify sanitized).
          // eslint-disable-next-line solid/no-innerhtml -- sanitized, not raw note text
          innerHTML={html() ?? ""}
        />
        <Show when={long()}>
          <button
            type="button"
            class="note-body-toggle"
            aria-label={props.expanded() ? "Collapse the note" : "Expand the note"}
            onClick={() => props.onToggle()}
          >
            <Icon name={props.expanded() ? "chevron-up" : "chevron-down"} />
          </button>
        </Show>
      </div>
    </Show>
  );
}
