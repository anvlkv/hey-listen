// Stages the captured hero-film assets into `public/hero/`.
//
// `staticFile()` only serves `public/`, while `story-assets/hero/` is the committed
// source of truth (see story-assets/SCENARIO.md §10). This copies the shot PNGs, the
// manifest and the film audio so the composition can be previewed and rendered.
//
// Usage: npm run stage:hero

import {access, cp, mkdir, readdir, rm, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "story-assets", "hero");
const target = join(root, "public", "hero");
const audio = join(root, "story-assets", "Grieg_Holberg_Suite_1_Praeludium.wav");

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(source))) {
  console.error(`[stage-hero] missing ${source} - run \`npm run capture:hero\` first.`);
  process.exit(1);
}

await rm(target, {recursive: true, force: true});
await mkdir(target, {recursive: true});

await cp(join(source, "manifest.json"), join(target, "manifest.json"));
await cp(join(source, "shots"), join(target, "shots"), {recursive: true});
await cp(audio, join(target, "Grieg_Holberg_Suite_1_Praeludium.wav"));

const shots = await readdir(join(target, "shots"));
const bytes = (
  await Promise.all(
    shots.map(async (file) => (await stat(join(target, "shots", file))).size),
  )
).reduce((total, size) => total + size, 0);

console.log(
  `[stage-hero] staged ${shots.length} shots (${(bytes / 1e6).toFixed(1)} MB) + audio -> ${target}`,
);
