// Sound effects, synthesized (no samples, nothing to license), mixed at the times the scenes cued them.
//
//   node engine/sfx.mjs out/film.mp4             reads out/film.cues.json, writes out/film.sfx.wav and
//                                                out/film.final.mp4 (the video with the effects, no music)
//   node engine/sfx.mjs --gallery                out/sfx-gallery.wav: every sound once, to listen
//
// The music and the voice-over are mixed later, over this track.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000;

// ------------------------------------------------------------------------------------------------ synthesis

/** A seeded noise, so every render sounds the same. */
function noise(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
/** A one-pole low-pass with a cutoff that may move (Hz as a function of time). */
function lowpass(x, cutoff) {
  let y = 0;
  return x.map((v, i) => {
    const c = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff;
    const k = 1 - Math.exp((-2 * Math.PI * c) / SR);
    y += k * (v - y);
    return y;
  });
}
const highpass = (x, cutoff) => {
  const low = lowpass(x, cutoff);
  return x.map((v, i) => v - low[i]);
};
/** A sine whose frequency moves (Hz as a function of time). */
function sweep(sec, freq, amp = (t) => 1, shape = Math.sin) {
  const out = buf(sec);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * freq(t)) / SR;
    out[i] = shape(ph) * amp(t);
  }
  return out;
}
const mixIn = (into, x, at = 0, g = 1) => {
  const o = Math.round(at * SR);
  for (let i = 0; i < x.length && o + i < into.length; i++) into[o + i] += x[i] * g;
  return into;
};

const SOUNDS = {
  /** A bubble popping in: a quick upward blip. */
  pop: () => sweep(0.12, (t) => 520 + 2600 * t, (t) => env(t, 0.003, 0.03) * 0.6),
  /** A softer, lower pop for small items. */
  tick: () => sweep(0.06, () => 1800, (t) => env(t, 0.001, 0.01) * 0.25),
  /** A finger tap on glass. */
  tap: () => {
    const n = noise(7);
    return lowpass(
      buf(0.07).map((_, i) => n() * env(i / SR, 0.001, 0.008)),
      3500,
    ).map((v, i) => v * 0.9 + Math.sin((2 * Math.PI * 180 * i) / SR) * env(i / SR, 0.001, 0.02) * 0.4);
  },
  /** A key on a phone keyboard. */
  key: () => {
    const n = noise(11);
    return highpass(buf(0.04).map((_, i) => n() * env(i / SR, 0.0005, 0.006)), 1800).map((v) => v * 0.35);
  },
  /** Air moving past: noise swept through a filter. */
  whoosh: () => {
    const n = noise(3);
    const len = 0.55;
    const x = buf(len).map((_, i) => {
      const t = i / SR;
      return n() * Math.sin((Math.PI * t) / len) ** 2;
    });
    return lowpass(highpass(x, 300), (t) => 600 + 5000 * Math.sin((Math.PI * t) / len)).map((v) => v * 0.9);
  },
  /** A short, bright swish for quick moves. */
  swish: () => {
    const n = noise(5);
    const len = 0.25;
    const x = buf(len).map((_, i) => n() * Math.sin((Math.PI * (i / SR)) / len) ** 3);
    return lowpass(highpass(x, 1500), (t) => 2000 + 9000 * (t / len)).map((v) => v * 0.6);
  },
  /** Something landing heavy: a low thump. */
  thud: () => {
    const n = noise(9);
    const body = sweep(0.35, (t) => 110 * Math.exp(-t * 6) + 45, (t) => env(t, 0.002, 0.09));
    const hit = lowpass(buf(0.05).map((_, i) => n() * env(i / SR, 0.0005, 0.01)), 900);
    return mixIn(body.map((v) => v * 0.9), hit, 0, 0.8);
  },
  /** A message arriving: two soft bell notes. */
  ding: () => {
    const bell = (f) => sweep(0.6, () => f, (t) => env(t, 0.002, 0.18) * 0.35).map(
      (v, i) => v + Math.sin((2 * Math.PI * f * 2.76 * i) / SR) * env(i / SR, 0.001, 0.05) * 0.08,
    );
    return mixIn(mixIn(buf(0.75), bell(1318.5)), bell(1760), 0.09);
  },
  /** Success: a rising major arpeggio. */
  chime: () => {
    const out = buf(1.4);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) =>
      mixIn(out, sweep(1.0, () => f, (t) => env(t, 0.004, 0.32) * 0.28), k * 0.07),
    );
    return out;
  },
  /** Money: a bright coin. */
  coin: () => {
    const out = buf(0.6);
    mixIn(out, sweep(0.08, () => 1975.5, (t) => env(t, 0.001, 0.05) * 0.3));
    mixIn(out, sweep(0.5, () => 2637, (t) => env(t, 0.001, 0.16) * 0.3), 0.07);
    return out;
  },
  /** A phone vibrating on a table. */
  buzz: () =>
    sweep(0.5, () => 150, (t) => (Math.floor(t * 18) % 3 === 2 ? 0 : 1) * env(t, 0.01, 0.4) * 0.5, (p) =>
      Math.sign(Math.sin(p)) * 0.6 + Math.sin(p * 2) * 0.3,
    ).map((v, i, a) => (i ? (v + a[i - 1]) / 2 : v)),
  /** Sparkles: a few random high blips. */
  sparkle: () => {
    const out = buf(0.9);
    const r = noise(21);
    for (let k = 0; k < 9; k++)
      mixIn(out, sweep(0.12, () => 2500 + Math.abs(r()) * 3000, (t) => env(t, 0.001, 0.03) * 0.12), Math.abs(r()) * 0.7);
    return out;
  },
  /** A stamp landing: a dull knock. */
  stamp: () => {
    const n = noise(13);
    return mixIn(
      sweep(0.2, (t) => 220 * Math.exp(-t * 10) + 80, (t) => env(t, 0.001, 0.04) * 0.8),
      lowpass(buf(0.04).map((_, i) => n() * env(i / SR, 0.0005, 0.006)), 2500),
      0,
      0.6,
    );
  },
  /** Rising tension for a reveal. */
  riser: () => {
    const n = noise(17);
    const len = 1.2;
    const x = buf(len).map((_, i) => n() * (i / SR / len) ** 2);
    return mixIn(
      lowpass(x, (t) => 400 + 7000 * (t / len)).map((v) => v * 0.5),
      sweep(len, (t) => 200 + 600 * (t / len) ** 2, (t) => (t / len) ** 2 * 0.15),
    );
  },
  /** A soft clock tick for the countdown. */
  clock: () => sweep(0.05, () => 3200, (t) => env(t, 0.0005, 0.006) * 0.2),
  /** Paper sliding. */
  paper: () => {
    const n = noise(29);
    const len = 0.4;
    const x = buf(len).map((_, i) => n() * Math.sin((Math.PI * (i / SR)) / len));
    return lowpass(highpass(x, 2500), 7000).map((v) => v * 0.35);
  },
};

