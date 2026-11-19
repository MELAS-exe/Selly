// Renders the film (film/index.html) frame by frame: the page's GSAP timeline is paused and seeked to each frame's
// time, the page is captured, and the frames go to ffmpeg. Deterministic, so a frame is the same on every run.
//
//   node engine/render.mjs                      the whole film to out/film.mp4
//   node engine/render.mjs --scene 6            one scene (with its transitions) to out/scene-6.mp4
//   node engine/render.mjs --from 70 --to 80    a time range, in seconds
//   node engine/render.mjs --half               960×540, for quick checks
//
// Also writes <out>.cues.json: the sound effects the scenes asked for, with their times (engine/sfx.mjs mixes them).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const FPS = Number(opt('fps', 30));
const half = args.includes('--half');
const scene = opt('scene');

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: half ? 0.5 : 1,
});
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(
  `${pathToFileURL(join(ROOT, 'film/index.html'))}?render${args.includes('--subs') ? '&subs' : ''}`,
);
await page.waitForFunction(() => window.film?.ready === true, null, { timeout: 60_000 });

// --stills 3,40.5,119: single frames to out/still-<t>.jpg, to check a moment without rendering.
if (opt('stills')) {
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  for (const t of opt('stills').split(',').map(Number)) {
    await page.evaluate((x) => window.film.seek(x), t);
    await page.screenshot({ path: join(ROOT, 'out', `still-${t}.jpg`), type: 'jpeg', quality: 85 });
  }
  await browser.close();
  console.log(`stills in out/: ${opt('stills')}`);
  process.exit(0);
}

const info = await page.evaluate((s) => window.film.range(s), scene ?? null);
const from = Number(opt('from', info.from));
const to = Number(opt('to', info.to));
const out = resolve(opt('out', join(ROOT, 'out', scene ? `scene-${scene}.mp4` : 'film.mp4')));
mkdirSync(dirname(out), { recursive: true });

const frames = Math.round((to - from) * FPS);
console.log(`rendering ${frames} frames (${from}s to ${to}s) to ${out}`);
const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(FPS),
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    half ? 'veryfast' : 'slow',
    '-crf',
    half ? '23' : '15',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    out,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const cdp = await page.context().newCDPSession(page);
const started = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.film.seek(t), from + f / FPS);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 95,
    optimizeForSpeed: true,
  });
  if (!ff.stdin.write(Buffer.from(data, 'base64')))
    await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 150 === 0) {
    const rate = (f + 1) / ((Date.now() - started) / 1000);
    process.stdout.write(
      `\r  ${f}/${frames} · ${rate.toFixed(1)} fps · ${Math.round((frames - f) / rate)} s left   `,
    );
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
const cues = (await page.evaluate(() => window.film.cues))
  .filter((c) => c.t >= from && c.t < to)
  .map((c) => ({ ...c, t: +(c.t - from).toFixed(3) }));
writeFileSync(out.replace(/\.mp4$/, '.cues.json'), JSON.stringify(cues, null, 1));
await browser.close();
console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)} s, ${cues.length} sound cues`);
