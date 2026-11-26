#!/usr/bin/env node
/**
 * Build `landing/public/media/hero.mp4` from the manual screenshots.
 *
 * The film is deliberately a slow tour of the UI, not a claim about what the app
 * will find. It is muted by default on the page; the ambience is a quiet generated
 * pad, so there is something to hear when the visitor focuses the film.
 *
 * Run from anywhere: `node landing/scripts/make-hero-video.mjs`. Needs ffmpeg.
 * The screenshots are the committed manual captures, so the film stays in step
 * with the manual when they are regenerated.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANDING = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(LANDING, "..");
const OUT = path.join(LANDING, "public", "media", "hero.mp4");

const WIDTH = 1600;
const HEIGHT = 900;
const FPS = 30;
const SCENE = 4.5;
const FADE = 0.5;
const AUDIO_SECONDS = SCENE * 6 - FADE * 5;

const SCENES = [
  {
    file: "docs/manual/assets/001-shell.png",
    zoom: "min(1.01+0.00035*on,1.12)",
    x: "iw/2-(iw/zoom/2)",
    y: "ih/2-(ih/zoom/2)",
  },
  {
    file: "docs/manual/assets/004-filter.png",
    zoom: "max(1.12-0.00035*on,1.01)",
    x: "iw/2-(iw/zoom/2)",
    y: "ih/2-(ih/zoom/2)",
  },
  {
    file: "docs/manual/assets/005-spectrum.png",
    zoom: "1.08",
    x: "(iw-iw/zoom)*on/(4.5*30)",
    y: "ih/2-(ih/zoom/2)",
  },
  {
    file: "landing/public/images/analyzers/pitch.png",
    zoom: "max(1.14-0.0004*on,1.01)",
    x: "iw/2-(iw/zoom/2)",
    y: "ih/2-(ih/zoom/2)",
  },
  {
    file: "docs/manual/assets/006-annotations.png",
    zoom: "1.02+0.0004*on",
    x: "(iw-iw/zoom)*(1-on/(4.5*30))",
    y: "ih/2-(ih/zoom/2)",
  },
  {
    file: "docs/manual/assets/007-compare.png",
    zoom: "max(1.12-0.00035*on,1.01)",
    x: "(iw-iw/zoom)/2",
    y: "ih/2-(ih/zoom/2)",
  },
];

/** A quiet A-major pad with slow movement; no external audio assets. */
function writeAmbience(file, seconds) {
  const rate = 48000;
  const frames = Math.floor(rate * seconds);
  const buffer = Buffer.alloc(44 + frames * 4);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 4, 40);

  const notes = [110, 164.81, 220, 329.63];
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / rate;
    const fadeIn = Math.min(1, t / 3);
    const fadeOut = Math.min(1, (seconds - t) / 4);
    const env = Math.max(0, fadeIn * fadeOut);
    const lfo = 0.78 + 0.22 * Math.sin(2 * Math.PI * 0.07 * t);
    const noise = (Math.random() * 2 - 1) * 0.0035;

    let left = 0;
    let right = 0;
    for (let index = 0; index < notes.length; index += 1) {
      const frequency = notes[index];
      const gain = 0.075 / (index + 1);
      left += gain * Math.sin(2 * Math.PI * frequency * t + index * 0.3);
      right += gain * Math.sin(2 * Math.PI * (frequency + 0.22) * t + index * 0.5);
    }

    const sampleL = Math.max(-1, Math.min(1, (left * lfo + noise) * env));
    const sampleR = Math.max(-1, Math.min(1, (right * lfo + noise) * env));
    const offset = 44 + frame * 4;
    buffer.writeInt16LE(Math.round(sampleL * 32767), offset);
    buffer.writeInt16LE(Math.round(sampleR * 32767), offset + 2);
  }

  writeFileSync(file, buffer);
}

const filters = SCENES.map(
  (scene, index) => `[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='${scene.zoom}':x='${scene.x}':y='${scene.y}':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[v${index}]`,
);

const labels = SCENES.map((_, index) => `v${index}`);
const xfades = [];
for (let index = 1; index < SCENES.length; index += 1) {
  const left = index === 1 ? labels[0] : `x${index - 1}`;
  const right = labels[index];
  const output = index === SCENES.length - 1 ? "outv" : `x${index}`;
  const offset = (SCENE - FADE) * index;
  xfades.push(
    `[${left}][${right}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${output}]`,
  );
}

const temp = mkdtempSync(path.join(tmpdir(), "hey-listen-hero-"));
const wav = path.join(temp, "ambience.wav");
writeAmbience(wav, AUDIO_SECONDS);
mkdirSync(path.dirname(OUT), { recursive: true });

const args = ["-y", "-hide_banner", "-loglevel", "warning"];
for (const scene of SCENES) {
  args.push("-loop", "1", "-framerate", String(FPS), "-t", String(SCENE), "-i", path.join(ROOT, scene.file));
}
args.push("-i", wav);
args.push(
  "-filter_complex",
  [...filters, ...xfades].join(";"),
  "-map",
  "[outv]",
  "-map",
  `${SCENES.length}:a`,
  "-t",
  String(AUDIO_SECONDS),
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "24",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
  OUT,
);

try {
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  console.log(`landing: wrote ${path.relative(ROOT, OUT)} (${AUDIO_SECONDS}s)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
