import { cyclePath, rowCount, rowWidth, rowsOf } from "../../lib/graph/wavetable";
import type { GraphScope } from "../../lib/graph";
import { wavetableScope } from "../../state/wavetables";
import { openWavetable } from "../../state/workbench";

const WIDTH = 120;
const HEIGHT = 36;

/**
 * A variadic-table node's card body: the cycle its rows add up to, and a way into the
 * node's Wavetable tab (where the rows are edited, imported and exported).
 *
 * The rows themselves never render on the card — a table can be long, and the tab has
 * the room. Params (`freq`) stay in the normal inline list above this.
 */
export default function WavetableCard(props: {
  scope: GraphScope;
  node: string;
  kind: string;
  rows: number[] | undefined;
}) {
  const columns = () => rowWidth(props.kind);
  const rows = () => rowsOf(props.kind, props.rows);
  const count = () => rowCount(props.kind, rows());

  return (
    <div class="graph-wavetable">
      <svg
        class="graph-wavetable-cycle"
        data-testid="graph.wavetable"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Wavetable cycle"
      >
        <line class="graph-snoop-axis" x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} />
        <path class="graph-wavetable-path" d={cyclePath(rows(), columns(), WIDTH, HEIGHT)} />
      </svg>
      <button
        type="button"
        class="graph-node-open nodrag"
        data-testid="graph.wavetable.open"
        title="Edit the table rows in their own tab"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openWavetable(wavetableScope(props.scope, props.node));
        }}
      >
        {count()} row{count() === 1 ? "" : "s"} · Open
      </button>
    </div>
  );
}
