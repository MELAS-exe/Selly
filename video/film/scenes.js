// The ten shots of video/SCRIPT.md. Times are film seconds; the clips are tied to the film through the marks their
// takes recorded (clips/marks.js), so a new capture stays in sync.
/* global gsap, film, kit, MARKS */

const M = window.MARKS;
const SUBS = location.search.includes('subs');
/** The order's amount in sats, as the take's checkout page showed it. */
const SATS = M.customer.sats ?? 55174;
const satsText = SATS.toLocaleString('en-US');
for (const el of document.querySelectorAll('[data-sats]')) el.textContent = satsText;

// ------------------------------------------------------------------------------------------------ 1 · the hook
film.scene('s1', {
  start: 0,
  dur: 12,
  outFor: 0.7,
  build(tl, el, ctx) {
    const A = ctx.at;
    const phone = ctx.$('.hook-phone');
    const notes = ctx.$('.notes');
    const badge = ctx.$('.badge-count');
    gsap.set([ctx.$('.clock-big'), ctx.$('.hook-line')], { autoAlpha: 0 });

    tl.fromTo(
      ctx.$('.clock-big'),
      { autoAlpha: 0, y: 50 },
      { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out' },
      A(0.15),
    );
    tl.fromTo(
      phone,
      { y: 260, rotation: -14, autoAlpha: 0 },
      { y: 0, rotation: -5, autoAlpha: 1, duration: 1.1, ease: 'power3.out' },
      A(0),
    );

    // Notifications pile up, faster and faster.
    const msgs = [
      ['Aïssatou', 'Available?'],
      ['Moussa', 'How much?'],
      ['Khady', 'Do you have it in 42?'],
      ['Cheikh', 'Still open?'],
      ['Binta', 'Delivery to Pikine?'],
      ['Pape', 'Last price please 🙏'],
      ['Mariama', 'Is the red one still there?'],
      ['Ousmane', 'Hello??'],
      ['Rokhaya', 'Available in M?'],
      ['Awa', 'How much with delivery?'],
    ];
    const times = [1.1, 1.8, 2.45, 3.0, 3.45, 3.85, 4.2, 4.5, 4.75, 5.0];
    const made = msgs.map(([who, text], i) => {
      const n = document.createElement('div');
      n.className = 'note';
      n.innerHTML = `<span class="ic">${who[0]}</span><div><b>${who}</b><p>${text}</p></div><small>now</small>`;
      n.style.position = 'absolute';
      n.style.left = '0';
      n.style.right = '0';
      notes.append(n);
      gsap.set(n, { autoAlpha: 0 });
      return n;
    });
    made.forEach((n, i) => {
      const t = A(times[i]);
      for (let k = 0; k < i; k++)
        tl.to(made[k], { y: `+=${92}`, duration: 0.28, ease: 'power2.out' }, t);
      tl.fromTo(
        n,
        { autoAlpha: 0, y: -40, scale: 0.92 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(1.8)' },
        t,
      );
      kit.count(tl, badge, t, i + 1, { from: i, dur: 0.2 });
      ctx.cue('pop', times[i], 0.55);
      if (i % 3 === 0) ctx.cue('buzz', times[i] + 0.05, 0.5);
    });

    // Then they spill out of the phone.
    const spill = ctx.$('.spill');
    const qs = [
      ['Available?', 930, 250],
      ['How much?', 760, 840],
      ['In 42?', 1700, 200],
      ['Still open?', 960, 70],
      ['Price?', 1720, 620],
      ['Delivered?', 420, 975],
      ['Hello??', 1660, 940],
      ['Is it original?', 820, 990],
      ['Can I pay later?', 1240, 1000],
      ['Last price?', 960, 430],
    ];
    qs.forEach(([text, x, y], i) => {
      const q = document.createElement('div');
      q.className = 'q';
      q.textContent = text;
      q.style.left = `${x}px`;
      q.style.top = `${y}px`;
      spill.append(q);
      const t = 5.3 + i * 0.32 - i * i * 0.008;
      gsap.set(q, { autoAlpha: 0 });
      tl.fromTo(
        q,
        { autoAlpha: 0, scale: 0.3, rotation: (i % 2 ? 1 : -1) * 12 },
        {
          autoAlpha: 1,
          scale: 1,
          rotation: (i % 2 ? -1 : 1) * 3,
          duration: 0.4,
          ease: 'back.out(2.4)',
        },
        A(t),
      );
      kit.float(tl, q, A(t + 0.4), A(11.2), { y: 8 + (i % 3) * 4, period: 1.8 + (i % 4) * 0.3 });
      ctx.cue('pop', t, 0.4 + (i % 3) * 0.1);
      kit.count(tl, badge, A(t), 10 + Math.round(((i + 1) * 37) / qs.length), {
        from: 10 + Math.round((i * 37) / qs.length),
        dur: 0.25,
      });
    });
    ctx.cue('buzz', 6.2, 0.6);
    ctx.cue('buzz', 8.1, 0.6);
    tl.to(phone, { rotation: -3, duration: 0.06, repeat: 13, yoyo: true, ease: 'none' }, A(8.1));

    // The mascot peeks in, worried.
    const peek = ctx.$('.peek');
    tl.to(peek, { y: -300, duration: 0.7, ease: 'back.out(1.6)' }, A(5.6));
    ctx.cue('swish', 5.6, 0.5);
    tl.to(peek, { rotation: -8, duration: 0.5, repeat: 5, yoyo: true, ease: 'sine.inOut' }, A(6.3));
    tl.fromTo(
      ctx.$('.sweat'),
      { autoAlpha: 0, y: 0 },
      { autoAlpha: 1, y: 30, duration: 0.9, ease: 'power1.in' },
      A(6.8),
    );
    tl.to(ctx.$('.sweat'), { autoAlpha: 0, duration: 0.3 }, A(7.7));

    tl.fromTo(
      ctx.$('.hook-line'),
      { autoAlpha: 0, y: 40 },
      { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out' },
      A(7.6),
    );
    ctx.cue('whoosh', 11.25, 0.8);
    tl.to(
      el,
      { scale: 1.5, opacity: 0, filter: 'blur(10px)', duration: 0.95, ease: 'power2.in' },
      A(11.3),
    );
  },
});

// ------------------------------------------------------------------------------------------------ 2 · the problem
film.scene('s2', {
  start: 12,
  dur: 16,
  inFor: 0.5,
  outFor: 1.0,
  build(tl, el, ctx) {
    const A = ctx.at;
    tl.fromTo(
      el,
      { clipPath: 'inset(100% 0 0 0)' },
      { clipPath: 'inset(0% 0 0 0)', duration: 0.6, ease: 'power3.out' },
      A(-0.5),
    );
    kit.popIn(tl, ctx.$('.s2-eyebrow'), A(0.3), { from: 1, y: 20 });
    const panels = [
      [ctx.$('.notebook'), 0.7, -4],
      [ctx.$('.transfers'), 4.6, 3],
      [ctx.$('.promises'), 8.6, -3],
    ];
    for (const [p, t, rot] of panels) {
      gsap.set(p, { autoAlpha: 0 });
      kit.drop(tl, p, A(t), { rot, shake: el });
      ctx.cue('thud', t + 0.6, 0.9);
      tl.fromTo(
        p.querySelector('.caption'),
        { autoAlpha: 0, y: 20 },
        { autoAlpha: 1, y: 0, duration: 0.5 },
        A(t + 0.9),
      );
    }
    // The notebook: lines written, crossed out.
    ctx.$$('.notebook .lines p').forEach((p, i) => {
      tl.fromTo(
        p,
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)', duration: 0.5, ease: 'none' },
        A(1.6 + i * 0.45),
      );
      ctx.cue('paper', 1.6 + i * 0.45, 0.35);
    });
    // Payments to check.
    ctx.$$('.mm-row i').forEach((q, i) => {
      kit.popIn(tl, q, A(5.6 + i * 0.4), { from: 0.2, y: 0 });
      ctx.cue('tick', 5.6 + i * 0.4, 0.8);
    });
    const stamp = ctx.$('.stamp-check');
    tl.fromTo(
      stamp,
      { autoAlpha: 0, scale: 2.4 },
      { autoAlpha: 1, scale: 1, duration: 0.25, ease: 'power4.in' },
      A(7.0),
    );
    ctx.cue('stamp', 7.22, 1);
    // Promises.
    ctx.$$('.promises .bubble').forEach((b, i) => {
      kit.popIn(tl, b, A(9.6 + i * 0.9));
      ctx.cue('pop', 9.6 + i * 0.9, 0.6);
    });
    kit.popIn(tl, ctx.$('.seen'), A(11.6), { from: 1, y: 10 });
    // Everything breathes a little while the voice finishes.
    panels.forEach(([p], i) => kit.float(tl, p, A(12.4), A(15.4), { y: 6 + i * 2, period: 2.2 }));
    ctx.cue('riser', 14.4, 0.6);
  },
});

// ------------------------------------------------------------------------------------------------ 3 · selly
film.scene('s3', {
  start: 28,
  dur: 14,
  inFor: 1.0,
  outFor: 0.6,
  build(tl, el, ctx) {
    const A = ctx.at;
    el.style.perspective = '1800px';
    kit.irisIn(tl, el, A(-1.0), { dur: 1.0 });
    ctx.cue('whoosh', -0.9, 0.8);
    const browser = ctx.$('.s3-browser');
    tl.fromTo(
      browser,
      { y: 520, rotationX: 22, scale: 0.86, transformOrigin: '50% 100%' },
      { y: 0, rotationX: 0, scale: 1, duration: 1.4, ease: 'power3.out' },
      A(-0.6),
    );
    film.clip(ctx.$('.s3-browser video'), [
      [A(-0.6), 0],
      [A(13.6), 14.2],
    ]);
    // Room for the three words.
    tl.to(
      browser,
      { y: -40, scale: 0.86, transformOrigin: '50% 0%', duration: 0.9, ease: 'power2.inOut' },
      A(5.4),
    );
    ctx.$$('.trio .chip').forEach((c, i) => {
      gsap.set(c, { autoAlpha: 0 });
      tl.fromTo(
        c,
        { autoAlpha: 0, y: 140, rotation: i === 1 ? 0 : i ? 8 : -8 },
        {
          autoAlpha: 1,
          y: 0,
          rotation: i === 1 ? 0 : i ? 3 : -3,
          duration: 0.6,
          ease: 'back.out(2)',
        },
        A(6.2 + i * 1.6),
      );
      ctx.cue('stamp', 6.35 + i * 1.6, 0.8);
    });
    const mascot = ctx.$('.s3-mascot');
    gsap.set(mascot, { x: 520 });
    kit.walk(tl, mascot, A(10.2), { x0: 520, x1: 0, dur: 1.3, flip: true });
    kit.hop(tl, mascot, A(11.7));
    ctx.cue('pop', 11.8, 0.7);
    // Back to full size for the cut to the dashboard, in the same frame.
    tl.to(
      [ctx.$('.trio'), mascot],
      { autoAlpha: 0, y: 60, duration: 0.5, ease: 'power2.in' },
      A(13.0),
    );
    tl.to(browser, { y: 0, scale: 1, duration: 0.7, ease: 'power2.inOut' }, A(13.0));
  },
});

// ------------------------------------------------------------------------------------------------ 4 · from one photo
film.scene('s4', {
  start: 42,
  dur: 20,
  inFor: 0.6,
  outFor: 0.8,
  build(tl, el, ctx) {
    const A = ctx.at;
    const m = M.photo;
    const base = m.home - 0.7; // clip time at the scene's 0
    const T = (clipTime) => clipTime - base; // a clip moment, in scene time
    tl.fromTo(
      el,
      { clipPath: 'inset(0 0 0 100%)' },
      { clipPath: 'inset(0 0 0 0%)', duration: 0.6, ease: 'power3.inOut' },
      A(-0.6),
    );
    ctx.cue('swish', -0.55, 0.7);
    film.clip(ctx.$('.s4-browser video'), [
      [A(-0.6), base - 0.6],
      [A(22.6 - base), 22.6],
    ]);

    // The photo.
    const tp = T(m.photo);
    tl.fromTo(
      ctx.$('.flash'),
      { opacity: 0 },
      { opacity: 0.85, duration: 0.06, yoyo: true, repeat: 1 },
      A(tp - 0.05),
    );
    ctx.cue('tap', tp - 0.2, 0.8);
    ctx.cue('swish', tp, 0.6);
    const pol = ctx.$('.polaroid');
    tl.fromTo(
      pol,
      { autoAlpha: 0, x: 700, y: 120, rotation: 24 },
      { autoAlpha: 1, x: 0, y: 0, rotation: -5, duration: 0.6, ease: 'power3.out' },
      A(tp),
    );
    tl.to(
      pol,
      { x: 520, y: 520, scale: 0.15, rotation: 8, autoAlpha: 0, duration: 0.6, ease: 'power3.in' },
      A(tp + 1.1),
    );
    ctx.cue('pop', tp + 1.6, 0.5);

    // The sentence, the way she talks.
    kit.typing(ctx, T(m.typing) + 0.3, T(m.sent) - T(m.typing) - 0.7, 0.45);
    ctx.cue('pop', T(m.sent), 0.6);

    // The product builds itself, field by field.
    const td = T(m.draft);
    const browser = ctx.$('.s4-browser');
    tl.to(
      browser,
      { x: -150, scale: 0.8, transformOrigin: '0% 50%', duration: 0.8, ease: 'power3.inOut' },
      A(td - 0.9),
    );
    const card = ctx.$('.product-card');
    tl.fromTo(
      card,
      { autoAlpha: 0, x: 600, rotation: 8 },
      { autoAlpha: 1, x: 0, rotation: 0, duration: 0.7, ease: 'power3.out' },
      A(td - 0.3),
    );
    ctx.cue('whoosh', td - 0.35, 0.6);
    tl.fromTo(
      ctx.$('.pc-photo'),
      { clipPath: 'inset(0 0 100% 0)' },
      { clipPath: 'inset(0 0 0% 0)', duration: 0.5, ease: 'power2.out' },
      A(td + 0.3),
    );
    ctx.$$('.pc-row').forEach((row, i) => {
      gsap.set(row, { autoAlpha: 0 });
      tl.fromTo(
        row,
        { autoAlpha: 0, x: 40 },
        { autoAlpha: 1, x: 0, duration: 0.35, ease: 'power2.out' },
        A(td + 0.8 + i * 0.5),
      );
      ctx.cue('tick', td + 0.8 + i * 0.5, 0.9);
    });
    ctx.$$('.sizes i').forEach((s, i) => {
      kit.popIn(tl, s, A(td + 1.85 + i * 0.09), { from: 0.2, y: 8, dur: 0.3 });
    });
    // One tap: published.
    ctx.cue('tap', T(m.confirm) - 0.15, 0.8);
    const tdone = T(m.done);
    const pub = ctx.$('.published');
    tl.fromTo(
      pub,
      { autoAlpha: 0, scale: 2.2, rotation: 0 },
      { autoAlpha: 1, scale: 1, rotation: 12, duration: 0.25, ease: 'power4.in' },
      A(tdone),
    );
    ctx.cue('stamp', tdone + 0.24, 1);
    ctx.cue('chime', tdone + 0.35, 0.7);
    kit.shake(tl, card, A(tdone + 0.25), 8);
    const mascot = ctx.$('.s4-mascot');
    gsap.set(mascot, { y: 380 });
    tl.to(mascot, { y: 0, duration: 0.5, ease: 'back.out(1.8)' }, A(tdone + 0.6));
    kit.hop(tl, mascot, A(tdone + 1.3), 50);
    ctx.cue('pop', tdone + 0.6, 0.6);
  },
});

// ------------------------------------------------------------------------------------------------ 5 · share
film.scene('s5', {
  start: 62,
  dur: 12,
  inFor: 0.8,
  outFor: 0.8,
  build(tl, el, ctx) {
    const A = ctx.at;
    kit.irisIn(tl, el, A(-0.8), { x: '82%', y: '45%', dur: 0.9 });
    ctx.cue('whoosh', -0.8, 0.7);
    const phone = ctx.$('.share-phone');
    tl.fromTo(
      phone,
      { x: -700, rotation: -10 },
      { x: 0, rotation: 0, duration: 0.9, ease: 'power3.out' },
      A(-0.3),
    );

    const press = (btn, t) => {
      tl.to(btn, { scale: 0.94, duration: 0.08 }, A(t)).to(
        btn,
        { scale: 1, duration: 0.25, ease: 'back.out(3)' },
        A(t + 0.08),
      );
      ctx.cue('tap', t, 0.8);
    };
    press(ctx.$('.share-btn.copy'), 1.3);
    kit.popIn(tl, ctx.$('.toast'), A(1.4), { from: 0.8, y: 20, dur: 0.3 });
    ctx.cue('pop', 1.45, 0.5);
    tl.to(ctx.$('.toast'), { autoAlpha: 0, duration: 0.3 }, A(2.5));
    press(ctx.$('.share-btn.status'), 2.9);
    tl.fromTo(
      ctx.$('.status-view'),
      { autoAlpha: 0, scale: 1.08 },
      { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'power2.out' },
      A(3.1),
    );
    ctx.cue('swish', 3.1, 0.6);
    tl.fromTo(
      ctx.$('.sv-bar i'),
      { width: '0%' },
      { width: '100%', duration: 6, ease: 'none' },
      A(3.3),
    );

    // The link flies to the people who watch her status.
    const fly = ctx.$('.flying-link');
    gsap.set(fly, { x: 330, y: 760 });
    tl.set(fly, { autoAlpha: 1 }, A(4.4));
    tl.fromTo(fly, { scale: 0.4 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, A(4.4));
    tl.to(
      fly,
      {
        keyframes: { x: [330, 720, 1010], y: [760, 360, 250], ease: 'none' },
        duration: 1.0,
        ease: 'power2.inOut',
      },
      A(4.7),
    );
    tl.to(fly, { autoAlpha: 0, scale: 0.6, duration: 0.3 }, A(5.7));
    ctx.cue('whoosh', 4.7, 0.8);
    ctx.$$('.viewer').forEach((v, i) => {
      kit.popIn(tl, v, A(5.5 + i * 0.35), { from: 0.6, y: 20 });
      ctx.cue('tick', 5.5 + i * 0.35, 0.8);
    });
    const fatou = ctx.$('.viewer.fatou');
    tl.to(
      fatou,
      { scale: 1.12, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out' },
      A(6.9),
    );
    ctx.cue('pop', 6.9, 0.7);

    // Fatou opens the shop on her phone.
    const cust = ctx.$('.s5-cust');
    const t0 = A(7.4);
    film.clip(ctx.$('.s5-cust video'), [
      [t0, M.customer.shop - 0.8],
      [A(13), M.customer.shop - 0.8 + (A(13) - t0)],
    ]);
    tl.fromTo(
      cust,
      { x: 700, rotation: 10 },
      { x: 0, rotation: 0, duration: 0.8, ease: 'power3.out' },
      t0,
    );
    ctx.cue('whoosh', 7.4, 0.7);
    tl.to(
      [phone, ctx.$('.viewers')],
      { x: -900, autoAlpha: 0, duration: 0.8, ease: 'power3.in' },
      A(7.6),
    );
    tl.to(cust, { x: -1060, duration: 1.2, ease: 'power3.inOut' }, A(9.2));
  },
});

// The customer's phone, from shot 5 to shot 7: one clock for the clip (film time − offset = clip time).
const CUST = 62 + 7.4 - (M.customer.shop - 0.8);

// ------------------------------------------------------------------------------------------------ 6 · fatou asks
film.scene('s6', {
  start: 74,
  dur: 32,
  inFor: 0.8,
  outFor: 0,
  build(tl, el, ctx) {
    const A = ctx.at;
    const c = M.customer;
    const F = (clipTime) => clipTime + CUST; // a clip moment, in film time
    kit.irisIn(tl, el, A(-0.8), { x: '27%', y: '50%', dur: 0.9 });
    const hold = c.reply2 + 3.0;
    film.clip(ctx.$('.s6-cust video'), [
      [A(-0.8), A(-0.8) - CUST],
      [F(hold), hold],
    ]);
    kit.popIn(tl, ctx.$('.clock-small'), A(0.4), { from: 1, y: 20 });

    // Fatou types; Selly answers. The big lines echo the chat as it lands.
    kit.typing(
      { cue: (n, t, g) => film.cues.push({ t: +t.toFixed(3), name: n, gain: g }) },
      F(c.chat + 1.6),
      c.ask1 - c.chat - 2.0,
      0.4,
    );
    kit.typing(
      { cue: (n, t, g) => film.cues.push({ t: +t.toFixed(3), name: n, gain: g }) },
      F(c.reply1 + 3.2),
      c.ask2 - c.reply1 - 3.5,
      0.4,
    );
    const q1 = ctx.$('.q1');
    const a1 = ctx.$('.a1');
    const q2 = ctx.$('.q2');
    const a2 = ctx.$('.a2');
    gsap.set(q1, { y: 40 });
    gsap.set(a1, { y: 230 });
    gsap.set(q2, { y: 230 });
    gsap.set(a2, { y: 190 });
    const land = (b, t, sound) => {
      tl.fromTo(
        b,
        { autoAlpha: 0, scale: 0.85, transformOrigin: '0% 100%' },
        { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' },
        t,
      );
      film.cues.push({ t: +t.toFixed(3), name: sound, gain: 0.7 });
    };
    land(q1, F(c.ask1), 'pop');
    land(a1, F(c.reply1), 'ding');
    tl.fromTo(
      a1.querySelector('.tag'),
      { scale: 0.6, boxShadow: '0 0 0 0 rgba(138,174,74,.8)' },
      { scale: 1, boxShadow: '0 0 0 18px rgba(138,174,74,0)', duration: 0.9, ease: 'power2.out' },
      F(c.reply1) + 0.4,
    );
    // One exchange on screen at a time: the older lines move up and fade.
    tl.to(q1, { y: -120, autoAlpha: 0, duration: 0.6, ease: 'power2.inOut' }, F(c.ask2) - 0.3);
    tl.to(a1, { y: 0, opacity: 0.4, duration: 0.6, ease: 'power2.inOut' }, F(c.ask2) - 0.3);
    land(q2, F(c.ask2), 'pop');
    tl.to(a1, { y: -150, autoAlpha: 0, duration: 0.6, ease: 'power2.inOut' }, F(c.reply2) - 0.5);
    tl.to(q2, { y: 0, duration: 0.6, ease: 'power2.inOut' }, F(c.reply2) - 0.5);
    land(a2, F(c.reply2), 'ding');
    a2.querySelectorAll('.tag').forEach((tag, i) => {
      tl.fromTo(
        tag,
        { scale: 0.6, boxShadow: '0 0 0 0 rgba(240,194,122,.8)' },
        {
          scale: 1,
          boxShadow: '0 0 0 18px rgba(240,194,122,0)',
          duration: 0.9,
          ease: 'power2.out',
        },
        F(c.reply2) + 0.4 + i * 0.3,
      );
      film.cues.push({ t: +(F(c.reply2) + 0.45 + i * 0.3).toFixed(3), name: 'tick', gain: 0.6 });
    });

    // Meanwhile, Sokhna sleeps.
    const sleep = ctx.$('.asleep');
    const ts = F(hold) - 0.6;
    tl.to(q2, { autoAlpha: 0, duration: 0.5 }, ts - 0.3);
    tl.to(a2, { y: 0, duration: 0.6, ease: 'power2.inOut' }, ts - 0.3);
    tl.fromTo(
      sleep,
      { autoAlpha: 0, y: 40 },
      { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power2.out' },
      ts,
    );
    ctx.$$('.z').forEach((z, i) => {
      for (let k = 0; k < 3; k++) {
        const t = ts + 0.6 + i * 0.5 + k * 1.9;
        tl.fromTo(
          z,
          { autoAlpha: 0, x: 0, y: 0, scale: 0.6 },
          {
            autoAlpha: 1,
            x: 30 + i * 20,
            y: -90 - i * 30,
            scale: 1 + i * 0.25,
            duration: 1.4,
            ease: 'sine.out',
            immediateRender: false,
          },
          t,
        );
        tl.to(z, { autoAlpha: 0, duration: 0.4 }, t + 1.2);
      }
    });
    kit.float(tl, ctx.$('.sleeper'), ts, A(32), { y: 6, period: 2.6 });

    // The phone moves to the middle for the payment.
    tl.to([sleep, a2, ctx.$('.clock-small')], { autoAlpha: 0, duration: 0.6 }, A(30.6));
    tl.to(ctx.$('.s6-cust'), { x: 440, duration: 1.2, ease: 'power3.inOut' }, A(30.6));
    ctx.cue('swish', 30.7, 0.5);
  },
});

// ------------------------------------------------------------------------------------------------ 7 · the payment
film.scene('s7', {
  start: 106,
  dur: 26,
  inFor: 0,
  outFor: 1.5,
  build(tl, el, ctx) {
    const A = ctx.at;
    const c = M.customer;
    const hold = c.reply2 + 3.0;
    // The check mark lands at 1:59, the beat the music stops on.
    const paidAt = 119.0;
    film.clip(ctx.$('.s7-cust video'), [
      [A(0), hold],
      [A(0.6), hold],
      [A(0.6) + (c.approve - 0.6 - hold), c.approve - 0.6],
      [A(8.6), c.approve - 0.6],
      [A(9.25), c.approve + 0.05],
      [A(11.6), c.approve + 0.05],
      [paidAt, c.paid + 0.15],
      [paidAt + 6, c.paid + 6.15],
    ]);
    ctx.cue('tap', 0.6, 0.8);
    ctx.cue('swish', 1.2, 0.5);

    // The amount, in francs and in sats; the countdown.
    const tc = A(0.6) + (c.checkout - hold);
    ctx.$$('.callout').forEach((co, i) => {
      kit.popIn(tl, co, tc + 0.6 + i * 0.6, { from: 0.6, y: 30 });
      film.cues.push({
        t: +(tc + 0.6 + i * 0.6).toFixed(3),
        name: i === 2 ? 'sparkle' : 'pop',
        gain: 0.6,
      });
    });
    for (let k = 0; k < 4; k++)
      film.cues.push({ t: +(tc + 2.6 + k).toFixed(3), name: 'clock', gain: 0.8 });
    tl.to(ctx.$$('.callout'), { autoAlpha: 0, y: -20, duration: 0.4, stagger: 0.08 }, A(8.4));

    // "Open my wallet", then the wallet asks to approve.
    ctx.cue('tap', 9.0, 0.8);
    const sheet = ctx.$('.wallet-sheet');
    gsap.set(sheet, { yPercent: 110 });
    tl.to(sheet, { yPercent: 0, duration: 0.5, ease: 'power3.out' }, A(9.3));
    ctx.cue('swish', 9.3, 0.5);
    const ok = ctx.$('.ws-approve');
    tl.to(ok, { scale: 0.95, duration: 0.08 }, A(10.8)).to(
      ok,
      { scale: 1, duration: 0.2 },
      A(10.88),
    );
    ctx.cue('tap', 10.8, 0.9);
    tl.to(sheet, { yPercent: 110, duration: 0.45, ease: 'power3.in' }, A(11.2));

    // Silence… then paid.
    ctx.cue('chime', paidAt - 106 + 0.02, 1);
    ctx.cue('sparkle', paidAt - 106 + 0.1, 0.8);
    kit.confetti(tl, ctx.$('.confetti'), paidAt + 0.05, { x: 960, y: 470 });
    const word = ctx.$('.paid-word');
    tl.fromTo(
      word,
      { autoAlpha: 0, scale: 0.5, rotation: -6 },
      { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(2.2)' },
      paidAt + 0.5,
    );
    const mascot = ctx.$('.s7-mascot');
    gsap.set(mascot, { y: 520 });
    tl.to(mascot, { y: 0, duration: 0.5, ease: 'back.out(1.7)' }, paidAt + 0.7);
    kit.hop(tl, mascot, paidAt + 1.4, 90);
    kit.hop(tl, mascot, paidAt + 2.3, 60);
    ctx.cue('pop', paidAt - 106 + 0.75, 0.6);
    tl.to([word, mascot], { autoAlpha: 0, duration: 0.6 }, A(24.6));
  },
});

// ------------------------------------------------------------------------------------------------ 8 · the next morning
film.scene('s8', {
  start: 132,
  dur: 20,
  inFor: 1.5,
  outFor: 0.5,
  build(tl, el, ctx) {
    const A = ctx.at;
    const d = M.dashboard;
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 1.5, ease: 'sine.inOut' }, A(-1.5));
    const phone = ctx.$('.wake-phone');
    const note = ctx.$('.selly-note');
    gsap.set(note, { autoAlpha: 0 });
    for (const t of [0.4, 1.3]) {
      ctx.cue('buzz', t, 0.8);
      tl.to(
        phone,
        { x: 6, rotation: 1, duration: 0.05, repeat: 7, yoyo: true, ease: 'none' },
        A(t),
      );
    }
    tl.fromTo(
      note,
      { autoAlpha: 0, y: -80, scale: 0.9 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.8)' },
      A(0.6),
    );
    ctx.cue('ding', 0.65, 0.8);

    // The dashboard: paid, ready to ship; then the wallet.
    tl.to(
      phone,
      {
        x: -560,
        y: 260,
        scale: 0.5,
        rotation: -10,
        autoAlpha: 0,
        duration: 0.9,
        ease: 'power3.in',
      },
      A(3.2),
    );
    const browser = ctx.$('.s8-browser');
    tl.fromTo(browser, { y: 1100 }, { y: 0, duration: 0.9, ease: 'power3.out' }, A(3.4));
    ctx.cue('whoosh', 3.4, 0.7);
    const t0 = A(3.4);
    const c0 = d.home - 0.5;
    const F = (clipTime) => t0 + (clipTime - c0);
    film.clip(ctx.$('.s8-browser video'), [
      [t0, c0],
      [F(18.2), 18.2],
    ]);
    ctx.cue('tap', F(d.orders) - 132 - 0.15, 0.6);
    ctx.cue('tap', F(d.order) - 132 - 0.3, 0.6);
    kit.popIn(tl, ctx.$('.s8-paid'), F(d.order) + 0.5);
    film.cues.push({ t: +(F(d.order) + 0.5).toFixed(3), name: 'pop', gain: 0.7 });
    tl.to(ctx.$('.s8-paid'), { autoAlpha: 0, duration: 0.4 }, F(d.wallet) - 0.6);
    ctx.cue('tap', F(d.wallet) - 132 - 0.3, 0.6);
    const roll = ctx.$('.sats-roll');
    kit.popIn(tl, roll, F(d.wallet) + 0.5, { from: 0.7 });
    kit.count(tl, ctx.$('.sats-roll .n'), F(d.wallet) + 0.7, SATS, { dur: 1.8 });
    for (let k = 0; k < 6; k++)
      film.cues.push({ t: +(F(d.wallet) + 0.75 + k * 0.22).toFixed(3), name: 'tick', gain: 0.5 });
    film.cues.push({ t: +(F(d.wallet) + 2.5).toFixed(3), name: 'coin', gain: 0.9 });
    tl.fromTo(
      ctx.$('.sats-roll em'),
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.5 },
      F(d.wallet) + 2.6,
    );
  },
});

// ------------------------------------------------------------------------------------------------ 9 · why it holds up
film.scene('s9', {
  start: 152,
  dur: 18,
  inFor: 0.5,
  outFor: 0.6,
  build(tl, el, ctx) {
    const A = ctx.at;
    const [c1, c2, c3] = ctx.$$('.card');
    gsap.set([c2, c3], { x: 1920 });
    tl.fromTo(c1, { x: 1920 }, { x: 0, duration: 0.5, ease: 'power3.out' }, A(-0.5));
    ctx.cue('swish', -0.5, 0.7);
    tl.fromTo(
      c1.querySelector('.big'),
      { scale: 1.8, autoAlpha: 0 },
      { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'power4.in' },
      A(0.2),
    );
    ctx.cue('stamp', 0.5, 1);
    tl.fromTo(
      c1.querySelector('.serif'),
      { autoAlpha: 0, y: 30 },
      { autoAlpha: 1, y: 0, duration: 0.6 },
      A(0.8),
    );
    tl.fromTo(
      c1.querySelector('small'),
      { autoAlpha: 0 },
      { autoAlpha: 0.8, duration: 0.6 },
      A(1.8),
    );

    tl.to(c2, { x: 0, duration: 0.5, ease: 'power3.out' }, A(4.0));
    ctx.cue('swish', 4.0, 0.7);
    const coin = c2.querySelector('.coin');
    const coinT = c2.querySelector('.coin-t');
    tl.fromTo(
      c2.querySelector('.arrow'),
      { strokeDasharray: 520, strokeDashoffset: 520 },
      { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' },
      A(4.6),
    );
    tl.to(
      [coin, coinT],
      { attr: { cx: 800, x: 800 }, duration: 1.1, ease: 'power2.inOut' },
      A(5.4),
    );
    tl.to([coin, coinT], { autoAlpha: 0, duration: 0.2 }, A(6.4));
    ctx.cue('coin', 6.4, 0.9);
    tl.fromTo(
      c2.querySelector('.serif'),
      { autoAlpha: 0, y: 30 },
      { autoAlpha: 1, y: 0, duration: 0.6 },
      A(4.7),
    );

    tl.to(c3, { x: 0, duration: 0.5, ease: 'power3.out' }, A(8.2));
    ctx.cue('swish', 8.2, 0.7);
    c3.querySelectorAll('.serif, small').forEach((p, i) => {
      tl.fromTo(
        p,
        { autoAlpha: 0, y: 30 },
        { autoAlpha: 1, y: 0, duration: 0.6 },
        A(8.7 + i * 0.9),
      );
    });

    const browser = ctx.$('.s9-browser');
    tl.fromTo(browser, { y: 1100 }, { y: 0, duration: 0.8, ease: 'power3.out' }, A(12.4));
    ctx.cue('whoosh', 12.4, 0.7);
    film.clip(ctx.$('.s9-browser video'), [
      [A(12.4), M.pricing.pricing - 0.6],
      [A(18.6), M.pricing.guide + 0.8],
    ]);
  },
});

// ------------------------------------------------------------------------------------------------ 10 · the end
film.scene('s10', {
  start: 170,
  dur: 10,
  inFor: 0.6,
  outFor: 0,
  build(tl, el, ctx) {
    const A = ctx.at;
    tl.fromTo(
      el,
      { clipPath: 'inset(100% 0 0 0)' },
      { clipPath: 'inset(0% 0 0 0)', duration: 0.6, ease: 'power3.out' },
      A(-0.6),
    );
    ctx.cue('whoosh', -0.6, 0.6);
    film.clip(ctx.$('.s10-phone video'), [[A(0), M.customer.shop + 0.4]]);
    const phone = ctx.$('.s10-phone');
    tl.to(phone, { y: -160, scale: 0.4, autoAlpha: 0, duration: 1.2, ease: 'power3.in' }, A(1.0));
    const mark = ctx.$('.wordmark');
    tl.fromTo(
      mark,
      { autoAlpha: 0, scale: 1.7 },
      { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'power4.in' },
      A(2.0),
    );
    ctx.cue('stamp', 2.3, 1);
    ctx.$$('.tagline span').forEach((s, i) => {
      kit.popIn(tl, s, A(3.0 + i * 0.75), { from: 0.6, y: 30 });
      ctx.cue('pop', 3.0 + i * 0.75, 0.6);
    });
    tl.fromTo(
      ctx.$('.address'),
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.6 },
      A(5.6),
    );
    ctx.cue('sparkle', 5.6, 0.5);
    const mascot = ctx.$('.s10-mascot');
    kit.walk(tl, mascot, A(4.6), { x0: 0, x1: 500, dur: 1.4 });
    kit.wave(tl, mascot, A(6.4), { times: 6, angle: 8 });
    ctx.cue('pop', 6.4, 0.5);
  },
});

// ------------------------------------------------------------------------------------------------ subtitles
// The voice-over lines (SCRIPT.md), for a version with burned-in subtitles (?subs). Retimed once the voice exists.
const LINES = [
  [0.8, 5.4, 'Available? How much? Do you have it in 42?'],
  [5.8, 11.2, 'For Sokhna, who sells clothes and crafts in Dakar, the day never ends.'],
  [12.8, 19.4, 'She answers the same questions all day long. She counts her stock by hand.'],
  [19.8, 26.4, 'And she chases every payment, one transfer after another.'],
  [28.6, 34.4, 'Selly gives every seller three things: a shop online,'],
  [34.6, 41.0, 'an assistant that sells for her, and payments that land straight in her wallet.'],
  [43.0, 50.2, 'To put something on sale, Sokhna takes a photo and writes the way she talks.'],
  [
    50.6,
    60.0,
    'The assistant builds the product: the price, the sizes, the stock. One tap to confirm.',
  ],
  [
    63.0,
    72.6,
    'Then she shares her link, where her customers already are: her status, her groups.',
  ],
  [76.0, 82.6, 'Fatou has a question. She asks Selly, any time of day.'],
  [
    86.0,
    96.0,
    'The assistant knows the stock live, works out the delivery, and prepares the order.',
  ],
  [100.0, 104.0, 'Sokhna? She’s asleep.'],
  [108.0, 116.0, 'Fatou pays in bitcoin, on the Lightning network. A few seconds.'],
  [119.6, 122.0, 'Paid.'],
  [134.0, 141.0, 'When she wakes up, Sokhna finds the order paid, ready to ship.'],
  [143.0, 150.0, 'And the money is already in her wallet. Not with Selly: with her.'],
  [
    152.5,
    160.0,
    'Selly never touches the sales money and takes no commission. Sellers pay a fixed subscription, in sats.',
  ],
  [
    160.5,
    168.5,
    'And for customers without bitcoin, a guide shows how to get some with Orange Money or Wave.',
  ],
  [173.0, 178.5, 'Your shop. Your assistant. Your money. Selly.'],
];
if (SUBS) {
  const box = document.querySelector('.subs');
  for (const [t0, t1, text] of LINES) {
    const s = document.createElement('span');
    s.textContent = text;
    box.append(s);
    gsap.set(s, { autoAlpha: 0, position: 'absolute', left: '50%', xPercent: -50, bottom: 0 });
    film.tl.set(s, { autoAlpha: 1 }, t0);
    film.tl.set(s, { autoAlpha: 0 }, t1);
  }
}

film.start();
