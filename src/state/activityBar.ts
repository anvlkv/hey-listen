import { createSignal } from "solid-js";
import type { AnalyzerSection } from "./analyzer/types";

/**
 * The vertical activity bar (VSCode-style, far left) selects which analyzer section
 * the Sidebar shows. `null` is the "everything" view (every section, grouped) and is
 * also the default, so the Sidebar still lists every tool until a category is picked.
 *
 * The two graph editors (`filter` / `synth`) are activity-bar entries too, but they
 * open a tab directly — there is no list to filter — so they are not tracked here.
 */
export const [activeSection, setActiveSection] = createSignal<AnalyzerSection | null>(null);
