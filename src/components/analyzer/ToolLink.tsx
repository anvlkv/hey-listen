import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { openTool } from "../../state/workbench";

/**
 * A small action that opens (or focuses) the analyzer a track is derived from (M36) —
 * a spectral feature's underlying `spectrum`, say. The tab opens in the same project,
 * so the shared analysis window and the synced cursor are preserved: this is a
 * truthful bridge to the aggregate's source, not a per-frame drill-down.
 */
export default function ToolLink(props: { id: AnalyzerId; label?: string; title: string }) {
  return (
    <button
      type="button"
      class="chart-tool-link"
      title={props.title}
      onClick={() => void openTool(props.id)}
    >
      {props.label ?? analyzerById(props.id).title}
    </button>
  );
}
