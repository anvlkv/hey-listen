export type FeatureIconName =
  | "source"
  | "analysis"
  | "graph"
  | "terminal"
  | "export"
  | "open"
  | "development"
  | "ai";

/** Stroke-only 24×24 icons, kept as path markup so one component renders them all. */
export const FEATURE_ICONS: Record<FeatureIconName, string> = {
  source: `<path d="M4 9v6M8 5v14M12 2v20M16 5v14M20 9v6" />`,
  analysis: `<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" />`,
  graph: `<path d="M4 5h6M14 5h6M4 12h10M18 12h2M4 19h2M10 19h10" /><circle cx="12" cy="5" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="19" r="2" />`,
  terminal: `<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7.5 9.5l3 3-3 3M13 15.5h3.5" />`,
  export: `<path d="M12 3v12M8 7l4-4 4 4" /><path d="M4 15v4h16v-4" />`,
  open: `<path d="M8 8l-4 4 4 4M16 8l4 4-4 4" /><path d="M13 4l-2 16" />`,
  development: `<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2z" />`,
  ai: `<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" /><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />`,
};
