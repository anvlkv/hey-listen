# Landing

The public landing and the published manual, built with Astro and Solid islands.
GitHub Pages serves `landing/dist` under `/hey-listen/`.

## Commands

```sh
npm run dev:landing      # sync screenshots + astro dev
npm run check:landing    # sync + astro check (types and .astro diagnostics)
npm run build:landing    # sync + astro build → landing/dist
npm run preview:landing  # serve the build locally
```

## What comes from the repository

| Source | Where it appears |
| --- | --- |
| `docs/manual/*.md` | `/docs/` pages, sidebar and pager |
| `docs/manual/assets/*.png` | copied to `public/manual-assets/` by `scripts/sync-assets.mjs` |
| running app captures | `public/images/analyzers/`, `sources/`, `export-popover.png` |
| `docs/development/000_roadmap.md` | `/roadmap/` timeline |
| `ACKNOWLEDGEMENTS.md` | `/acknowledgements/` |
| `package.json` | the download version |

`public/manual-assets/` is generated and git-ignored. `scripts/sync-assets.mjs`
runs before `dev` and `build`, so a fresh checkout needs no extra step.

The analyzer, source and export images under `public/images/` are element crops
from the running app. Regenerate them with `npm run landing:shots` (needs the
release binary and WebDriver, like the manual captures).

## Hero film

`public/media/hero.mp4` is generated from the manual screenshots:

```sh
node landing/scripts/make-hero-video.mjs
```

It needs `ffmpeg`. The film's audio is a quiet generated pad; the page autoplays it
muted and turns sound on when the film is focused.

## Notes

- The deployment base is `/hey-listen`; internal links go through `src/lib/site.ts`.
- `scripts/astro.mjs` disables Astro telemetry so builds work in CI and in a sandbox.
- The manual link rewriter falls back to the chapter with the same number when a
  `.md` link names a file that is being renamed.
- The landing uses captured app screenshots only, never exported charts.
