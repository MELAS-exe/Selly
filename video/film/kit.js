// Reusable moves for the scenes: each one adds tweens to the film's timeline at a given film time and cues its
// sound. Times are film seconds (ctx.at(local) in a scene).
/* global gsap, film */

const kit = {
  /** Pops an element in: from small and low, with a little overshoot. */
  popIn(tl, el, t, { from = 0.4, y = 30, dur = 0.55, ease = 'back.out(2.2)' } = {}) {
    tl.fromTo(
      el,
      { autoAlpha: 0, scale: from, y },
      { autoAlpha: 1, scale: 1, y: 0, duration: dur, ease },
      t,
    );
  },

  /** Drops a panel from above; it lands with a squash and shakes the stage. */
  drop(tl, el, t, { rot = -4, shake = null } = {}) {
    tl.fromTo(
      el,
      { y: -1100, rotation: rot * 3, autoAlpha: 1 },
      { y: 0, rotation: rot, duration: 0.62, ease: 'power3.in' },
      t,
    );
    tl.to(
      el,
      {
        scaleY: 0.94,
        scaleX: 1.03,
        transformOrigin: '50% 100%',
        duration: 0.08,
        ease: 'power1.out',
      },
      t + 0.62,
    );
    tl.to(el, { scaleY: 1, scaleX: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, t + 0.7);
    if (shake) kit.shake(tl, shake, t + 0.62);
  },

  /** A short camera shake. */
  shake(tl, el, t, strength = 14) {
    tl.to(el, { x: strength, y: -strength / 2, duration: 0.05, ease: 'none' }, t)
      .to(el, { x: -strength * 0.7, y: strength / 3, duration: 0.06, ease: 'none' }, t + 0.05)
      .to(el, { x: strength * 0.35, y: 0, duration: 0.07, ease: 'none' }, t + 0.11)
      .to(el, { x: 0, y: 0, duration: 0.12, ease: 'power2.out' }, t + 0.18);
  },

  /** The mascot walks from x0 to x1 (px), bobbing a step every `step` seconds. */
  walk(tl, el, t, { x0, x1, dur = 1.6, step = 0.22, flip = false }) {
    if (flip) tl.set(el.querySelector('img'), { scaleX: -1 }, t);
    tl.fromTo(el, { x: x0 }, { x: x1, duration: dur, ease: 'power1.inOut' }, t);
    const steps = Math.floor(dur / step);
    for (let i = 0; i < steps; i++) {
      tl.to(
        el,
        { y: -18, rotation: i % 2 ? 4 : -4, duration: step / 2, ease: 'sine.out' },
        t + i * step,
      );
      tl.to(el, { y: 0, duration: step / 2, ease: 'sine.in' }, t + i * step + step / 2);
    }
    tl.to(el, { rotation: 0, duration: 0.2 }, t + dur);
    if (flip) tl.set(el.querySelector('img'), { scaleX: 1 }, t + dur + 0.05);
  },

  /** A happy hop on the spot. */
  hop(tl, el, t, h = 70) {
    tl.to(el, { scaleY: 0.85, scaleX: 1.08, duration: 0.12, ease: 'power2.out' }, t)
      .to(el, { y: -h, scaleY: 1.08, scaleX: 0.95, duration: 0.28, ease: 'power2.out' }, t + 0.12)
      .to(el, { y: 0, scaleY: 1, scaleX: 1, duration: 0.3, ease: 'bounce.out' }, t + 0.4);
  },

  /** Waves: the whole bag rocks on its feet. */
  wave(tl, el, t, { times = 4, angle = 9 } = {}) {
    for (let i = 0; i < times; i++)
      tl.to(
        el,
        { rotation: i % 2 ? -angle : angle, duration: 0.24, ease: 'sine.inOut' },
        t + i * 0.24,
      );
    tl.to(el, { rotation: 0, duration: 0.3, ease: 'sine.out' }, t + times * 0.24);
  },

  /** Keeps an element gently floating between t0 and t1. */
  float(tl, el, t0, t1, { y = 10, period = 2.4 } = {}) {
    for (let t = t0, i = 0; t < t1; t += period / 2, i++)
      tl.to(el, { y: i % 2 ? 0 : -y, duration: period / 2, ease: 'sine.inOut' }, t);
  },

  /** Key clicks while someone types, `n` of them over `dur` seconds, a little uneven. */
  typing(ctx, local, dur, gain = 0.5) {
    const n = Math.round(dur / 0.11);
    for (let i = 0; i < n; i++)
      ctx.cue(
        'key',
        local + (i * dur) / n + ((i * 37) % 7) * 0.008,
        gain * (0.7 + ((i * 13) % 5) * 0.08),
      );
  },

  /** Confetti from a point, as plain divs (seeded, so every render is the same). */
  confetti(
    tl,
    box,
    t,
    {
      x = 960,
      y = 520,
      n = 90,
      colors = ['#8aae4a', '#a3c651', '#e3342f', '#173b32', '#f0c27a'],
    } = {},
  ) {
    let s = 7;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.background = colors[i % colors.length];
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      box.append(p);
      const a = r() * Math.PI * 2;
      const v = 380 + r() * 620;
      const dx = Math.cos(a) * v;
      const dy = Math.sin(a) * v * 0.75 - 260;
      gsap.set(p, { autoAlpha: 0 });
      tl.set(p, { autoAlpha: 1, x: 0, y: 0, rotation: 0, scale: 0.6 + r() * 0.8 }, t);
      tl.to(p, { x: dx, duration: 2.4, ease: 'power2.out' }, t);
      tl.to(p, { y: dy, duration: 0.9, ease: 'power2.out' }, t);
      tl.to(p, { y: dy + 700 + r() * 300, duration: 1.8, ease: 'power1.in' }, t + 0.9);
      tl.to(p, { rotation: (r() - 0.5) * 1440, duration: 2.7, ease: 'none' }, t);
      tl.to(p, { autoAlpha: 0, duration: 0.5 }, t + 2.2 + r() * 0.4);
    }
  },

  /** Counts a number up inside `el` (thousands with commas). */
  count(tl, el, t, to, { dur = 1.4, from = 0 } = {}) {
    const o = { v: from };
    tl.fromTo(
      o,
      { v: from },
      {
        v: to,
        duration: dur,
        ease: 'power3.out',
        onUpdate: () => (el.textContent = Math.round(o.v).toLocaleString('en-US')),
      },
      t,
    );
  },

  /** A clip-path circle wipe that reveals `el` from a point. */
  irisIn(tl, el, t, { x = '50%', y = '50%', dur = 1.0 } = {}) {
    tl.fromTo(
      el,
      { clipPath: `circle(0% at ${x} ${y})` },
      { clipPath: `circle(150% at ${x} ${y})`, duration: dur, ease: 'power3.inOut' },
      t,
    );
  },
};
window.kit = kit;
