# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Hero film

The `HeroFilm` composition is the 31.2 s landing hero: a real Hey Listen session captured
as screenshots and short bursts, cut to the Grieg loop. The edit lives in
`story-assets/SCENARIO.md`; the code reads the capture manifest and maps its normalized
coordinates onto the frame.

```console
npm run stage:hero   # story-assets/hero -> public/hero (images + audio)
npm run dev          # preview HeroFilm
npm run render:hero  # stage + render ../landing/public/media/hero.mp4
```

- `src/hero/manifest.ts` — manifest types, capture geometry, cursor/burst helpers.
- `src/hero/plan.ts` — scene boundaries, camera moves, captions, agent log lines.
- `src/hero/Scene.tsx` — camera clamp, burst crossfade, dissolves, overlays.
- `src/hero/components/` — cursor, agent log, caption, display matrix.

Geometry note: rects and cursor points are normalized to the captured viewport
(`capture.width x capture.height`), not to the PNG. The app surface is drawn at
`1600 x 941`, top-aligned, so the bottom ~41 px sit outside the 900 px frame.

## Commands

**Install Dependencies**

```console
npm i --loglevel=error
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
