/**
 * Sidebar (fixed region): the analysis tool picker.
 *
 * Analyzer tools arrive in M4/M5 (see `docs/analysis-tools.md`); until then it
 * carries only a short empty-state note.
 */
export default function Sidebar() {
  return (
    <aside class="app-sidebar">
      <div class="sidebar-empty">No analyzers yet (planned for M4).</div>
    </aside>
  );
}