// ------------------------------------------------------------------------------------------------ output

function writeWav(path, left, right = left) {
  const n = left.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** Mixes cues ({t, name, gain, pan?}) into a stereo track of `sec` seconds, with a soft limiter. */
export function mix(cues, sec) {
  const L = buf(sec);
  const R = buf(sec);
  const cache = {};
  for (const c of cues) {
    const make = SOUNDS[c.name];
    if (!make) {
      console.warn(`unknown sound "${c.name}"`);
      continue;
    }
    const x = (cache[c.name] ??= make());
    const pan = c.pan ?? 0;
    mixIn(L, x, c.t, (c.gain ?? 1) * Math.min(1, 1 - pan));
    mixIn(R, x, c.t, (c.gain ?? 1) * Math.min(1, 1 + pan));
  }
  const soft = (v) => Math.tanh(v * 1.2) / Math.tanh(1.2);
  return [L.map(soft), R.map(soft)];
}

const args = process.argv.slice(2);
if (args[0] === '--gallery') {
  const names = Object.keys(SOUNDS);
  const [l, r] = mix(names.map((name, i) => ({ t: 0.3 + i * 1.6, name })), names.length * 1.6 + 1);
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeWav(join(ROOT, 'out/sfx-gallery.wav'), l, r);
  console.log(`out/sfx-gallery.wav: ${names.join(', ')}, 1.6 s apart`);
} else if (args[0]) {
  const video = resolve(args[0]);
  const cues = JSON.parse(readFileSync(video.replace(/\.mp4$/, '.cues.json'), 'utf8'));
  const sec = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], {
      encoding: 'utf8',
    }),
  );
  const wav = video.replace(/\.mp4$/, '.sfx.wav');
  writeWav(wav, ...mix(cues, sec));
  const final = video.replace(/\.mp4$/, '.final.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', final]);
  console.log(`${cues.length} cues → ${wav}\nwith the video → ${final}`);
} else if (!existsSync(args[0] ?? '')) {
  console.log('usage: node engine/sfx.mjs <video.mp4> | --gallery');
}
