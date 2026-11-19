// The film's runtime: one paused GSAP timeline for the whole film, the scenes placed on it, the sound cues they ask
// for, and seeking that waits for the captured clips (<video>) to show the right frame. engine/render.mjs drives it
// with ?render; opened as is, the page plays in real time with a scrubber, to tune the motion.
/* global gsap */

const RENDER = location.search.includes('render');

const film = {
  ready: false,
  /** { t, name, gain } in seconds from the start of the film. */
  cues: [],
  scenes: [],
  tl: gsap.timeline({ paused: true }),

  /**
   * Adds a scene. Its layer shows from `start - inFor` (its entrance overlaps the scene before) to
   * `start + dur + outFor` (its exit overlaps the next). build(tl, el, ctx) puts its tweens on the film's
   * timeline at ctx.at(local), local 0 being `start`: an entrance uses negative local times.
   */
  scene(id, { start, dur, inFor = 0, outFor = 0.8, build }) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no layer #${id}`);
    const at = (local) => +(start + local).toFixed(4);
    const ctx = {
      start,
      dur,
      at,
      /** A sound effect at a local time (engine/sfx.mjs). */
      cue: (name, local, gain = 1) => film.cues.push({ t: at(local), name, gain }),
      $: (sel) => el.querySelector(sel),
      $$: (sel) => [...el.querySelectorAll(sel)],
    };
    gsap.set(el, { autoAlpha: 0 });
    film.tl.set(el, { autoAlpha: 1 }, at(-inFor));
    build(film.tl, el, ctx);
    film.tl.set(el, { autoAlpha: 0 }, at(dur + outFor));
    film.scenes.push({ id, start, dur, inFor, outFor });
  },

  range(n) {
    const end = Math.max(...film.scenes.map((s) => s.start + s.dur));
    if (!n) return { from: 0, to: end };
    const s = film.scenes.find((x) => x.id === `s${n}` || x.id === n);
    return { from: Math.max(0, s.start - s.inFor), to: Math.min(end, s.start + s.dur + s.outFor) };
  },

  /**
   * Ties a clip (<video>) to the film: `map` is [[film time, clip time], …], straight lines in between, held
   * before the first point and after the last. Two points with the same clip time hold a frame; a steeper
   * line plays faster.
   */
  clip(video, map) {
    video.dataset.map = JSON.stringify(map);
    return video;
  },

  /** Shows the frame at t: the timeline, then every clip on screen at the right frame. */
  async seek(t) {
    film.tl.seek(t, false);
    const waits = [];
    for (const v of document.querySelectorAll('video[data-map]')) {
      const layer = v.closest('.scene');
      if (layer && getComputedStyle(layer).visibility === 'hidden') continue;
      const map = JSON.parse(v.dataset.map);
      let local = map[0][1];
      for (let i = 0; i < map.length; i++) {
        const [ft, ct] = map[i];
        if (t >= ft) local = ct;
        const next = map[i + 1];
        if (next && t >= ft && t < next[0]) local = ct + ((t - ft) / (next[0] - ft)) * (next[1] - ct);
      }
      const target = Math.max(0, Math.min(local, (v.duration || 0) - 0.001));
      if (Math.abs(v.currentTime - target) < 0.004) continue;
      waits.push(new Promise((r) => v.addEventListener('seeked', r, { once: true })));
      v.currentTime = target;
    }
    await Promise.all(waits);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};
window.film = film;

/** Waits for the fonts, images and clips, so the first frame is already complete. */
film.start = async () => {
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((i) => (i.complete ? null : new Promise((r) => i.addEventListener('load', r, { once: true })))),
  );
  await Promise.all(
    [...document.querySelectorAll('video')].map((v) => {
      v.muted = true;
      v.preload = 'auto';
      return v.readyState >= 2 ? null : new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    }),
  );
  await film.seek(0);
  film.ready = true;
  if (!RENDER) preview();
};

// ----------------------------------------------------------------------------------------------------- preview

function preview() {
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  const end = film.range().to;
  bar.innerHTML = `<button type="button" data-play>Play</button><input type="range" min="0" max="${end}" step="0.033" value="0"><output>0.0 s</output>
    <span>${film.scenes.map((s, i) => `<button type="button" data-go="${s.start}">${i + 1}</button>`).join('')}</span>`;
  document.body.append(bar);
  const range = bar.querySelector('input');
  const out = bar.querySelector('output');
  let playing = false;
  let last = 0;
  const show = async (t) => {
    await film.seek(t);
    range.value = t;
    out.textContent = `${t.toFixed(1)} s`;
  };
  const tick = async (now) => {
    if (!playing) return;
    const t = Math.min(end, film.tl.time() + (now - last) / 1000);
    last = now;
    await show(t);
    if (t >= end) playing = false;
    requestAnimationFrame(tick);
  };
  const toggle = () => {
    playing = !playing;
    bar.querySelector('[data-play]').textContent = playing ? 'Pause' : 'Play';
    last = performance.now();
    if (playing) requestAnimationFrame(tick);
  };
  bar.querySelector('[data-play]').onclick = toggle;
  range.oninput = () => show(Number(range.value));
  for (const b of bar.querySelectorAll('[data-go]')) b.onclick = () => show(Number(b.dataset.go));
  addEventListener('keydown', (e) => {
    if (e.key === ' ') toggle();
    if (e.key === 'ArrowRight') show(Math.min(end, film.tl.time() + (e.shiftKey ? 5 : 1 / 30)));
    if (e.key === 'ArrowLeft') show(Math.max(0, film.tl.time() - (e.shiftKey ? 5 : 1 / 30)));
  });
  // Fit the 1920×1080 stage in the window.
  const fit = () => {
    const k = Math.min(innerWidth / 1920, (innerHeight - 48) / 1080);
    document.querySelector('.stage').style.transform = `scale(${k})`;
  };
  addEventListener('resize', fit);
  fit();
  const go = new URLSearchParams(location.search).get('t');
  if (go) show(Number(go));
}
