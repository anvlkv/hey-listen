# Landing

The public landing and the published manual, built with Astro and Solid islands.
GitHub Pages serves `landing/dist` under `/hey-listen/`.

## Commands

```sh
npm run dev:landing      # sync screenshots + astro dev
npm run check:landing    # sync + astro check (types and .astro diagnostics)
npm run build:landing    # sync + astro build → landing/dist
npm run preview:landing  # serve the build locally
npm run help             # build the in-app manual → ../public/help
```

`npm run help` (from the repository root) is the in-app **Help → Hey Listen Manual**
window: the same chapters with docs-only chrome, rooted at `/help/` and bundled with the
app. `npm run dev` / `npm run build` refresh it only when the manual or this project
changed (`scripts/build-help.mjs --if-needed`).

## What comes from the repository

| Source | Where it appears |
| --- | --- |
| `docs/manual/*.md` | `/docs/` pages, sidebar and pager |
| `docs/manual/assets/*.png` | copied to `public/manual-assets/` by `scripts/sync-assets.mjs` |
| `video/` (Remotion) | the film embedded from YouTube; `npm run render:hero` is the source render |
| running app captures | `public/images/analyzers/`, `sources/`, `export-popover.png` |
| `docs/development/000_roadmap.md` | `/roadmap/` timeline |
| `ACKNOWLEDGEMENTS.md` | `/acknowledgements/` |
| `package.json` | the download version |

`public/manual-assets/` is generated and git-ignored. `scripts/sync-assets.mjs`
runs before `dev` and `build`, so a fresh checkout needs no extra step.

The analyzer, source and export images under `public/images/` are element crops
from the running app. Regenerate them with `npm run capture:landing` (needs the
release binary and WebDriver, like the manual captures).

## Hero film

The landing embeds the film from YouTube (`lOKQdIMHQlI`) rather than shipping the
file: a poster and a play button are rendered locally, and the player only loads
when someone clicks, so no third-party request is made before then.

The film itself is produced in the `video/` Remotion project — see
`video/README.md` for the edit, the capture manifest and the per-file layout:

```sh
cd video && npm run dev           # preview HeroFilm
cd video && npm run render:hero   # render to landing/public/media/ (git-ignored)
```

The music is Grieg's *Holberg Suite — Praeludium* (CC BY-SA 3.0), credited under the
film.

## Notes

- The deployment base is `/hey-listen`; internal links go through `src/lib/site.ts`.
  The help build uses `/help` and `src/layouts/HelpLayout.astro` instead of the landing
  chrome (`PUBLIC_HELP=1`).
- `scripts/astro.mjs` disables Astro telemetry so builds work in CI and in a sandbox.
- The manual link rewriter falls back to the chapter with the same number when a
  `.md` link names a file that is being renamed.
- The landing uses captured app screenshots only, never exported charts.
