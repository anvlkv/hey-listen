import { For, Match, Switch } from "solid-js";
import { cyclePath, pianoRoll, rowWidth, rowsOf, tableRole } from "../../lib/graph/table";

/**
 * The figure a table's rows add up to: a **waveform cycle** for a wavetable's partials,
 * a **piano roll** for a sequence's notes.
 *
 * Shared by the node card (small) and the table tab (larger), so the "which figure"
 * decision lives in one place — the role comes from the table's DOT key, not a copy.
 */
export default function TableFigure(props: {
  kind: string;
  rows: readonly number[];
  width?: number;
  height?: number;
  testId?: string;
  label?: string;
}) {
  const boxWidth = () => props.width ?? 120;
  const boxHeight = () => props.height ?? 36;
  const columns = () => rowWidth(props.kind);
  const rows = () => rowsOf(props.kind, props.rows);
  const role = () => tableRole(props.kind);

  return (
    <svg
      class="graph-table-figure"
      data-testid={props.testId ?? "graph.table"}
      data-role={role()}
      viewBox={`0 0 ${boxWidth()} ${boxHeight()}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label ?? "Table preview"}
    >
      <Switch>
        <Match when={role() === "notes"}>
          <For each={pianoRoll(rows(), columns(), boxWidth(), boxHeight())}>
            {(bar) => (
              <rect
                class="graph-table-bar"
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill-opacity={bar.velocity}
              />
            )}
          </For>
        </Match>
        <Match when={role() === "wave"}>
          <line
            class="graph-snoop-axis"
            x1="0"
            y1={boxHeight() / 2}
            x2={boxWidth()}
            y2={boxHeight() / 2}
          />
          <path
            class="graph-table-path"
            d={cyclePath(rows(), columns(), boxWidth(), boxHeight())}
          />
        </Match>
      </Switch>
    </svg>
  );
}
