/**
 * Landing **hero film** capture (M35.A): `npm run capture:hero` only, outside `e2e/specs/`
 * so CI skips it. It replays `video/story-assets/SCENARIO.md` and writes stills + bursts and
 * a normalized-rect manifest into `video/story-assets/hero/`. The Timeline shows the full
 * OGG; the film plays the 31.2 s WAV loop; a second window holds the compare fragment.
 * Read-only: tabs, theme and window change; the project is never saved.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { activityTab, analyzerPanel, SEL } from "../support/selectors.ts";
import {
  click,
  closeAllTabs,
  count,
  dismissPopovers,
  invokeCore,
  mockReturn,
  openFileFixture,
  openTool,
  newEmptyProject,
  showSources,
  textOf,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForShell,
  waitForSourceLoaded,
} from "../support/helpers.ts";
import { hoverAt } from "../support/capture.ts";
import { compareFromTabMenu, compareView, waitForCompareChart } from "../support/compare.ts";
import { GRAPH_FIXTURES } from "../support/fixtures.ts";
import { filterSwitchOn, importGraph, toggleFilter, waitForHint } from "../support/graph.ts";
import { closeWindowsMatching, openProjectWindow } from "../support/windows.ts";
import { expectLogErrors } from "../support/logs.ts";
import { annotate, HERO_ANNOTATIONS } from "../support/heroAnnotations.ts";
import {
  analyzerRects,
  captureHeroBurst,
  captureHeroShot,
  chartAt,
  ensureAnnotationsRail,
  openAudioSource,
  pinLoop,
  pinUiScale,
  setThemeMode,
  storedMode,
  sweepChart,
  writeHeroManifest,
  zoomTimeline,
  type HeroManifestMeta,
  type HeroShot,
} from "../support/hero.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.resolve(HERE, "..", "..", "video", "story-assets", "hero");
const OGG = path.resolve(
  HERE,
  "..",
  "..",
  "video",
  "story-assets",
  "Grieg_Holberg_Suite_1_Praeludium.ogg",
);

/** The seamless loop the analyses cover: source seconds. */
const LOOP = { start: 52.0, end: 83.2 };
/** The OGG's full length; the Timeline view stays on the whole track. */
const SOURCE_SECONDS = 154.858095;
const FULL_VIEW = { start: 0, end: SOURCE_SECONDS };
/** The agent's runner-up fragment, opened in the second window for the compare scene. */
const RUNNER_UP = { start: 14.2, end: 43.6 };

// Closing the compare's reference logs this once; the tab is closed first, but allow it.
expectLogErrors(/compare_peer_setup failed: the reference project '.*' is closed/);

const META: HeroManifestMeta = {
  project: "unsaved project",
  source: path.basename(OGG),
  audio: "Grieg_Holberg_Suite_1_Praeludium.wav",
  loop: { sourceStart: LOOP.start, sourceEnd: LOOP.end, duration: LOOP.end - LOOP.start },
  analysis: ["tempo", "spectralCentroid", "chromagram", "downbeats"],
};

