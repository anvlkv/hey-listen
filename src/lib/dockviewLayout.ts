import type { SerializedDockview } from "dockview";

/**
 * Workbench layout sanitation for **transient** panels (M25).
 *
 * A compare view is never project content: `layoutJson()` runs every captured layout
 * through [`sanitizeLayout`] so a compare tab is stripped from the saved project, the
 * undo history and the dirty signature — saving while it is open writes the project
 * exactly as if it were closed. See `docs/comparison.md` → "Transient by construction".
 *
 * Removing a panel means more than deleting its entry from `panels`: it is also a view
 * of a grid leaf. A leaf left with no views is pruned from the tree, and an
 * `activeView` / `activeGroup` that pointed at what was removed is re-pointed or
 * dropped so dockview never restores a dangling reference.
 */

/** One serialized grid node (dockview's `SerializedGridObject`). */
interface SerializedNode {
  type: "leaf" | "branch";
  data: unknown;
  size?: number;
  visible?: boolean;
}

/** One grid leaf's group state (`GroupPanelViewState`). */
interface GroupView {
  id: string;
  views: string[];
  activeView?: string;
  [key: string]: unknown;
}

/** A floating or popout group entry (legacy `data` or nested `grid`). */
interface SerializedGroup {
  data?: GroupView;
  grid?: { root: SerializedNode; [key: string]: unknown };
  [key: string]: unknown;
}

/** A panel's serialized metadata (`GroupviewPanelState`). */
type PanelState = { id: string; [key: string]: unknown };

/**
 * Strip every panel whose id `drop` accepts, prune what their leaves leave empty, and
 * return `null` when nothing is left (an empty layout clears the Workbench).
 */
export function sanitizeLayout(
  layout: SerializedDockview | null,
  drop: (panelId: string) => boolean,
): SerializedDockview | null {
  if (!layout) return null;
  const panels: Record<string, PanelState> = {};
  for (const [id, state] of Object.entries(layout.panels ?? {})) {
    if (!drop(id)) panels[id] = state as PanelState;
  }
  if (Object.keys(panels).length === 0) return null;

  const root = pruneNode(layout.grid?.root as SerializedNode | undefined, drop);
  if (!root) return null;
  const grid = { ...layout.grid, root } as SerializedDockview["grid"];

  const next: SerializedDockview = { ...layout, grid, panels };
  if (next.activeGroup && !hasGroup(root, next.activeGroup)) {
    delete next.activeGroup;
  }
  next.floatingGroups = pruneGroups(
    layout.floatingGroups as SerializedGroup[] | undefined,
    drop,
  ) as SerializedDockview["floatingGroups"];
  next.popoutGroups = pruneGroups(
    layout.popoutGroups as SerializedGroup[] | undefined,
    drop,
  ) as SerializedDockview["popoutGroups"];
  return next;
}

/** Prune one node: leaves whose views are all dropped disappear; a lone child is lifted. */
function pruneNode(
  node: SerializedNode | undefined,
  drop: (id: string) => boolean,
): SerializedNode | null {
  if (!node) return null;
  if (node.type === "leaf") {
    const leaf = pruneGroup(node.data as GroupView, drop);
    return leaf ? { ...node, data: leaf } : null;
  }
  const children: SerializedNode[] = (node.data as SerializedNode[])
    .map((child) => pruneNode(child, drop))
    .filter((child): child is SerializedNode => child != null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, data: children };
}

/** A leaf's group with the dropped views removed; `null` when none are left. */
function pruneGroup(group: GroupView, drop: (id: string) => boolean): GroupView | null {
  const views = group.views.filter((view) => !drop(view));
  if (views.length === 0) return null;
  const activeView =
    group.activeView && views.includes(group.activeView) ? group.activeView : undefined;
  return { ...group, views, activeView };
}

/** Prune floating/popout groups (each is a lone group or a nested grid). */
function pruneGroups(
  groups: SerializedGroup[] | undefined,
  drop: (id: string) => boolean,
): SerializedGroup[] | undefined {
  if (!groups) return groups;
  const kept: SerializedGroup[] = [];
  for (const group of groups) {
    if (group.grid) {
      const root = pruneNode(group.grid.root, drop);
      if (root) kept.push({ ...group, grid: { ...group.grid, root } });
    } else if (group.data && pruneGroup(group.data, drop)) {
      kept.push(group);
    } else if (!group.data) {
      kept.push(group);
    }
  }
  return kept;
}

/** Whether a group id still exists in the pruned tree. */
function hasGroup(node: SerializedNode, groupId: string): boolean {
  if (node.type === "leaf") return (node.data as GroupView).id === groupId;
  return (node.data as SerializedNode[]).some((child) => hasGroup(child, groupId));
}
