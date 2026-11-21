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
  activitybar: '[data-testid="region.activitybar"]',
  sidebar: '[data-testid="region.sidebar"]',
  workbench: '[data-testid="region.workbench"]',
  bottom: '[data-testid="region.bottom"]',
  timeline: '[data-testid="region.timeline"]',
  source: '[data-testid="region.source"]',
  // The shell a popout window renders instead of the app (ADR-11).
  popout: '[data-testid="region.popout"]',
  splitterTimeline: '[data-testid="splitter.timeline"]',
  splitterSidebar: '[data-testid="splitter.sidebar"]',
  splitterAnnotations: '[data-testid="splitter.annotations"]',

  // Sidebar.
  sidebarSearch: '[data-testid="sidebar.search"]',
  sidebarEmpty: '[data-testid="sidebar.empty"]',

  // Toolbar.
  projectName: '[data-testid="toolbar.project.name"]',
  projectError: '[data-testid="toolbar.project.error"]',
  // The "upgraded from vN" notice a migrated project shows until it is saved (M37).
  projectUpgraded: '[data-testid="toolbar.project.upgraded"]',
  toolbarError: '[data-testid="toolbar.error"]',
  // The toolbar's preview/output error (no output device, device busy, …).
  toolbarPreviewError: '[data-testid="toolbar.preview.error"]',
  toolbarFilter: '[data-testid="toolbar.filter"]',
  toolbarParams: '[data-testid="toolbar.params"]',
  toolbarView: '[data-testid="toolbar.view"]',
  toolbarAbout: '[data-testid="toolbar.about"]',
  themeMessage: '[data-testid="toolbar.theme.message"]',
  aboutDialog: '[data-testid="about.dialog"]',
  // Command palette + Keyboard Shortcuts dialog (M24.B).
  paletteDialog: '[data-testid="palette.dialog"]',
  paletteInput: '[data-testid="palette.input"]',
  shortcutsDialog: '[data-testid="shortcuts.dialog"]',
  shortcutsSearch: '[data-testid="shortcuts.search"]',
  shortcutsResetAll: '[data-testid="shortcuts.resetAll"]',
  outputGain: '[data-testid="toolbar.output.gain"]',
  outputMeter: '[data-testid="toolbar.output.meter"]',
  toolbarAnnotations: '[data-testid="toolbar.annotations"]',
  // The annotation count inside the Toolbar button, shown while the rail is closed.
  toolbarAnnotationsCount: '[data-testid="toolbar.annotations.count"]',

  // Annotations panel (M14).
  annotationsRegion: '[data-testid="region.annotations"]',
  annotationsAdd: '[data-testid="annotations.add"]',
  // Step the selection through the annotations in time order (no window move).
  annotationsPrev: '[data-testid="annotations.prev"]',
  annotationsNext: '[data-testid="annotations.next"]',
  annotationsCollapse: '[data-testid="annotations.collapse"]',
  annotationsEmpty: '[data-testid="annotations.empty"]',
  annotationsRows: '[data-testid="annotations.rows"]',
  annotationsCount: '[data-testid="annotations.count"]',
  timelineAnnotationHint: '[data-testid="timeline.annotation.hint"]',

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
  timelinePreview: '[data-testid="timeline.preview"]',
  timelineStop: '[data-testid="timeline.stop"]',
  timelineLoop: '[data-testid="timeline.loop"]',
  timelinePosition: '[data-testid="timeline.position"]',
  // Window transport + history (D-03/D-13): return the playhead to the start, follow it.
  timelineStart: '[data-testid="timeline.start"]',
  timelineFollow: '[data-testid="timeline.follow"]',
  // The numeric window form (D-05): its trigger, the history arrows, and the fields.
  timelineWindowEdit: '[data-testid="timeline.windowEdit"]',
  timelineWindowBack: '[data-testid="timeline.windowBack"]',
  timelineWindowForward: '[data-testid="timeline.windowForward"]',
  windowStart: '[data-testid="window.start"]',
  windowEnd: '[data-testid="window.end"]',
  windowDuration: '[data-testid="window.duration"]',
  // The transport's annotation-at-the-playhead action (enabled only while previewing).
  timelineAnnotationAtCursor: '[data-testid="timeline.annotationAtCursor"]',
  timelineScroll: '[data-testid="timeline.scroll"]',
  timelineScrollThumb: '[data-testid="timeline.scroll.thumb"]',
  // The canvas's polite live region: what a keyboard move (or a settle) announces (D-14).
  timelineAnnounce: '[data-testid="timeline.announce"]',
  // The channel rail (M23): one radio per channel plus the downmix toggle.
  channelMix: '[data-testid="timeline.channel.mix"]',
  channelRight: '[data-testid="timeline.channel.1"]',
  // The canvas's right-click menu (D-11) and its snap toggle (D-12).
  timelineMenu: '[data-testid="timeline.menu"]',
  timelineMenuStart: '[data-testid="timeline.menu.start"]',
  timelineMenuEnd: '[data-testid="timeline.menu.end"]',
  timelineMenuAnnotation: '[data-testid="timeline.menu.annotation"]',
  timelineMenuWhole: '[data-testid="timeline.menu.whole"]',
  timelineMenuSnap: '[data-testid="timeline.menu.snap"]',

  // Graph editors.
  graphError: '[data-testid="graph.error"]',
  // Persistent "Output is not connected…" banner (I5).
  graphWarning: '[data-testid="graph.warning"]',
  // Transient connection-rejection banner (C4).
  graphConnectionWarning: '[data-testid="graph.connection.warning"]',
  graphCanvas: '[data-testid="graph.canvas"]',
  graphRender: '[data-testid="graph.render"]',
  graphClear: '[data-testid="graph.clear"]',
  // Autolayout (both editors): dagre, left to right.
  graphLayout: '[data-testid="graph.layout"]',
  // Graph toolbar hint (node/link counts + applied/bypassed state).
  graphHint: '[data-testid="graph.hint"]',
  // Graph interaction hooks (C5–C8): a node (also carries `data-kind`), a port
  // label, and a palette button.
  graphNode: '[data-testid="graph.node"]',
  graphPort: '[data-testid="graph.port"]',
  graphPaletteBtn: '[data-testid="graph.palette.btn"]',
  // The palette drag affordance (M22): the ghost under the pointer, the landing outline,
  // and the splice badge over a connector.
  graphDragGhost: '[data-testid="graph.drag.ghost"]',
  graphDropPreview: '[data-testid="graph.drop.preview"]',
  graphDropSplice: '[data-testid="graph.drop.splice"]',
  graphDropHint: '[data-testid="graph.drop.hint"]',

  // Synth Live (M22).
  synthLength: '[data-testid="synth.length"]',
  synthLive: '[data-testid="synth.live"]',
  synthLiveCap: '[data-testid="synth.live.cap"]',

  // Analyzer shell.
  analyzerError: '[data-testid="analyzer.error"]',
  analyzerBusy: '[data-testid="analyzer.busy"]',
  analyzerBody: '[data-testid="analyzer.body"]',

  // Dockview tab strip.
  tab: ".dv-tab",

  // Log preview window (ADR-33).
  logWindow: '[data-testid="log.window"]',
  logList: '[data-testid="log.list"]',
  logFilter: '[data-testid="log.filter"]',
  logFollow: '[data-testid="log.follow"]',
  logReveal: '[data-testid="log.reveal"]',
} as const;

/** A Sidebar tool entry (`filter`, `synth`, or an analyzer id). */
export const sidebarTool = (id: string) => `[data-testid="sidebar.tool.${id}"]`;

/** An activity-bar tab (an analyzer section, or `graph`). */
export const activityTab = (id: string) => `[data-testid="activity.tab.${id}"]`;

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

/** The first annotation row in the Annotations panel (ids are uuid-based, so match the prefix). */
export const firstAnnotationRow = '[data-testid^="annotation.row."]';

/**
 * A command-palette row (a command id or tool id).
 *
 * @public The palette specs address rows through this helper.
 */
export const paletteItem = (id: string) => `[data-testid="palette.item.${id}"]`;

/**
 * A Keyboard Shortcuts row.
 *
 * @public The shortcuts specs address rows through this helper.
 */
export const shortcutsRow = (id: string) => `[data-testid="shortcuts.row.${id}"]`;

/**
 * A Keyboard Shortcuts row's Edit/record button.
 *
 * @public The shortcuts specs arm recording through this helper.
 */
export const shortcutsRecord = (id: string) => `[data-testid="shortcuts.record.${id}"]`;
