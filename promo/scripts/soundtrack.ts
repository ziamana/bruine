/**
 * The film's soundtrack, synthesized: no sample, no recording. Every sound is computed from the
 * same cue timeline as the picture (src/timeline.ts), so a key click lands on the frame its
 * character appears on and the rain is as loud as the rain on screen is heavy.
 *
 *   node scripts/soundtrack.ts            writes public/soundtrack-en.wav and -fr.wav
 *   node scripts/soundtrack.ts en         one language
 *
 * Deterministic: the same timeline always gives the same file, sample for sample.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { AUDIO, COPY, totalFrames, VIDEO, type Lang } from "../src/config.ts";
import {
  CAPTION_AT,
  DEMO,
  EFFORT,
  INTRO,
  LIGHTNING,
  LOGO,
  MODELS,
  OUTRO,
  PROMISES,
  rainLevelAt,
  reachedAt,
  SCENES,
  transitions,
  keyFrames,
} from "../src/timeline.ts";

const SR = AUDIO.sampleRate;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Basics: a seeded random source, the buses, and the way a sound is laid on them.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Mix {
  readonly length: number;
  readonly dryL: Float32Array;
  readonly dryR: Float32Array;
  readonly sendL: Float32Array;
  readonly sendR: Float32Array;
  constructor(seconds: number) {
    this.length = Math.ceil(seconds * SR);
    this.dryL = new Float32Array(this.length);
    this.dryR = new Float32Array(this.length);
    this.sendL = new Float32Array(this.length);
    this.sendR = new Float32Array(this.length);
  }

  /**
   * Lay a mono sound at `t0` seconds: `gen(t)` gives the sample at `t` seconds into the sound.
   * `pan` is -1 (left) to 1 (right), `send` is how much goes to the reverb.
   */
  voice(t0: number, seconds: number, gain: number, pan: number, send: number, gen: (t: number, n: number) => number): void {
    const start = Math.round(t0 * SR);
    const count = Math.round(seconds * SR);
    const angle = ((pan + 1) / 4) * Math.PI;
    const gl = Math.cos(angle) * gain;
    const gr = Math.sin(angle) * gain;
    for (let n = 0; n < count; n += 1) {
      const i = start + n;
      if (i < 0) continue;
      if (i >= this.length) break;
      const x = gen(n / SR, n);
      this.dryL[i]! += x * gl;
      this.dryR[i]! += x * gr;
      this.sendL[i]! += x * gl * send;
      this.sendR[i]! += x * gr * send;
    }
  }
}

