/**
 * The preview surface driver.
 *
 * Loaded only by `preview.html`, after the app bundle. The URL says which surface to
 * show (`?fixture=<id>`, see `src/preview/surfaces.ts`); this module installs the IPC
 * fixture stub, seeds the deterministic source and the surface's state, and opens the
 * matching Workbench tab. `?theme=<id>` is handled before the app loads, by the inline
 * script in `preview.html`, so the theme is right on the first paint.
 *
 * Not part of the app bundle: `vite build` inputs only `index.html`.
 */

import type { AnalyzerId } from "../state/analyzer/types";
import type { Annotation } from "../bindings/Annotation";
import type { SavedComparisonInfo } from "../bindings/SavedComparisonInfo";
import { applySharedParams } from "../state/analysis";
import { replaceAnnotations, setSelectedAnnotationId } from "../state/annotations";
import { isAnalyzerId } from "../state/analyzer/lookup";
import { setAboutOpen } from "../state/menu";
import { setAnnotationsPanelOpen } from "../state/settings";
import { finalizeSource } from "../state/source";
import { comparePanelId } from "../state/compare/id";
import { setSavedReference } from "../state/compare/views";
import { dockApi, openTool } from "../state/workbench";
import type { AnalysisEntry } from "./compare";
import ANALYSIS from "./fixtures/analysis.json";
import { FIXTURE_SAMPLE_RATE, FIXTURE_SECONDS, fixturePcm } from "./signal";
import { installPreviewIpc } from "./stub";
import { previewSurface } from "./surfaces";

declare global {
  interface Window {
    /** Set by `preview.html` before the app bundle is evaluated. */
    __HEYLISTEN_PREVIEW__?: { fixture?: string };
  }
}

const ENTRIES = ANALYSIS as unknown as Record<string, AnalysisEntry>;

/** The shared params a fixture result was produced with. */
const PARAMS = {
  fftSize: 2048,
  hop: 0.25,
  randomizedOverlap: false,
  windowFn: "hann" as const,
  channel: null,
  resampleTo: null,
  freqMinHz: 0,
  freqMaxHz: 0,
};

/** The deterministic source, shared by every data surface. */
function seedSource() {
  finalizeSource({
    name: "lighthouse-fixture.wav",
    detail: "WAV",
    samples: fixturePcm(),
    sampleRate: FIXTURE_SAMPLE_RATE,
    channels: 1,
  });
  applySharedParams(PARAMS);
}

/** Two annotations on the fixture, one with a frozen values snapshot. */
function seedAnnotations() {
  const now = Date.now();
  const annotations: Annotation[] = [
    {
      id: "preview-annotation-1",
      createdMs: now,
      updatedMs: now,
      timeSecs: 0.5,
      range: { startSecs: 0.1, endSecs: 0.9 },
      tool: "modulation",
      title: "Tremolo section",
      body:
        "The opening tone is amplitude-modulated at **5 Hz**, so the AM spectrum has a " +
        "clean peak there.\n\n- compare with the chirp\n- check the FM half",
      values: {
        tool: "modulation",
        label: "AM/FM modulation @ 0.50 s",
        text: "AM depth 33% · peak 5.0 Hz · FM unreliable",
        window: { startSecs: 0, endSecs: FIXTURE_SECONDS },
        params: PARAMS,
        options: {},
        capturedMs: now,
      },
    },
    {
      id: "preview-annotation-2",
      createdMs: now,
      updatedMs: now,
      timeSecs: 1.55,
      range: null,
      tool: null,
      title: null,
      body: "Timeline annotation at the start of the chirp.",
      values: null,
    },
  ];
  replaceAnnotations(annotations);
  setAnnotationsPanelOpen(true);
  setSelectedAnnotationId("preview-annotation-1");
}

/** Wait (briefly) for the Workbench's dockview API to exist. */
async function whenDockReady() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (dockApi()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the Workbench dock did not mount");
}

/** Open the compare tab for `tool` (a dockview panel, not a Sidebar tool). */
async function openCompare(tool: AnalyzerId) {
  const info: SavedComparisonInfo = {
    tool,
    referenceName: "Saved reference",
    source: { sampleRate: FIXTURE_SAMPLE_RATE, channels: 1, duration: FIXTURE_SECONDS },
    window: { start: 0, end: FIXTURE_SECONDS },
    bOffset: 0,
    savedMs: Date.now(),
    fingerprint: "preview-fixture",
  };
  setSavedReference(tool, info);
  await whenDockReady();
  const id = comparePanelId(tool);
  dockApi()?.addPanel({ id, component: id, title: "Comparison" });
}

/** Seed and open the requested surface. */
async function show(fixture: string) {
  if (fixture === "popout") return; // PopoutApp seeds itself from `load_shared_source`.
  if (fixture === "empty") return;
  if (fixture === "about") {
    setAboutOpen(true);
    return;
  }

  seedSource();

  if (fixture === "source") return;
  if (fixture === "annotations") {
    seedAnnotations();
    return;
  }
  if (fixture === "compare" || fixture === "compareSeries") {
    await openCompare(fixture === "compare" ? "levels" : "frameRms");
    return;
  }
  if (fixture === "filter" || fixture === "synth") {
    await whenDockReady();
    await openTool(fixture);
    return;
  }
  if (isAnalyzerId(fixture)) {
    await whenDockReady();
    await openTool(fixture);
    return;
  }

  throw new Error(`unknown preview fixture: ${fixture}`);
}

const fixture = window.__HEYLISTEN_PREVIEW__?.fixture ?? "empty";
installPreviewIpc(ENTRIES, fixture);
document.title = `Hey Listen preview — ${previewSurface(fixture)?.title ?? fixture}`;

void show(fixture).catch((err) => console.error("preview fixture failed", err));
