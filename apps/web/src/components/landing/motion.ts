// The landing page's motion, with GSAP: text that turns in on its X axis (never a plain fade), the hero titles that
// roll over to their light green copy under the cursor, the toolkit rows built piece by piece, and the dark Selly
// section that keeps moving. Under reduced motion nothing moves in: text is there, hovers swap without turning.

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode) =>
  Array.from(root.querySelectorAll<T>(sel));

/** Characters turn around an axis set behind the text, like the faces of a drum (depth relative to the font). */
const drum = (el: Element, depth = 0.45) =>
  `50% 50% ${-Math.round(Number.parseFloat(getComputedStyle(el).fontSize) * depth)}px`;

/** Animations started once, when their element is well into view. */
const onView = (trigger: Element, start = 'top 86%'): ScrollTrigger.Vars => ({
  trigger,
  start,
  once: true,
});

/** The longest the page waits for its web fonts before animating anyway. */
const FONT_WAIT_MS = 1500;

/** Builds every animation of the page under `root`; the returned function undoes them all. */
export function landingMotion(root: HTMLElement): () => void {
  const mm = gsap.matchMedia(root);
  let alive = true;
  // Split once the fonts are in, so lines break where they finally will; but wait no more than FONT_WAIT_MS. A font
  // request that hangs (a slow or filtering network) would otherwise hold every animation back for good: the hero
  // would only appear, still, when .split-wait gives up at 4 s.
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, FONT_WAIT_MS))]).then(() => {
    if (!alive) return;
    mm.add(
      {
        motion: '(prefers-reduced-motion: no-preference)',
        calm: '(prefers-reduced-motion: reduce)',
      },
      (ctx) => {
        const motion = Boolean(ctx.conditions?.motion);
        const undo = [hero(root, motion)];
        if (motion) {
          texts(root);
          toolkit(root);
          undo.push(meet(root));
          gallery(root);
        }
        for (const el of $('.split-wait', root)) el.classList.remove('split-wait');
        return () => {
          for (const u of undo) u();
        };
      },
    );
  });
  return () => {
    alive = false;
    mm.revert();
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Hero                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

function hero(root: HTMLElement, motion: boolean): () => void {
  const tl = gsap.timeline({ delay: 0.15 });
  const off: (() => void)[] = [];

  $('.flip-line', root).forEach((line, i) => {
    const [face, alt] = $('.flip-face', line);
    if (!face || !alt) return;
    const a = SplitText.create(face, { type: 'words,chars', charsClass: 'char' }).chars;
    const b = SplitText.create(alt, { type: 'words,chars', charsClass: 'char' }).chars;
    const origin = drum(line);
    gsap.set([...a, ...b], { transformOrigin: origin, transformPerspective: 900 });
    gsap.set(b, motion ? { rotateX: -90 } : { opacity: 0 });
    gsap.set(alt, { visibility: 'visible' });

    // In: each line turns up from below, letter after letter; slow enough to read as a sequence.
    // A cursor already on the line when it has arrived rolls it right away.
    let ready = !motion;
    let sync = () => {};
    if (motion)
      tl.from(
        a,
        {
          rotateX: -95,
          yPercent: 40,
          duration: 1.8,
          ease: 'expo.out',
          stagger: 0.045,
          onComplete: () => {
            ready = true;
            sync();
          },
        },
        0.2 + i * 0.32,
      );

    // Hover: the line rolls over to its light green copy. A roll always plays to its end; then, if the cursor has
    // left by now (or come back), the line rolls to match.
    let hovered = false;
    let green = false;
    let rolling = false;
    sync = () => {
      if (!ready || rolling || hovered === green) return;
      const on = hovered;
      if (!motion) {
        gsap.set(a, { opacity: on ? 0 : 1 });
        gsap.set(b, { opacity: on ? 1 : 0 });
        green = on;
        return;
      }
      rolling = true;
      const v = { duration: 0.7, ease: 'power3.inOut', stagger: 0.022 };
      gsap.to(a, { rotateX: on ? 90 : 0, ...v });
      gsap.to(b, {
        rotateX: on ? 0 : -90,
        ...v,
        onComplete: () => {
          rolling = false;
          green = on;
          sync();
        },
      });
    };
    const enter = () => {
      hovered = true;
      sync();
    };
    const leave = () => {
      hovered = false;
      sync();
    };
    line.addEventListener('pointerenter', enter);
    line.addEventListener('pointerleave', leave);
    off.push(() => {
      line.removeEventListener('pointerenter', enter);
      line.removeEventListener('pointerleave', leave);
    });
  });

  if (motion) {
    const circle = root.querySelector('.hero-circle-in');
    if (circle) tl.from(circle, { scale: 0.3, rotate: -200, duration: 2, ease: 'expo.out' }, 0);
    const lede = root.querySelector('.hero-lede');
    if (lede) {
      const lines = SplitText.create(lede, { type: 'lines', mask: 'lines' });
      tl.from(
        lines.lines,
        {
          yPercent: 110,
          rotateX: -60,
          transformPerspective: 700,
          transformOrigin: '50% 0%',
          duration: 1.5,
          ease: 'expo.out',
          stagger: 0.14,
          onComplete: () => lines.revert(),
        },
        1.1,
      );
    }
    const rule = root.querySelector('.hero-rule');
    if (rule)
      tl.from(
        rule,
        { scaleY: 0, transformOrigin: '50% 0%', duration: 1.4, ease: 'expo.inOut' },
        1.5,
      );
    const cta = root.querySelector('.hero-cta-text');
    if (cta) {
      const chars = SplitText.create(cta, { type: 'chars' }).chars;
      tl.from(
        chars,
        {
          rotateX: -90,
          transformOrigin: drum(cta),
          transformPerspective: 600,
          duration: 1.2,
          ease: 'expo.out',
          stagger: 0.03,
        },
        2.2,
      );
    }
  }
  return () => {
    for (const o of off) o();
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Text across the page: data-anim="chars" | "words" | "lines" | "rule" | "lit"                     */
/* ------------------------------------------------------------------------------------------------ */

function texts(root: HTMLElement) {
  for (const el of $('[data-anim]', root)) {
    const kind = el.dataset.anim;
    const scrollTrigger = onView(el);
    if (kind === 'rule') {
      gsap.from(el, {
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 1.4,
        ease: 'expo.inOut',
        scrollTrigger,
      });
    } else if (kind === 'lit') {
      // The quote: words turn up one by one; the scroll then lights them in reading order (landing.css).
      gsap.from($('.lit', el), {
        rotateX: -90,
        yPercent: 50,
        transformOrigin: drum(el, 0.35),
        transformPerspective: 800,
        duration: 1.6,
        ease: 'expo.out',
        stagger: 0.05,
        scrollTrigger,
      });
    } else if (kind === 'chars') {
      const split = SplitText.create(el, { type: 'words,chars' });
      gsap.from(split.chars, {
        rotateX: -90,
        transformOrigin: drum(el),
        transformPerspective: 600,
        duration: 1.3,
        ease: 'expo.out',
        stagger: 0.028,
        scrollTrigger,
        onComplete: () => split.revert(),
      });
    } else if (kind === 'words') {
      const split = SplitText.create(el, { type: 'words', mask: 'words' });
      gsap.from(split.words, {
        yPercent: 115,
        rotateX: -75,
        rotate: 4,
        transformOrigin: '0% 0%',
        transformPerspective: 900,
        duration: 1.7,
        ease: 'expo.out',
        stagger: 0.08,
        scrollTrigger,
        onComplete: () => split.revert(),
      });
    } else if (kind === 'lines') {
      const split = SplitText.create(el, { type: 'lines', mask: 'lines' });
      gsap.from(split.lines, {
        yPercent: 110,
        rotateX: -55,
        transformOrigin: '50% 0%',
        transformPerspective: 700,
        duration: 1.5,
        ease: 'expo.out',
        stagger: 0.13,
        scrollTrigger,
        onComplete: () => split.revert(),
      });
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* "Everything to sell": each row is built in turn, its picture swinging in on a hinge              */
/* ------------------------------------------------------------------------------------------------ */

function toolkit(root: HTMLElement) {
  for (const row of $('[data-kit-row]', root)) {
    const num = row.querySelector<HTMLElement>('.kit-num');
    const media = row.querySelector<HTMLElement>('.kit-media');
    const img = media?.querySelector('img');
    const title = row.querySelector<HTMLElement>('.kit-title');
    const sub = row.querySelector<HTMLElement>('.kit-sub');
    const text = row.querySelector<HTMLElement>('.kit-text');
    const tl = gsap.timeline({ scrollTrigger: onView(row, 'top 84%') });

    if (media)
      tl.from(
        media,
        {
          rotateY: -80,
          rotateZ: -7,
          scale: 0.72,
          transformOrigin: '0% 50%',
          transformPerspective: 900,
          duration: 2,
          ease: 'expo.out',
        },
        0,
      );
    if (img) tl.from(img, { scale: 1.7, rotate: 9, duration: 2.2, ease: 'expo.out' }, 0);
    if (num) {
      const end = Number(num.textContent);
      const n = { v: 0 };
      tl.to(
        n,
        {
          v: end,
          duration: 1.4,
          ease: 'power2.out',
          onUpdate: () => {
            num.textContent = String(Math.round(n.v)).padStart(2, '0');
          },
        },
        0.1,
      );
    }
    if (title) {
      const split = SplitText.create(title, { type: 'words,chars' });
      tl.from(
        split.chars,
        {
          rotateX: -95,
          yPercent: 30,
          transformOrigin: drum(title),
          transformPerspective: 700,
          duration: 1.5,
          ease: 'expo.out',
          stagger: 0.035,
          onComplete: () => split.revert(),
        },
        0.25,
      );
    }
    if (sub) {
      const split = SplitText.create(sub, { type: 'chars' });
      tl.from(
        split.chars,
        {
          yPercent: 120,
          rotate: 25,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.015,
          onComplete: () => split.revert(),
        },
        0.55,
      );
    }
    if (text) {
      const split = SplitText.create(text, { type: 'lines', mask: 'lines' });
      tl.from(
        split.lines,
        {
          yPercent: 110,
          rotateX: -55,
          transformOrigin: '50% 0%',
          transformPerspective: 700,
          duration: 1.5,
          ease: 'expo.out',
          stagger: 0.12,
          onComplete: () => split.revert(),
        },
        0.7,
      );
    }
    // While the row crosses the screen, its picture keeps drifting: a slow lean and a few pixels of depth.
    if (media)
      gsap.fromTo(
        media,
        { y: 18 },
        {
          y: -18,
          ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* "Meet Selly": the giant name sliding behind, the panel opening, Selly bouncing in and floating    */
/* ------------------------------------------------------------------------------------------------ */

function meet(root: HTMLElement): () => void {
  const section = root.querySelector<HTMLElement>('[data-meet]');
  if (!section) return () => {};
  const ghost = section.querySelectorAll('.meet-ghost-track');
  gsap.fromTo(
    ghost[0] ?? [],
    { xPercent: 0 },
    {
      xPercent: -40,
      ease: 'none',
      scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
    },
  );
  gsap.fromTo(
    ghost[1] ?? [],
    { xPercent: -40 },
    {
      xPercent: 0,
      ease: 'none',
      scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
    },
  );

  const panel = section.querySelector<HTMLElement>('.meet-panel');
  const tilt = section.querySelector<HTMLElement>('.meet-tilt');
  const float = section.querySelector<HTMLElement>('.meet-float');
  const mascot = section.querySelector<HTMLElement>('.meet-mascot');
  const sparks = $('.meet-spark', section);
  const tl = gsap.timeline({ scrollTrigger: onView(section, 'top 70%') });
  if (panel)
    tl.fromTo(
      panel,
      { clipPath: 'circle(0% at 50% 60%)' },
      { clipPath: 'circle(120% at 50% 60%)', duration: 1.6, ease: 'expo.inOut' },
      0,
    );
  if (mascot)
    tl.from(
      mascot,
      { y: 220, rotate: -22, scale: 0.4, duration: 1.6, ease: 'back.out(1.5)' },
      0.55,
    );
  if (sparks.length)
    tl.from(
      sparks,
      { scale: 0, rotate: -180, duration: 1, ease: 'back.out(2)', stagger: 0.15 },
      1.1,
    );

  // Then it never quite stands still: Selly floats, the sparks twinkle.
  if (float)
    gsap.to(float, {
      y: -18,
      rotate: 2.5,
      duration: 2.6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  sparks.forEach((s, i) =>
    gsap.to(s, {
      scale: 1.35,
      rotate: 90,
      duration: 1.4 + i * 0.3,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: 2 + i * 0.4,
    }),
  );

  // And it leans towards the cursor.
  if (!panel || !tilt) return () => {};
  gsap.set(tilt, { transformPerspective: 1000 });
  const rx = gsap.quickTo(tilt, 'rotateX', { duration: 0.8, ease: 'power3' });
  const ry = gsap.quickTo(tilt, 'rotateY', { duration: 0.8, ease: 'power3' });
  const tx = gsap.quickTo(tilt, 'x', { duration: 0.8, ease: 'power3' });
  const move = (e: PointerEvent) => {
    const b = panel.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5;
    const y = (e.clientY - b.top) / b.height - 0.5;
    ry(x * 22);
    rx(-y * 16);
    tx(x * 30);
  };
  const reset = () => {
    rx(0);
    ry(0);
    tx(0);
  };
  panel.addEventListener('pointermove', move);
  panel.addEventListener('pointerleave', reset);
  return () => {
    panel.removeEventListener('pointermove', move);
    panel.removeEventListener('pointerleave', reset);
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Gallery: photos open from their centre, then drift against the scroll (the colour lens: cursor)  */
/* ------------------------------------------------------------------------------------------------ */

function gallery(root: HTMLElement) {
  for (const tile of $('.gal-tile', root)) {
    gsap.fromTo(
      tile,
      { clipPath: 'inset(18% 14% 18% 14%)' },
      {
        clipPath: 'inset(0% 0% 0% 0%)',
        duration: 1.8,
        ease: 'expo.out',
        scrollTrigger: onView(tile),
      },
    );
    const par = tile.querySelector('.gal-par');
    if (par)
      gsap.fromTo(
        par,
        { yPercent: -5 },
        {
          yPercent: 5,
          ease: 'none',
          scrollTrigger: { trigger: tile, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
  }
  const card = root.querySelector<HTMLElement>('.gal-card');
  const title = card?.querySelector<HTMLElement>('h3');
  if (card) {
    const tl = gsap.timeline({ scrollTrigger: onView(card, 'top 92%') });
    tl.fromTo(
      card,
      { clipPath: 'inset(0% 100% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, ease: 'expo.inOut' },
      0.3,
    );
    if (title) {
      const split = SplitText.create(title, { type: 'words,chars' });
      tl.from(
        split.chars,
        {
          rotateX: -95,
          transformOrigin: drum(title),
          transformPerspective: 700,
          duration: 1.4,
          ease: 'expo.out',
          stagger: 0.03,
          onComplete: () => split.revert(),
        },
        0.8,
      );
    }
  }
}
