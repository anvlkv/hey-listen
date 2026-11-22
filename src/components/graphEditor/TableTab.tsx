import { createMemo, For, Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { invoke } from "../../lib/ipc";
import { nodeKind } from "../../lib/graph";
import { columnAt, defaultRows, rowCount, rowWidth, rowsOf, tableDef } from "../../lib/graph/table";
import { graphFor, hasGraph, setTableRows, warnGraph } from "../../state/graph";
import { parseTableScope, type TableScope } from "../../state/tables";
import TableFigure from "./TableFigure";

/**
 * A table node's editor tab: its rows as cells, one column per value the kind declares
 * (`NodeColumn`: label, range, step) — as many rows as you like, up to the catalog's cap.
 *
 * The rows are the node's own data (`data.table`, row-major), so an edit here is an
 * edit to the graph: the debounced push, the project file and DOT all see it. Import and
 * export read and write one row per line, with a header naming the columns.
 */
export default function TableTab(props: { scope: TableScope }) {
  const ref = () => parseTableScope(props.scope);
  const node = createMemo(() => {
    const target = ref();
    if (!target || !hasGraph(target.parent)) return undefined;
    return graphFor(target.parent).nodes.find((current) => current.id === target.node);
  });
  const kind = () => node()?.data.kind ?? "";
  const def = () => tableDef(kind());
  const columns = () => def()?.columns ?? [];
  const labels = () => columns().map((column) => column.label);
  const width = () => rowWidth(kind());
  const rows = () => rowsOf(kind(), node()?.data.table);
  const count = () => rowCount(kind(), rows());
  const maxRows = () => def()?.maxRows ?? 0;

  /** Apply an edit to the whole row list. */
  function setRows(next: number[]) {
    const target = ref();
    if (target) setTableRows(target.parent, target.node, next);
  }

  /** A value inside the range its column declares. */
  function bounded(index: number, value: number): number {
    const column = columnAt(kind(), index % width());
    if (!column) return value;
    return Math.min(Math.max(value, column.min), column.max);
  }

  function setCell(index: number, value: number) {
    const next = [...rows()];
    next[index] = bounded(index, value);
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
      const file = await invoke<string | null>("pick_table_file");
      if (!file) return;
      const values = await invoke<number[]>("read_table_file", { kind: kind(), path: file });
      if (values.length === 0) return;
      const limit = maxRows() > 0 ? maxRows() * width() : values.length;
      setRows(values.slice(0, limit).map((value, index) => bounded(index, value)));
    } catch (err) {
      warnGraph(String(err));
    }
  }

  async function exportRows() {
    try {
      const path = await invoke<string | null>("pick_save_path", {
        kind: "csv",
        defaultName: def()?.key === "notes" ? "notes.csv" : "wavetable.csv",
      });
      if (!path) return;
      await invoke("write_table_file", { kind: kind(), rows: rows(), path });
    } catch (err) {
      warnGraph(String(err));
    }
  }

  return (
    <div class="table-tab">
      <div class="graph-toolbar">
        <span class="graph-toolbar-title" data-testid="graph.table.title">
          {node() ? `${nodeKind(kind())?.label ?? kind()} ${def()?.label ?? "table"}` : "Table"}
        </span>
        <span class="graph-toolbar-hint" data-testid="graph.table.hint">
          {count()} row{count() === 1 ? "" : "s"} · one {labels().join(" + ")} row each
        </span>
        <Tooltip label={`Load rows from a text file (one ${labels().join(",")} line per row)`}>
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.table.import"
            aria-label="Import rows"
            onClick={() => void importRows()}
          >
            <Icon name="file-import" />
          </Button>
        </Tooltip>
        <Tooltip label={`Save these rows as a text file (one ${labels().join(",")} line per row)`}>
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.table.export"
            aria-label="Export rows"
            onClick={() => void exportRows()}
          >
            <Icon name="file-export" />
          </Button>
        </Tooltip>
        <Tooltip label="Reset the table to the catalog's default rows">
          <Button
            class="graph-btn icon-btn"
            data-testid="graph.table.reset"
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
          <div class="table-empty" data-testid="graph.table.missing">
            This table's node is gone.
          </div>
        }
      >
        <div class="table-body">
          <div class="table-figure">
            <TableFigure
              kind={kind()}
              rows={rows()}
              width={220}
              height={110}
              testId="graph.table.figure"
              label="Table figure"
            />
            <span class="table-caption">
              {def()?.key === "notes" ? "time → pitch ↑" : "one cycle, normalized"}
            </span>
          </div>

          <div class="table-rows">
            <div class="table-row table-head">
              <span class="table-index">#</span>
              <For each={labels()}>{(name) => <span class="table-col">{name}</span>}</For>
              <span class="table-col" />
            </div>
            <For each={Array.from({ length: count() })}>
              {(_, index) => (
                <div class="table-row" data-testid="graph.table.row">
                  <span class="table-index">{index() + 1}</span>
                  <For each={Array.from({ length: width() })}>
                    {(_, column) => (
                      <input
                        class="table-cell"
                        type="number"
                        min={columnAt(kind(), column())?.min ?? 0}
                        max={columnAt(kind(), column())?.max ?? 1}
                        step={columnAt(kind(), column())?.step ?? 0.01}
                        aria-label={`Row ${index() + 1} ${labels()[column()] ?? ""}`}
                        data-testid="graph.table.cell"
                        value={rows()[index() * width() + column()] ?? 0}
                        onChange={(event) =>
                          setCell(index() * width() + column(), Number(event.currentTarget.value))
                        }
                      />
                    )}
                  </For>
                  <Tooltip label={`Remove row ${index() + 1}`}>
                    <Button
                      class="graph-btn icon-btn table-remove"
                      data-testid="graph.table.remove"
                      aria-label={`Remove row ${index() + 1}`}
                      onClick={() => removeRow(index())}
                    >
                      <Icon name="trash" />
                    </Button>
                  </Tooltip>
                </div>
              )}
            </For>
            <div class="table-actions">
              <Button
                class="graph-btn"
                data-testid="graph.table.add"
                disabled={maxRows() > 0 && count() >= maxRows()}
                onClick={addRow}
              >
                Add row
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
