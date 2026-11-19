// Records takes of the real app (takes.mjs) as clips for the film: Chrome's screencast gives each painted frame with
// its time, and the frames are laid on a constant 30 fps grid, so a clip plays back at the speed it happened.
// Clips are all-intra (every frame a keyframe): the film seeks them frame by frame.
//
//   node engine/capture.mjs                  every take
//   node engine/capture.mjs chat payment     some takes
//
// The local stack must run with the scripted assistant: LLM_PRIMARY=video (see README.md).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { takes } from './takes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;

/** A dot that follows the pointer and rings on press: clicks and taps read on screen. */
const POINTER = () => {
  const touch = matchMedia('(pointer: coarse)').matches;
  const style = document.createElement('style');
  style.textContent = `
    .vid-pointer{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;border-radius:50%;
      width:${touch ? 46 : 22}px;height:${touch ? 46 : 22}px;margin:${touch ? -23 : -11}px 0 0 ${touch ? -23 : -11}px;
      background:${touch ? 'rgba(23,59,50,.22)' : 'rgba(17,17,17,.85)'};border:${touch ? '2px solid rgba(23,59,50,.55)' : '2px solid #fff'};
      box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:${touch ? 0 : 1};transition:opacity .2s, transform .12s}
    .vid-pointer.down{transform:scale(.8)}
    .vid-ring{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;border:3px solid #8aae4a;
      width:20px;height:20px;margin:-10px 0 0 -10px;animation:vid-ring .5s ease-out forwards}
    @keyframes vid-ring{to{transform:scale(3.2);opacity:0}}`;
  const dot = document.createElement('div');
  dot.className = 'vid-pointer';
  const mount = () => document.body && !dot.isConnected && (document.head.append(style), document.body.append(dot));
  document.addEventListener('DOMContentLoaded', mount);
  mount();
  const move = (x, y) => (dot.style.left = `${x}px`, dot.style.top = `${y}px`);
  const press = (x, y) => {
    move(x, y);
    dot.classList.add('down');
    if (touch) dot.style.opacity = 1;
    const r = document.createElement('div');
    r.className = 'vid-ring';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    setTimeout(() => r.remove(), 600);
  };
  const release = () => {
    dot.classList.remove('down');
    if (touch) setTimeout(() => (dot.style.opacity = 0), 250);
  };
  addEventListener('pointermove', (e) => move(e.clientX, e.clientY), true);
  addEventListener('pointerdown', (e) => press(e.clientX, e.clientY), true);
  addEventListener('pointerup', release, true);
  addEventListener('touchstart', (e) => press(e.touches[0].clientX, e.touches[0].clientY), true);
  addEventListener('touchend', release, true);
};

async function record(name, take, browser) {
  const { width, height, scale = 1, mobile = false } = take.viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'en-GB',
    timezoneId: 'Africa/Dakar',
    reducedMotion: 'no-preference',
    ...(mobile && {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    }),
  });
  if (take.pointer !== false) await context.addInitScript(POINTER);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`  [${name}] ${e.message}`));
  await take.setup?.(page, context);

  // RECORDER=screencast (default): Chrome sends each painted frame with its time. RECORDER=shots: screenshots in a
  // loop, sharper when the screencast paints at 1 CSS pixel per pixel, but slower.
  const cdp = await context.newCDPSession(page);
  const frames = [];
  let recording = true;
  let recorder;
  if (process.env.RECORDER === 'shots') {
    recorder = (async () => {
      while (recording) {
        const before = Date.now();
        try {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
          frames.push({ t: (before + Date.now()) / 2000, data });
        } catch {
          await new Promise((r) => setTimeout(r, 20)); // between two documents
        }
      }
    })();
  } else {
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      frames.push({ t: metadata.timestamp, data });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: Math.round(width * scale),
      maxHeight: Math.round(height * scale),
    });
    recorder = Promise.resolve().then(async () => {
      while (recording) await new Promise((r) => setTimeout(r, 50));
      await cdp.send('Page.stopScreencast');
    });
  }
  const marks = {};
  /** Values the film shows as they were in the take (the sats amount moves with the rate). */
  const notes = {};
  const note = (key, value) => (notes[key] = value);
  const t0 = Date.now() / 1000;
  /** Named moments of the take, in seconds from its start: the film times its overlays on them. */
  const mark = (label) => {
    marks[label] = +(Date.now() / 1000 - t0).toFixed(2);
    if (process.env.DEBUG) console.log(`    ${label} at ${marks[label]} s, ${frames.length} frames`);
  };
  await take.run(page, { mark, note, context });
  await page.waitForTimeout(take.tail ?? 800);
  recording = false;
  await recorder;
  const end = Date.now() / 1000;
  await context.close();

  if (!frames.length) throw new Error(`${name}: no frame captured`);
  const out = join(ROOT, 'clips', `${name}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-g', '1', '-pix_fmt', 'yuv420p', out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const start = frames[0].t;
  const count = Math.round((end - start) * FPS);
  let k = 0;
  for (let f = 0; f < count; f++) {
    const t = start + f / FPS;
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
    if (!ff.stdin.write(Buffer.from(frames[k].data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  // Marks relative to the first frame, the clip's 0.
  const shift = start - t0;
  const rel = Object.fromEntries(Object.entries(marks).map(([k2, v]) => [k2, +(v - shift).toFixed(2)]));
  console.log(`  ${name}: ${(count / FPS).toFixed(1)} s, ${frames.length} painted frames, marks ${JSON.stringify(rel)}`);
  return { ...rel, ...notes };
}

const only = process.argv.slice(2);
// Headed (off-screen): headless, the screencast paints at 1 CSS pixel per pixel. HEADED=0 to stay headless.
process.env.HEADED ??= '1';
if (process.env.HEADED === '0') delete process.env.HEADED;
const browser = await launch();
const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
const marksFile = join(ROOT, 'clips', 'marks.json');
const allMarks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, 'utf8')) : {};
for (const [name, take] of Object.entries(takes)) {
  if (only.length && !only.includes(name)) continue;
  console.log(`take ${name}`);
  allMarks[name] = await record(name, take, browser);
  writeFileSync(marksFile, JSON.stringify(allMarks, null, 1));
  // The film reads them as a script: a page opened from a file cannot fetch another file.
  writeFileSync(join(ROOT, 'clips', 'marks.js'), `window.MARKS = ${JSON.stringify(allMarks, null, 1)};\n`);
}
await browser.close();
