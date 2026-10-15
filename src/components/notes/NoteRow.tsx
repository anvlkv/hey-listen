import { createMemo, createResource, Show, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import type { Note } from "../../bindings/Note";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { VIEW_ICONS } from "../../lib/icons";
import {
  analyzeNote,
  deleteNote,
  editingNoteId,
  focusedNoteId,
  liveValues,
  noteValuesStale,
  selectNote,
  setEditingNoteId,
} from "../../state/notes";
import { noteBody, noteHeading, noteTimeText } from "../../lib/note";
import { renderMarkdown } from "../../lib/markdown";
import { NoteEditor } from "./NoteEditors";

/**
 * One note: the title bar (heading + actions), meta, values, and the body.
 *
 * The heading and the chart action only **select** the note (highlight + open its
 * chart); moving the analysis window onto the note is the explicit **Analyze** action,
 * so browsing the rail never re-frames the analysis (see `state/notes/focus.ts`).
 *
 * While the note is being edited the editor **replaces** the rendered body (the row
 * shows the note once, not twice), and a commit is explicit — see [`NoteEditor`]. The
 * values line stays visible while editing: it is the frozen snapshot being annotated,
 * so hiding it would hide the very thing the note is about.
 * The expand/preview state arrives as accessors: a store edit replaces the note object
 * and its row is recreated, so a plain value read here would not be reactive.
 */
export function NoteRow(props: {
  note: Note;
  expanded: () => boolean;
  onToggleExpand: () => void;
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
          onClick={() => selectNote(props.note.id)}
          title="Select this note"
          data-testid={`note.heading.${props.note.id}`}
        >
          {noteHeading(props.note.body) || "Note"}
        </button>
        <div class="note-titlebar-actions">
          <Tooltip label={props.note.range ? "Analyze this span" : "Analyze this moment"}>
            <Button
              class="note-icon"
              data-testid={`note.analyze.${props.note.id}`}
              aria-label="Analyze this note"
              onClick={() => analyzeNote(props.note.id)}
            >
              <Icon name="arrows-left-right-to-line" />
            </Button>
          </Tooltip>
          <Show when={def()}>
            {(tool) => (
              <Tooltip label={`Open the ${tool().title} chart`}>
                <Button
                  class="note-icon"
                  data-testid={`note.open.${props.note.id}`}
                  aria-label="Open the chart"
                  onClick={() => selectNote(props.note.id)}
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
              onClick={() => setEditingNoteId(editing() ? null : props.note.id)}
            >
              <Icon name="pencil" />
            </Button>
          </Tooltip>
          <Tooltip label="Open the note in its own window">
            <Button
              class="note-icon"
              data-testid={`note.popout.${props.note.id}`}
              aria-label="Open the note in its own window"
              onClick={() => props.onPopout()}
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

      <Show
        when={editing()}
        fallback={
          <NoteBody
            body={props.note.body}
            id={props.note.id}
            expanded={props.expanded}
            onToggle={props.onToggleExpand}
          />
        }
      >
        <NoteEditor note={props.note} onClose={() => setEditingNoteId(null)} />
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
