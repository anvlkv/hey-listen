import { createMemo, untrack } from "solid-js";
import GraphEditor from "../GraphEditor";
import { ClearGraphButton, GraphFileButtons, GraphNotices } from "./GraphTabChrome";
import { graphFor } from "../../state/graph";
import {
  ensureSystem,
  parseSystemScope,
  subsystems,
  type SubsystemScope,
} from "../../state/subsystems";

/**
 * A subsystem tab (M40): the nested graph of one subsystem node (`subgraph`,
 * `feedback`, `oversample`, `resample`), edited exactly like the filter/synth graphs.
 *
 * The store is created from the owning node's `subgraph` on first open and mirrored
 * back into it on every edit, so the project file, DOT export and the core all see one
 * nested `GraphSpec`. Deleting the owning node closes this tab and drops the store.
 */
export default function SubsystemTab(props: { scope: SubsystemScope }) {
  // `GraphEditor` reads the store during render, so make it exist first. The scope
  // never changes for a mounted tab, so this is deliberately untracked.
  ensureSystem(untrack(() => props.scope));
  const handle = () => graphFor(props.scope);
  const nodes = () => handle().nodes.length;
  const links = () => handle().edges.length;
  const title = createMemo(() => {
    const system = subsystems().find((item) => item.scope === props.scope);
    const ref = parseSystemScope(props.scope);
    return system ? `${system.label} subsystem` : `Subsystem ${ref?.node ?? ""}`;
  });

  return (
    <GraphEditor graph={props.scope}>
      <span class="graph-toolbar-title" data-testid="graph.subsystem.title">
        {title()}
      </span>
      <span class="graph-toolbar-hint" data-testid="graph.hint">
        {nodes()} node{nodes() === 1 ? "" : "s"} · {links()} link{links() === 1 ? "" : "s"} · nested
        in {parseSystemScope(props.scope)?.parent ?? "a graph"}
      </span>
      <GraphNotices
        graph={props.scope}
        silent="Output is not connected — the subsystem is silent"
      />
      <GraphFileButtons graph={props.scope} />
      <ClearGraphButton graph={props.scope} />
    </GraphEditor>
  );
}
