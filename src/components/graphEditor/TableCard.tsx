import { rowCount, rowsOf } from "../../lib/graph/table";
import type { GraphScope } from "../../lib/graph";
import { tableScope } from "../../state/tables";
import { openTable } from "../../state/workbench";
import TableFigure from "./TableFigure";

const WIDTH = 120;
const HEIGHT = 36;

/**
 * A variadic-table node's card body: the figure its rows add up to (a cycle or a piano
 * roll), and a way into the node's table tab, where the rows are edited, imported and
 * exported.
 *
 * The rows themselves never render on the card — a table can be long, and the tab has
 * the room. Params (`freq`, `loop`) stay in the normal inline list above this.
 */
export default function TableCard(props: {
  scope: GraphScope;
  node: string;
  kind: string;
  rows: number[] | undefined;
}) {
  const rows = () => rowsOf(props.kind, props.rows);
  const count = () => rowCount(props.kind, rows());

  return (
    <div class="graph-table">
      <TableFigure
        kind={props.kind}
        rows={rows()}
        width={WIDTH}
        height={HEIGHT}
        testId="graph.table"
      />
      <button
        type="button"
        class="graph-node-open nodrag"
        data-testid="graph.table.open"
        title="Edit the table rows in their own tab"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openTable(tableScope(props.scope, props.node));
        }}
      >
        {count()} row{count() === 1 ? "" : "s"} · Open
      </button>
    </div>
  );
}
