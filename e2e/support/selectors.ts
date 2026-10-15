/**
 * Stable `data-testid` selectors (M8).
 *
 * Tests select by these hooks plus the existing ARIA labels; the app adds a hook
 * only where a test needs one (`docs/testing.md` → Selectors). Keep this file and
 * the components in lock-step — every constant here must exist in the DOM.
 */

export const SEL = {
  // Shell & fixed regions.
  app: '[data-testid="app"]',
  toolbar: '[data-testid="region.toolbar"]',
  sidebar: '[data-testid="region.sidebar"]',
  workbench: '[data-testid="region.workbench"]',
  bottom: '[data-testid="region.bottom"]',
  timeline: '[data-testid="region.timeline"]',
  source: '[data-testid="region.source"]',
  splitterTimeline: '[data-testid="splitter.timeline"]',
  splitterSidebar: '[data-testid="splitter.sidebar"]',
  splitterNotes: '[data-testid="splitter.notes"]',

  // Sidebar.
  sidebarSearch: '[data-testid="sidebar.search"]',
  sidebarEmpty: '[data-testid="sidebar.empty"]',

  // Toolbar.
  projectName: '[data-testid="toolbar.project.name"]',
  projectError: '[data-testid="toolbar.project.error"]',
  toolbarError: '[data-testid="toolbar.error"]',
  toolbarFilter: '[data-testid="toolbar.filter"]',
  toolbarParams: '[data-testid="toolbar.params"]',
  toolbarView: '[data-testid="toolbar.view"]',
  toolbarAbout: '[data-testid="toolbar.about"]',
  themeMessage: '[data-testid="toolbar.theme.message"]',
  aboutDialog: '[data-testid="about.dialog"]',
  outputGain: '[data-testid="toolbar.output.gain"]',
  outputMeter: '[data-testid="toolbar.output.meter"]',
  toolbarNotes: '[data-testid="toolbar.notes"]',

  // Notes panel (M14).
  notesRegion: '[data-testid="region.notes"]',
  notesAdd: '[data-testid="notes.add"]',
  notesCollapse: '[data-testid="notes.collapse"]',
  notesEmpty: '[data-testid="notes.empty"]',
  notesRows: '[data-testid="notes.rows"]',
  notesCount: '[data-testid="notes.count"]',
  timelineNoteHint: '[data-testid="timeline.note.hint"]',

  // MCP popover.
  toolbarMcp: '[data-testid="toolbar.mcp"]',
  mcpEnabled: '[data-testid="mcp.enabled"]',
  mcpPort: '[data-testid="mcp.port"]',
  mcpStatus: '[data-testid="mcp.status"]',
  mcpWarning: '[data-testid="mcp.warning"]',
  mcpError: '[data-testid="mcp.error"]',
  mcpSnippet: '[data-testid="mcp.snippet"]',
  mcpCopy: '[data-testid="mcp.copy"]',

  // Source panel.
  sourceOpenFile: '[data-testid="source.openFile"]',
  sourceRecord: '[data-testid="source.record"]',
  sourceStop: '[data-testid="source.stop"]',
  sourcePause: '[data-testid="source.pause"]',
  sourceError: '[data-testid="source.error"]',
  sourceSummary: '[data-testid="source.summary"]',

  // Timeline.
  timelineCanvas: '[data-testid="timeline.canvas"]',
  timelineReplace: '[data-testid="timeline.replace"]',
  // The channel select keeps its ARIA label (shared with the toolbar popover).
  channelSelect: '[aria-label="Channel to analyse"]',

  // Graph editors.
  graphError: '[data-testid="graph.error"]',
  // Persistent "Output is not connected…" banner (I5).
  graphWarning: '[data-testid="graph.warning"]',
  // Transient connection-rejection banner (C4).
  graphConnectionWarning: '[data-testid="graph.connection.warning"]',
  graphCanvas: '[data-testid="graph.canvas"]',
  graphRender: '[data-testid="graph.render"]',
  graphClear: '[data-testid="graph.clear"]',
  // Graph toolbar hint (node/link counts + applied/bypassed state).
  graphHint: '[data-testid="graph.hint"]',
  // Graph interaction hooks (C5–C8): a node (also carries `data-kind`), a port
  // label, and a palette button.
  graphNode: '[data-testid="graph.node"]',
  graphPort: '[data-testid="graph.port"]',
  graphPaletteBtn: '[data-testid="graph.palette.btn"]',

  // Analyzer shell.
  analyzerError: '[data-testid="analyzer.error"]',
  analyzerBusy: '[data-testid="analyzer.busy"]',
  analyzerBody: '[data-testid="analyzer.body"]',

  // Dockview tab strip.
  tab: ".dv-tab",
} as const;

/** A Sidebar tool entry (`filter`, `synth`, or an analyzer id). */
export const sidebarTool = (id: string) => `[data-testid="sidebar.tool.${id}"]`;

/** A graph node of a given kind (each node carries `data-kind`). */
export const graphNode = (kind: string) => `[data-testid="graph.node"][data-kind="${kind}"]`;

/** A Workbench (dockview) tab for a tool id. */
export const tab = (id: string) => `[data-testid="tab.${id}"]`;

/** An analyzer tool's mounted panel (inside its dockview tab). */
export const analyzerPanel = (id: string) => `[data-testid="analyzer.${id}"]`;

/** An analyzer's "Params" popover trigger. */
export const analyzerParams = (id: string) => `[data-testid="analyzer.params.${id}"]`;

/** An analyzer's "About" popover trigger. */
export const analyzerAbout = (id: string) => `[data-testid="analyzer.about.${id}"]`;

/** The first note row in the Notes panel (ids are uuid-based, so match the prefix). */
export const firstNoteRow = '[data-testid^="note.row."]';
