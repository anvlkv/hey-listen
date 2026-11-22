import { createMemo, For, Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { invoke } from "../../lib/ipc";
import { nodeKind } from "../../lib/graph";
import {
  cyclePath,
  defaultRows,
  rowCount,
  rowWidth,
  rowsOf,
  tableDef,
} from "../../lib/graph/wavetable";
import { graphFor, hasGraph, setTableRows, warnGraph } from "../../state/graph";
import { parseWavetableScope, type WavetableScope } from "../../state/wavetables";

const FALLBACK_COLUMNS = ["Amp", "Phase"];

/**
 * A table node's editor tab (`wave_synth`): its partials as rows, one `Amp` and one
 * `Phase` each — as many rows as you like, up to the catalog's cap.
 *
 * The rows are the node's own data (`data.table`, row-major), so an edit here is an
 * edit to the graph: the debounced push, the project file and DOT all see it. Import and
 * export read and write one row per line (`amp,phase`) — the same numbers as here.
 */
export default function WavetableTab(props: { scope: WavetableScope }) {
  const ref = () => parseWavetableScope(props.scope);
  const node = createMemo(() => {
    const target = ref();
    if (!target || !hasGraph(target.parent)) return undefined;
    return graphFor(target.parent).nodes.find((current) => current.id === target.node);
  });
  const kind = () => node()?.data.kind ?? "";
  const def = () => tableDef(kind());
  const columns = () => def()?.columns ?? FALLBACK_COLUMNS;
  const width = () => rowWidth(kind());
  const rows = () => rowsOf(kind(), node()?.data.table);
  const count = () => rowCount(kind(), rows());
  const maxRows = () => def()?.maxRows ?? 0;

  /** Apply an edit to the whole row list. */
  function setRows(next: number[]) {
    const target = ref();
    if (target) setTableRows(target.parent, target.node, next);
  }

  function setCell(index: number, value: number) {
    const next = [...rows()];
    next[index] = value;
    setRows(next);
  }

  function addRow() {
    if (maxRows() > 0 && count() >= maxRows()) return;
    setRows([...rows(), ...Array.from({ length: width() }, () => 0)]);
  }

  function removeRow(index: number) {
    const next = [...rows()];
    next.splice(index * width(), width());
    setRows(next);
  }

  async function importRows() {
    try {
      const file = await invoke<string | null>("pick_wavetable_file");
      if (!file) return;
      const values = await invoke<number[]>("wavetable_read_file", { path: file });
      if (values.length === 0) return;
      const limit = maxRows() > 0 ? maxRows() * width() : values.length;
      setRows(values.slice(0, limit));
    } catch (err) {
      warnGraph(String(err));
    }
  }

  async function exportRows() {
    try {
      const path = await invoke<string | null>("pick_save_path", {
        kind: "csv",
        defaultName: "wavetable.csv",
      });
      if (!path) return;
      await invoke("wavetable_write_file", { rows: rows(), path });
    } catch (err) {
      warnGraph(String(err));
    }
  }

  return (
    <div class="wavetable-tab">
      <div class="graph-toolbar">
        <span class="graph-toolbar-title" data-testid="graph.wavetable.title">
          {node() ? `${nodeKind(kind())?.label ?? kind()} table` : "Wavetable"}
        </span>
        <span class="graph-toolbar-hint" data-testid="graph.wavetable.hint">
          {count()} partial{count() === 1 ? "" : "s"} · one {columns().join(" + ")} row each
        </span>
        <Tooltip label="Load rows from a text file (one `amp,phase` row per line)">
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.wavetable.import"
            aria-label="Import rows"
            onClick={() => void importRows()}
          >
            <Icon name="file-import" />
          </Button>
        </Tooltip>
        <Tooltip label="Save these rows as a text file (one `amp,phase` line per row)">
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.wavetable.export"
            aria-label="Export rows"
            onClick={() => void exportRows()}
          >
            <Icon name="file-export" />
          </Button>
        </Tooltip>
        <Tooltip label="Reset the table to the catalog's default rows">
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.wavetable.reset"
            aria-label="Reset table"
            onClick={() => setRows(defaultRows(kind()))}
          >
            <Icon name="arrows-rotate" />
          </Button>
        </Tooltip>
      </div>

      <Show
        when={node()}
        fallback={
          <div class="wavetable-empty" data-testid="graph.wavetable.missing">
            This table's node is gone.
          </div>
        }
      >
        <div class="wavetable-body">
          <div class="wavetable-figure">
            <svg
              class="wavetable-cycle"
              data-testid="graph.wavetable.cycle"
              viewBox="0 0 120 60"
              preserveAspectRatio="none"
              role="img"
              aria-label="Wavetable cycle"
            >
              <line class="graph-snoop-axis" x1="0" y1="30" x2="120" y2="30" />
              <path class="graph-wavetable-path" d={cyclePath(rows(), width(), 120, 60)} />
            </svg>
            <span class="wavetable-caption">one cycle, normalized</span>
          </div>

          <div class="wavetable-rows">
            <div class="wavetable-row wavetable-head">
              <span class="wavetable-index">#</span>
              <For each={columns()}>{(name) => <span class="wavetable-col">{name}</span>}</For>
              <span class="wavetable-col" />
            </div>
            <For each={Array.from({ length: count() })}>
              {(_, index) => (
                <div class="wavetable-row" data-testid="graph.wavetable.row">
                  <span class="wavetable-index">{index() + 1}</span>
                  <For each={Array.from({ length: width() })}>
                    {(_, column) => (
                      <input
                        class="wavetable-cell"
                        type="number"
                        min={def()?.min ?? 0}
                        max={def()?.max ?? 1}
                        step={def()?.step ?? 0.01}
                        aria-label={`Partial ${index() + 1} ${columns()[column()] ?? ""}`}
                        data-testid="graph.wavetable.cell"
                        value={rows()[index() * width() + column()] ?? 0}
                        onChange={(event) =>
                          setCell(index() * width() + column(), Number(event.currentTarget.value))
                        }
                      />
                    )}
                  </For>
                  <Tooltip label={`Remove partial ${index() + 1}`}>
                    <Button
                      class="graph-btn icon-btn wavetable-remove"
                      data-testid="graph.wavetable.remove"
                      aria-label={`Remove partial ${index() + 1}`}
                      onClick={() => removeRow(index())}
                    >
                      <Icon name="trash" />
                    </Button>
                  </Tooltip>
                </div>
              )}
            </For>
            <div class="wavetable-actions">
              <Button
                class="graph-btn"
                data-testid="graph.wavetable.add"
                disabled={maxRows() > 0 && count() >= maxRows()}
                onClick={addRow}
              >
                Add partial
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