/** RBJ biquad, enough for the band-passes and low-passes here. */
class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  readonly type: "lp" | "hp" | "bp";
  constructor(type: "lp" | "hp" | "bp", freq: number, q = 0.707) {
    this.type = type;
    this.set(freq, q);
  }
  set(freq: number, q = 0.707): void {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (this.type === "lp") {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (this.type === "hp") {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const env = (t: number, attack: number, decay: number): number => (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
const note = (name: string): number => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name)!;
  const semis: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const n = semis[m[1]!]! + (m[2] === "#" ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, n / 12);
};
const frameTime = (frame: number): number => frame / VIDEO.fps;

// ---------------------------------------------------------------------------------------------
// The instruments.

/** A water drop: a short sine whose pitch leaps up as the cavity closes. */
function plip(mix: Mix, t0: number, f0: number, gain: number, pan = 0, send = 0.45): void {
  let phase = 0;
  mix.voice(t0, 0.22, gain, pan, send, (t) => {
    const f = f0 * (1 + 1.6 * (1 - Math.exp(-t / 0.018)));
    phase += (TAU * f) / SR;
    return Math.sin(phase) * env(t, 0.0008, 0.05);
  });
}

/** A small clean blip, for a tool that finished or a line that landed. */
function blip(mix: Mix, t0: number, f: number, gain: number, pan = 0, send = 0.3): void {
  mix.voice(t0, 0.35, gain * 1.5, pan, send, (t) => (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t)) * env(t, 0.001, 0.06));
}

/** A bell: a few inharmonic partials, the high ones dying first. */
function bell(mix: Mix, t0: number, f: number, gain: number, pan = 0, send = 0.6, length = 3): void {
  const partials = [
    [1, 1, 1],
    [2, 0.35, 0.6],
    [2.76, 0.45, 0.45],
    [4.07, 0.2, 0.3],
    [5.4, 0.12, 0.2],
  ] as const;
  mix.voice(t0, length, gain, pan, send, (t) => {
    let x = 0;
    for (const [ratio, amp, life] of partials) x += amp * Math.sin(TAU * f * ratio * t) * Math.exp(-t / (length * 0.35 * life));
    return x * (1 - Math.exp(-t / 0.002)) * 0.5;
  });
}

/** A soft plucked note with a warm body. */
function pluck(mix: Mix, t0: number, f: number, gain: number, pan = 0, send = 0.4): void {
  mix.voice(t0, 1.4, gain, pan, send, (t) => {
    let x = 0;
    for (let h = 1; h <= 5; h += 1) x += (Math.sin(TAU * f * h * t) / h) * Math.exp(-t * (2.2 + h * 1.6));
    return x * (1 - Math.exp(-t / 0.002));
  });
}

/** A key on a keyboard: a bright tick of noise and a small thump under it. */
function keyClick(mix: Mix, t0: number, gain: number, seed: number, heavy = false): void {
  const rnd = mulberry32(seed);
  const bp = new Biquad("bp", (heavy ? 2200 : 3200) * (0.85 + rnd() * 0.3), 1.4);
  const pan = (rnd() - 0.5) * 0.5;
  const thump = heavy ? 110 : 170 + rnd() * 40;
  const g = gain * 1.7 * (0.8 + rnd() * 0.4);
  mix.voice(t0, heavy ? 0.12 : 0.06, g, pan, 0.08, (t) => {
    const click = bp.run(rnd() * 2 - 1) * Math.exp(-t / (heavy ? 0.009 : 0.004)) * 3.2;
    const body = Math.sin(TAU * thump * t) * Math.exp(-t / (heavy ? 0.03 : 0.012)) * (heavy ? 0.9 : 0.5);
    return click + body;
  });
}

/** Air moving: noise through a band that slides from one pitch to another. */
function whoosh(mix: Mix, t0: number, seconds: number, from: number, to: number, gain: number, pan = 0, send = 0.35, seed = 1): void {
  const rnd = mulberry32(seed);
  const bp = new Biquad("bp", from, 0.9);
  mix.voice(t0, seconds, gain, pan, send, (t, n) => {
    if (n % 32 === 0) bp.set(from * Math.pow(to / from, t / seconds), 0.9);
    const w = Math.sin((Math.PI * t) / seconds);
    return bp.run(rnd() * 2 - 1) * w * w * 2.2;
  });
}

/** A deep drop in pitch felt more than heard, after a short swell of air. */
function boom(mix: Mix, t0: number, gain: number): void {
  whoosh(mix, t0 - 0.9, 0.95, 300, 5200, gain * 0.35, 0, 0.5, 77);
  let phase = 0;
  mix.voice(t0, 2.4, gain, 0, 0.25, (t) => {
    const f = 36 + 26 * Math.exp(-t / 0.18);
    phase += (TAU * f) / SR;
    return Math.tanh(1.6 * Math.sin(phase)) * env(t, 0.004, 0.75);
  });
}

/** A soft weight landing: a low thump with a breath of noise. */
function impact(mix: Mix, t0: number, gain: number, seed: number): void {
  const rnd = mulberry32(seed);
  const lp = new Biquad("lp", 900);
  mix.voice(t0, 0.6, gain, 0, 0.3, (t) => Math.sin(TAU * (70 + 50 * Math.exp(-t / 0.04)) * t) * env(t, 0.002, 0.13) + lp.run(rnd() * 2 - 1) * env(t, 0.001, 0.03) * 0.6);
}

/** Far thunder: a crack, then a long uneven rumble rolling across. */
function thunder(mix: Mix, t0: number, gain: number, seed: number, length = 4): void {
  const rnd = mulberry32(seed);
  const hp = new Biquad("hp", 1800);
  mix.voice(t0, 0.35, gain * 0.5, 0.35, 0.6, (t) => hp.run(rnd() * 2 - 1) * env(t, 0.002, 0.06) * 1.6);
  const lpL = new Biquad("lp", 160);
  const lp2 = new Biquad("lp", 320);
  let brown = 0;
  const bumps = Array.from({ length: 9 }, () => [rnd() * length * 0.8, 0.3 + rnd() * 0.7] as const);
  mix.voice(t0 + 0.12, length, gain, 0.2, 0.4, (t) => {
    brown = brown * 0.995 + (rnd() * 2 - 1) * 0.1;
    let shape = 0;
    for (const [at, amp] of bumps) shape += amp * Math.exp(-Math.pow((t - at) / 0.35, 2));
    const roll = (0.6 + shape) * env(t, 0.05, length * 0.33);
    return (lpL.run(brown) * 2 + lp2.run(rnd() * 2 - 1) * 0.2) * roll;
  });
}

// ---------------------------------------------------------------------------------------------
// The beds: the rain, and the chords under everything.

function rainBed(mix: Mix, seconds: number): void {
  const rnd = mulberry32(2024);
  const hissL = [new Biquad("hp", 1400), new Biquad("lp", 7500)];
  const hissR = [new Biquad("hp", 1400), new Biquad("lp", 7500)];
  const bodyL = new Biquad("lp", 650);
  const bodyR = new Biquad("lp", 650);
  const bodyHpL = new Biquad("hp", 220);
  const bodyHpR = new Biquad("hp", 220);
  const total = Math.ceil(seconds * SR);
  for (let i = 0; i < total; i += 1) {
    const level = rainLevelAt((i / SR) * VIDEO.fps);
    const hiss = 0.012 + 0.085 * level;
    const body = 0.09 * Math.pow(level, 1.6);
    const l = hissL[1]!.run(hissL[0]!.run(rnd() * 2 - 1)) * hiss + bodyHpL.run(bodyL.run(rnd() * 2 - 1)) * body;
    const r = hissR[1]!.run(hissR[0]!.run(rnd() * 2 - 1)) * hiss + bodyHpR.run(bodyR.run(rnd() * 2 - 1)) * body;
    mix.dryL[i]! += l;
    mix.dryR[i]! += r;
    mix.sendL[i]! += l * 0.15;
    mix.sendR[i]! += r * 0.15;
  }
  // Droplets: tiny ticks on leaves and roofs, as many as the rain is heavy.
  const step = 0.002;
  for (let t = 0; t < seconds; t += step) {
    const level = rainLevelAt(t * VIDEO.fps);
    if (level < 0.01) continue;
    if (rnd() < (6 + 160 * level) * step) {
      const f = 1900 + rnd() * 4800;
      const decay = 0.0015 + rnd() * 0.005;
      const g = (0.012 + rnd() * 0.03) * (0.5 + level);
      mix.voice(t, decay * 6, g, rnd() * 2 - 1, 0.25, (u) => Math.sin(TAU * f * u) * env(u, 0.0003, decay));
    }
    if (rnd() < (0.25 + 3.5 * level) * step) plip(mix, t, 500 + rnd() * 900, 0.035 + rnd() * 0.04, rnd() * 1.6 - 0.8, 0.5);
  }
}

/** A chord held under a stretch of the film, swelling in and out. */
type Chord = { from: number; to: number; notes: string[]; gain: number; bright: number };

function pad(mix: Mix, chords: Chord[]): void {
  for (const [c, chord] of chords.entries()) {
    const seconds = chord.to - chord.from;
    chord.notes.forEach((name, v) => {
      const f = note(name);
      const lp = new Biquad("lp", 600 + 2400 * chord.bright, 0.6);
      // The lowest voices are felt, not heard: kept thin so the bass never covers the rest.
      const weight = f < 100 ? 0.35 : f < 160 ? 0.6 : 1;
      const detune = [-0.0023, 0, 0.0021];
      const phases = detune.map((_, k) => (k * 1.7 + v) % TAU);
      const pan = ((v / Math.max(1, chord.notes.length - 1)) * 2 - 1) * 0.6;
      mix.voice(chord.from, seconds, chord.gain * weight, pan, 0.7, (t) => {
        let x = 0;
        detune.forEach((d, k) => {
          phases[k]! += (TAU * f * (1 + d)) / SR;
          const p = phases[k]!;
          // A soft saw-ish tone: a few harmonics, falling fast.
          x += Math.sin(p) + 0.32 * Math.sin(2 * p) + 0.12 * Math.sin(3 * p) + 0.05 * Math.sin(4 * p);
        });
        const fadeIn = Math.min(1, t / 1.6);
        const fadeOut = Math.min(1, (seconds - t) / 1.4);
        const swell = 0.85 + 0.15 * Math.sin(TAU * 0.11 * t + c + v);
        return lp.run(x / 3) * fadeIn * fadeIn * fadeOut * swell;
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The score: every cue of the film.

function score(lang: Lang): Mix {
  const copy = COPY[lang];
  const seconds = totalFrames() / VIDEO.fps + 0.2;
  const mix = new Mix(seconds);
  const s = (scene: keyof typeof SCENES, frame: number): number => frameTime(SCENES[scene].from + frame);
  const end = totalFrames() / VIDEO.fps;

  rainBed(mix, seconds);

  pad(mix, [
    { from: s("intro", INTRO.dropHit) - 0.2, to: s("models", 0) + 0.8, notes: ["D3", "A3", "C#4", "E4", "F#4"], gain: 0.032, bright: 0.35 },
    { from: s("models", 0), to: s("demo", 0) + 0.8, notes: ["B2", "F#3", "A3", "C#4", "D4"], gain: 0.03, bright: 0.4 },
    { from: s("demo", 0), to: s("effort", 0) + 0.8, notes: ["G2", "D3", "F#3", "B3", "C#4"], gain: 0.032, bright: 0.3 },
    { from: s("effort", 0), to: s("promises", 0) + 0.8, notes: ["E2", "B2", "E3", "G3", "D4", "F#4"], gain: 0.03, bright: 0.7 },
    { from: s("promises", 0), to: s("outro", 0) + 0.8, notes: ["A2", "E3", "B3", "C#4", "E4"], gain: 0.03, bright: 0.45 },
    { from: s("outro", 0), to: end + 0.1, notes: ["D2", "D3", "A3", "C#4", "E4", "F#4", "A4"], gain: 0.03, bright: 0.5 },
  ]);

  // Intro: one drop in the dark, the name, the mark collecting, light across it.
  plip(mix, s("intro", INTRO.dropHit), 780, 0.55, 0, 0.9);
  mix.voice(s("intro", INTRO.dropHit), 3, 0.13, 0, 0.6, (t) => Math.sin(TAU * 73.4 * t) * env(t, 0.08, 0.9));
  bell(mix, s("intro", INTRO.dropHit) + 0.05, note("D6"), 0.08, 0.2, 0.9, 4);
  const pentatonic = ["D6", "E6", "F#6", "A6", "B6", "D7", "E7"];
  [...copy.intro.word].forEach((_, i) => plip(mix, s("intro", INTRO.word + i * 4), note(pentatonic[i % pentatonic.length]!) / 2, 0.16, (i / 5 - 0.5) * 0.8, 0.6));
  whoosh(mix, s("intro", INTRO.entryOut), 0.6, 4000, 700, 0.1, 0, 0.4, 3);
  logoFill(mix, s("intro", INTRO.fillStart), s("intro", INTRO.fillEnd), 31);
  boom(mix, s("intro", INTRO.fillEnd), 0.5);
  bell(mix, s("intro", INTRO.sweep) + 0.1, note("A5"), 0.14, -0.3, 0.8, 4);
  bell(mix, s("intro", INTRO.sweep) + 0.32, note("D6"), 0.12, 0.3, 0.8, 4);
  whoosh(mix, s("intro", INTRO.tagline) - 0.05, 0.7, 900, 3200, 0.05, 0, 0.3, 5);

  // Every scene change: a drop lands, and the ripple carries the next scene in.
  transitions().forEach((tr, i) => {
    const t = frameTime(tr.at);
    plip(mix, t, 640 + i * 60, 0.32, ((tr.x - 960) / 960) * 0.6, 0.8);
    whoosh(mix, t - 0.02, 0.75, 3200, 500, 0.12, 0, 0.5, 40 + i);
    mix.voice(t, 0.8, 0.07, 0, 0.3, (u) => Math.sin(TAU * 58 * u) * env(u, 0.005, 0.25));
  });

  // Models: the hub, then every model landing like a drop, on a rising scale.
  pluck(mix, s("models", MODELS.hub), note("D4"), 0.16, 0, 0.5);
  plip(mix, s("models", MODELS.local), note("F#5") / 1.2, 0.2, -0.6, 0.6);
  pluck(mix, s("models", MODELS.local), note("F#4"), 0.08, -0.6, 0.5);
  const scale = ["A5", "B5", "D6", "E6", "F#6", "A6", "B6", "D7"];
  copy.models.providers.forEach((_, i) => {
    const t = s("models", MODELS.chip(i));
    plip(mix, t, note(scale[i]!) / 1.5, 0.15, 0.2 + 0.5 * Math.sin((i / 7) * Math.PI), 0.55);
    blip(mix, t + 0.01, note(scale[i]!), 0.05, 0.4, 0.5);
  });
  keyClick(mix, s("models", MODELS.compat), 0.12, 501);

  // Demo: the keys, the reasoning, each tool, the question, the tests.
  keyFrames(copy.demo.prompt.length, DEMO.typeStart, DEMO.typeCps).forEach((f, i) => keyClick(mix, s("demo", f), copy.demo.prompt[i] === " " ? 0.1 : 0.14, 1000 + i));
  keyClick(mix, s("demo", DEMO.submit), 0.3, 1999, true);
  {
    const t0 = s("demo", DEMO.reasonStart);
    const length = s("demo", DEMO.collapse) - t0;
    const rnd = mulberry32(5);
    const bp = new Biquad("bp", 5200, 2.5);
    mix.voice(t0, length, 0.05, 0, 0.6, (t) => bp.run(rnd() * 2 - 1) * (0.6 + 0.4 * Math.sin(TAU * 6 * t)) * Math.min(1, t / 0.3, (length - t) / 0.3) * 2);
    for (let k = 0; k < 9; k += 1) bell(mix, t0 + k * (length / 9), note(["A6", "E6", "F#6", "B6", "D6"][k % 5]!), 0.018, (k % 3) - 1, 0.9, 1.5);
  }
  whoosh(mix, s("demo", DEMO.collapse), 0.35, 1500, 5000, 0.06, 0, 0.3, 9);
  blip(mix, s("demo", DEMO.readDone), note("E6"), 0.1, -0.2);
  blip(mix, s("demo", DEMO.editDone), note("A6"), 0.1, 0.2);
  copy.demo.diff.forEach((line, i) => blip(mix, s("demo", DEMO.diffStart + i * DEMO.diffStep), line.kind === "del" ? note("D5") : note(["F#5", "A5", "B5", "D6", "E6"][i % 5]!), 0.05, 0.1));
  bell(mix, s("demo", DEMO.approval), note("B5"), 0.11, 0.1, 0.5, 1.6);
  bell(mix, s("demo", DEMO.approval) + 0.13, note("E6"), 0.1, 0.1, 0.5, 1.8);
  keyClick(mix, s("demo", DEMO.approve), 0.3, 2999, true);
  blip(mix, s("demo", DEMO.approve) + 0.03, note("A5"), 0.08);
  ["D5", "F#5", "A5", "D6"].forEach((n, i) => pluck(mix, s("demo", DEMO.bashDone) + i * 0.07, note(n), 0.13, (i - 1.5) * 0.3, 0.5));
  CAPTION_AT.forEach((f, i) => whoosh(mix, s("demo", f), 0.5, 600, 2400, 0.04, -0.4, 0.3, 300 + i));

  // Effort: ctrl+e, a step up each time, and the storm when it reaches max.
  EFFORT.steps.forEach((f, i) => {
    const t = s("effort", f);
    keyClick(mix, t - 0.03, 0.16, 4000 + i * 2);
    keyClick(mix, t, 0.18, 4001 + i * 2);
    pluck(mix, t + 0.02, note(["D4", "E4", "F#4", "A4", "D5"][i]!), 0.12 + i * 0.02, 0, 0.5);
    whoosh(mix, t, 0.7, 400 + i * 200, 1800 + i * 900, 0.04 + i * 0.015, 0, 0.4, 600 + i);
  });
  thunder(mix, s("effort", LIGHTNING[0]), 0.38, 71, 4.2);
  mix.voice(s("effort", LIGHTNING[1]), 0.3, 0.12, -0.3, 0.6, (() => {
    const rnd = mulberry32(72);
    const hp = new Biquad("hp", 2500);
    return (t: number) => hp.run(rnd() * 2 - 1) * env(t, 0.002, 0.05);
  })());

  // Promises: a weight for each card, the count, the strike, the rules, the cache.
  whoosh(mix, s("promises", PROMISES.title), 0.6, 800, 3000, 0.05, 0, 0.3, 700);
  PROMISES.cards.forEach((f, i) => {
    impact(mix, s("promises", f + 10), 0.32, 800 + i);
    bell(mix, s("promises", f + 12), note(["A5", "C#6", "E6"][i]!), 0.06, (i - 1) * 0.5, 0.7, 2.2);
  });
  {
    const card = PROMISES.cards[0];
    const from = s("promises", card + PROMISES.countFrom);
    const to = s("promises", card + PROMISES.countTo);
    const measured = Number(copy.promises.speed.measured);
    for (let v = 4; v <= measured; v += 4) {
      // The count eases out (cubic): find when it passes v.
      const k = 1 - Math.cbrt(1 - v / measured);
      blip(mix, from + k * (to - from), 1500 + v * 12, 0.035, -0.5, 0.1);
    }
    blip(mix, to, note("A6"), 0.08, -0.5, 0.4);
    whoosh(mix, s("promises", card + PROMISES.strike), 0.22, 2500, 7000, 0.07, -0.5, 0.2, 801);
  }
  copy.promises.rules.forEach((rule, i) => {
    const t = s("promises", PROMISES.row(1, i));
    blip(mix, t, note("E5"), 0.05, 0, 0.2);
    blip(mix, t + 10 / VIDEO.fps, rule.verdict === "allow" ? note("A6") : rule.verdict === "ask" ? note("E6") : note("B5"), 0.08, 0, 0.3);
  });
  [0, 1, 2].forEach((i) => blip(mix, s("promises", PROMISES.row(2, i)), note(["D6", "E6", "F#6"][i]!), 0.06, 0.5, 0.3));
  bell(mix, s("promises", PROMISES.bracket), note("A6"), 0.05, 0.5, 0.7, 2);

  // Outro: the mark again, the two commands, the resolve, and the last drop.
  logoFill(mix, s("outro", OUTRO.fillStart), s("outro", OUTRO.fillEnd), 32);
  boom(mix, s("outro", OUTRO.fillEnd), 0.32);
  bell(mix, s("outro", OUTRO.sweep) + 0.1, note("F#5"), 0.1, -0.3, 0.8, 4);
  keyFrames(copy.outro.install.length, OUTRO.installStart, OUTRO.installCps).forEach((f, i) => keyClick(mix, s("outro", f), 0.13, 5000 + i));
  keyClick(mix, s("outro", OUTRO.enter1), 0.26, 5999, true);
  keyFrames(copy.outro.run.length, OUTRO.runStart, OUTRO.runCps).forEach((f, i) => keyClick(mix, s("outro", f), 0.14, 6000 + i));
  keyClick(mix, s("outro", OUTRO.enter2), 0.3, 6999, true);
  ["D5", "F#5", "A5", "C#6", "E6"].forEach((n, i) => bell(mix, s("outro", OUTRO.enter2) + 0.05 + i * 0.06, note(n), 0.09, (i - 2) * 0.35, 0.85, 5));
  mix.voice(s("outro", OUTRO.enter2), 3, 0.1, 0, 0.5, (t) => Math.sin(TAU * note("D2") * t) * env(t, 0.05, 1.2));
  whoosh(mix, s("outro", OUTRO.line) - 0.05, 0.8, 700, 2600, 0.05, 0, 0.3, 900);
  plip(mix, end - 1.35, 700, 0.3, 0.1, 0.95);
  return mix;
}

/** The mark filling in: a tiny tick for every letter cell, on the same law as the picture. */
function logoFill(mix: Mix, from: number, to: number, seed: number): void {
  const rnd = mulberry32(seed);
  for (let row = 0; row < LOGO.length; row += 1) {
    for (let column = 0; column < LOGO[0].length; column += 1) {
      if (LOGO[row]![column] === " ") continue;
      const t = from + reachedAt(column, row) * (to - from);
      const f = 2400 + rnd() * 2600;
      mix.voice(t, 0.05, 0.05 + rnd() * 0.03, (column / 15) * 1.6 - 0.8, 0.5, (u) => Math.sin(TAU * f * u) * env(u, 0.0004, 0.006));
      if (rnd() < 0.35) plip(mix, t, 900 + rnd() * 900, 0.05, (column / 15) * 1.6 - 0.8, 0.6);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Space and master.

/** A Freeverb-style hall: eight damped combs into four all-passes, per side. */
function reverb(input: Float32Array, spread: number): Float32Array {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0, store: 0 }));
  const alls = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 }));
  const feedback = 0.86;
  const damp = 0.35;
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n += 1) {
    const x = input[n]! * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i]!;
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of alls) {
      const b = a.buf[a.i]!;
      a.buf[a.i] = y + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = b - y;
    }
    out[n] = y;
  }
  return out;
}

/**
 * The master: dry and reverb together, a gentle compressor so the quiet keys and the loud storm
 * live in the same film, a loudness target, and a soft limiter on the peaks.
 */
function master(mix: Mix): [Float32Array, Float32Array] {
  const wetL = reverb(mix.sendL, 0);
  const wetR = reverb(mix.sendR, 23);
  const L = new Float32Array(mix.length);
  const R = new Float32Array(mix.length);
  const hpL = new Biquad("hp", 28);
  const hpR = new Biquad("hp", 28);
  for (let n = 0; n < mix.length; n += 1) {
    L[n] = hpL.run(mix.dryL[n]! + wetL[n]!);
    R[n] = hpR.run(mix.dryR[n]! + wetR[n]!);
  }
  // Compressor: a level follower on both sides, 2.5:1 above the threshold.
  let peak = 0;
  for (let n = 0; n < mix.length; n += 1) peak = Math.max(peak, Math.abs(L[n]!), Math.abs(R[n]!));
  const threshold = peak * Math.pow(10, -22 / 20);
  const attack = 1 - Math.exp(-1 / (0.006 * SR));
  const release = 1 - Math.exp(-1 / (0.25 * SR));
  let level = 0;
  for (let n = 0; n < mix.length; n += 1) {
    const x = Math.max(Math.abs(L[n]!), Math.abs(R[n]!));
    level += (x - level) * (x > level ? attack : release);
    const g = level > threshold ? Math.pow(threshold / level, 1 - 1 / 2.5) : 1;
    L[n]! *= g;
    R[n]! *= g;
  }
  // Loudness: put the loud end of the film (the 90th percentile of 400 ms windows) at the target.
  const win = Math.round(0.4 * SR);
  const windows: number[] = [];
  for (let s = 0; s + win <= mix.length; s += win / 4) {
    let sum = 0;
    for (let n = s; n < s + win; n += 1) sum += L[n]! * L[n]! + R[n]! * R[n]!;
    windows.push(Math.sqrt(sum / (2 * win)));
  }
  windows.sort((a, b) => a - b);
  const loud = windows[Math.floor(windows.length * 0.9)]!;
  const gain = Math.pow(10, AUDIO.loudDb / 20) / loud;
  // Soft limiter: untouched below the knee, rounded above it, never past the ceiling.
  const ceiling = Math.pow(10, AUDIO.peakDb / 20);
  const knee = ceiling * 0.7;
  const limit = (x: number): number => {
    const a = Math.abs(x);
    if (a <= knee) return x;
    return Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  };
  // Fade the very first and last moments so nothing clicks.
  const fade = Math.round(0.01 * SR);
  for (let n = 0; n < mix.length; n += 1) {
    const edge = Math.min(1, n / fade, (mix.length - 1 - n) / fade);
    L[n] = limit(L[n]! * gain) * edge;
    R[n] = limit(R[n]! * gain) * edge;
  }
  return [L, R];
}

function wav(L: Float32Array, R: Float32Array): Buffer {
  const frames = L.length;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let n = 0; n < frames; n += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n]!)) * 32767), 44 + n * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n]!)) * 32767), 46 + n * 4);
  }
  return buffer;
}

const langs = (process.argv[2] === undefined ? ["en", "fr"] : [process.argv[2]]) as Lang[];
const dir = new URL("../public/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const lang of langs) {
  const started = Date.now();
  const [L, R] = master(score(lang));
  writeFileSync(new URL(`soundtrack-${lang}.wav`, dir), wav(L, R));
  console.log(`soundtrack-${lang}.wav  ${(L.length / SR).toFixed(2)} s  ${((Date.now() - started) / 1000).toFixed(1)} s to make`);
}