describe("Landing hero film capture", () => {
  const shots: HeroShot[] = [];
  let originalMode = "auto";
  let mcpBefore = { enabled: false, port: 0 };

  after(async () => {
    await closeWindowsMatching(/^project-\d+$/).catch(() => {});
    await browser.tauri.switchWindow("main").catch(() => {});
    await setThemeMode(capitalize(originalMode)).catch(() => {});
  });

  it("captures the 31.2 s loop scenario", async () => {
    await mkdir(path.join(ASSET_DIR, "shots"), { recursive: true });

    await waitForApp();
    await browser.tauri.switchWindow("main");
    await mockReturn("confirm", true);
    await pinUiScale();
    // Give the Workbench room for a chart and the annotations rail; the recorded viewport
    // (not this number) is what the manifest stores.
    await browser.setWindowSize(1440, 928).catch(() => {});
    await browser.pause(300);
    originalMode = await storedMode();
    mcpBefore = await invokeCore<{ enabled: boolean; port: number }>("get_mcp_status");

    await closeAllTabs();
    // No saved project: a new one, its source the original OGG. The agent's pins are added
    // through the UI as the scenario runs (see heroAnnotations.ts).
    await newEmptyProject();
    await openAudioSource(OGG);
    await closeAllTabs();
    await ensureAnnotationsRail();
    await pinLoop(LOOP.start, LOOP.end, FULL_VIEW);

    try {
      await setThemeMode("Dark");

      // --- S1: the project + a Timeline view zoom (full OGG) --------------------
      await openTool("spectrogram");
      await waitForAnalyzer("spectrogram");
      await showSources();
      await chartAt("spectrogram", 0.1);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "01-timeline-zoom",
          theme: "dark",
          note: "Timeline view zooming from the full track into the loop window.",
          seconds: 2.0,
          frames: 14,
          intervalMs: 20,
          act: zoomTimeline(-60),
          extraRects: analyzerRects("spectrogram"),
        }),
      );
      await pinLoop(LOOP.start, LOOP.end);

      // --- S2/S3: the bright event, dark → light dissolve pair -------------------
      await openTool("spectralCentroid");
      await waitForAnalyzer("spectralCentroid");
      await chartAt("spectralCentroid", 0.15);
      // The agent pins the loop and the statement through the chart menu (UI, not MCP).
      await annotate(HERO_ANNOTATIONS.loop);
      await annotate(HERO_ANNOTATIONS.statement);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "02-centroid-dark",
          theme: "dark",
          note: "Centroid crosshair sweeping into the bright peak; the loop and statement pins are in the rail.",
          seconds: 1.5,
          frames: 12,
          intervalMs: 20,
          act: sweepChart("spectralCentroid", 0.15, 0.218),
          extraRects: analyzerRects("spectralCentroid"),
        }),
      );
      await setThemeMode("Light");
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "03-centroid-light",
          theme: "light",
          note: "Light base; the sweep continues past the peak (dissolve pair with 02's last frame).",
          seconds: 1.5,
          frames: 12,
          intervalMs: 20,
          act: sweepChart("spectralCentroid", 0.218, 0.255),
          extraRects: analyzerRects("spectralCentroid"),
        }),
      );
      // After the dissolve pair, so 02's last frame and 03's first frame differ only by theme.
      await annotate(HERO_ANNOTATIONS.bright);

      // --- S4: the dark plunge ---------------------------------------------------
      await chartAt("spectralCentroid", 0.31);
      await annotate(HERO_ANNOTATIONS.plunge);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "04-centroid-dip-light",
          theme: "light",
          note: "Centroid crosshair through the dark plunge, with its 62.85 s pin.",
          seconds: 1.5,
          frames: 12,
          intervalMs: 20,
          act: sweepChart("spectralCentroid", 0.31, 0.365),
          extraRects: analyzerRects("spectralCentroid"),
        }),
      );

      // --- S5: harmony -----------------------------------------------------------
      await openTool("chromagram");
      await waitForAnalyzer("chromagram");
      await chartAt("chromagram", 0.4, 0.35);
      await annotate(HERO_ANNOTATIONS.seam);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "05-chromagram-light",
          theme: "light",
          note: "Crosshair drifting across the chromagram's pitch-class bands (seam pin in the rail).",
          seconds: 1.6,
          frames: 12,
          intervalMs: 20,
          act: sweepChart("chromagram", 0.4, 0.6, 0.35, 0.6),
          extraRects: analyzerRects("chromagram"),
        }),
      );

      // --- S6: perception — roughness + its hover drill-down ---------------------
      await openTool("roughness");
      await waitForAnalyzer("roughness");
      await chartAt("roughness", 0.51);
      await annotate(HERO_ANNOTATIONS.roughness);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "06-roughness-light",
          theme: "light",
          note: "Roughness with the hover drill-down: band profile and band × rate grid.",
          seconds: 2.4,
          frames: 12,
          intervalMs: 20,
          act: sweepChart("roughness", 0.51, 0.62),
          extraRects: {
            "drilldown.card": '[data-testid="drilldown.card"]',
            ...analyzerRects("roughness"),
          },
        }),
      );

      // Same OGG in a *second* project window, at the fragment the agent rejected.
      const second = await openProjectWindow();
      await browser.tauri.switchWindow(second);
      await waitForShell();
      await mockReturn("confirm", true);
      await openFileFixture(OGG);
      await waitForSourceLoaded(120_000);
      await pinLoop(RUNNER_UP.start, RUNNER_UP.end, FULL_VIEW);
      await browser.tauri.switchWindow("main");
      await waitForShell();
      await compareFromTabMenu("spectralCentroid", second);
      await waitForCompareChart("spectralCentroid");
      await hoverAt(`${compareView("spectralCentroid")} canvas`, 0.35, 0.5);
      META.compare = {
        source: path.basename(OGG),
        window: [RUNNER_UP.start, RUNNER_UP.end],
        tool: "spectralCentroid",
      };
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "07-compare-hover",
          theme: "light",
          note: "Compare: the cursor crosses the A/B overlay, updating the readouts.",
          seconds: 1.8,
          frames: 12,
          act: async (index, total) => {
            const t = total <= 1 ? 0 : index / (total - 1);
            await hoverAt(`${compareView("spectralCentroid")} canvas`, 0.25 + 0.35 * t, 0.5, 40);
          },
          extraRects: {
            compare: compareView("spectralCentroid"),
            "compare.canvas": `${compareView("spectralCentroid")} canvas`,
            ...analyzerRects("spectralCentroid"),
          },
        }),
      );
      // The reference has served its purpose: drop the compare tab, then close its window.
      await closeAllTabs();
      await closeWindowsMatching(/^project-\d+$/).catch(() => {});
      await browser.tauri.switchWindow("main");
      await waitForShell();

      // --- S8: the filter graph (bypassed) --------------------------------------
      await openTool("filter");
      await waitFor(
        async () => (await count(SEL.graphCanvas)) > 0,
        "the graph canvas did not render",
      );
      await importGraph(GRAPH_FIXTURES.filter);
      await waitForHint("10 nodes", "the tone-stack filter never imported");
      await click(SEL.graphLayout);
      await browser.pause(700);
      // Composing a graph arms the Filter switch; keep it **bypassed** so the export and
      // the story stay the JSON's unfiltered signal.
      if (await filterSwitchOn()) await toggleFilter();
      await browser.pause(400);
      shots.push(
        await captureHeroShot(ASSET_DIR, {
          id: "08-filter-light",
          theme: "light",
          note: "Filter graph: tone-stack.dot imported, bypassed.",
          seconds: 2.0,
          extraRects: {
            "analyzer.filter": analyzerPanel("filter"),
            "sidebar.graph": SEL.sidebar,
          },
        }),
      );

      // --- S9: export rail, light → dark dissolve pair --------------------------
      await click(activityTab("export"));
      await waitFor(
        async () => (await count(SEL.exportRegion)) > 0,
        "the Export rail did not open",
      );
      shots.push(
        await captureHeroShot(ASSET_DIR, {
          id: "09-export-light",
          theme: "light",
          note: "Export rail: the analysis window as an audio file, light.",
          seconds: 1.9,
        }),
      );
      await setThemeMode("Dark");
      shots.push(
        await captureHeroShot(ASSET_DIR, {
          id: "09-export-dark",
          theme: "dark",
          note: "Identical to 09-export-light, dark base (dissolve pair).",
          seconds: 1.9,
        }),
      );

      // --- S10: MCP switching on -------------------------------------------------
      await invokeCore("set_mcp_config", { config: { enabled: false, port: 0 } });
      await click(SEL.toolbarMcp);
      await waitFor(async () => (await count(".pop-panel")) > 0, "the MCP popover did not open");
      await browser.pause(200);
      shots.push(
        await captureHeroBurst(ASSET_DIR, {
          id: "10-mcp-on",
          theme: "dark",
          note: "MCP switching on: the status line moves to listening.",
          seconds: 0.8,
          frames: 3,
          intervalMs: 200,
          act: async (index) => {
            if (index === 1) await click(".pop-panel .toolbar-switch-control");
            if (index === 2) {
              await waitFor(
                async () => (await textOf(SEL.mcpStatus)).includes("listening on 127.0.0.1:"),
                "the MCP server did not report a listening endpoint",
              );
            }
          },
          extraRects: { mcp: ".pop-panel", "mcp.status": SEL.mcpStatus },
        }),
      );
      await dismissPopovers();
      // Restore before S11 so the toolbar's MCP state matches frame 0.
      await invokeCore("set_mcp_config", { config: mcpBefore }).catch(() => {});

      // --- S11: back to the opening frame (loop closure) -------------------------
      // A new project with the original audio clears the live annotations, the filter and
      // the open tabs, so the return matches frame 0 of 01-timeline-zoom.
      await newEmptyProject();
      await openAudioSource(OGG);
      await closeAllTabs();
      await ensureAnnotationsRail();
      await pinLoop(LOOP.start, LOOP.end, FULL_VIEW);
      await openTool("spectrogram");
      await waitForAnalyzer("spectrogram");
      await showSources();
      await chartAt("spectrogram", 0.1);
      shots.push(
        await captureHeroShot(ASSET_DIR, {
          id: "11-return-dark",
          theme: "dark",
          note: "Re-staged 01-timeline-zoom frame 0: frame parity for the loop.",
          seconds: 1.2,
          extraRects: analyzerRects("spectrogram"),
        }),
      );
    } finally {
      // Restore the app-wide MCP config the capture found (it may have been on already).
      await invokeCore("set_mcp_config", { config: mcpBefore }).catch(() => {});
      await writeHeroManifest(ASSET_DIR, shots, META);
    }
  });
});

/** `auto` → `Auto`, for the Appearance popover's mode buttons. */
function capitalize(mode: string): "Auto" | "Dark" | "Light" {
  if (mode === "dark") return "Dark";
  if (mode === "light") return "Light";
  return "Auto";
}
