// The takes of the real app, in the order of the story (video/SCRIPT.md). Each one drives the local app like a
// person would, at a person's pace; engine/capture.mjs records it. `mark` names the moments the film cuts on.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nip19 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { reset } from './reset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = process.env.WEB ?? 'http://localhost:3000';
const WALLET = process.env.TESTWALLET ?? 'http://127.0.0.1:7788';
/** Maison Sokhna's demo key: public on purpose (JUDGES.txt), it opens nothing but the local demo shop. */
const DEMO_NSEC = 'nsec19sqnr30hewl5ha7c65rgf56wluf6tn770h7wc8lt49f2tjx0ey4spllaaq';
/** The landing's sneaker on a plain light background, as a phone photo would be (assets/README.md). */
const SNEAKERS_PHOTO = join(ROOT, 'assets/white-sneakers.jpg');

const DESKTOP = { width: 1440, height: 900, scale: 4 / 3 };
const PHONE = { width: 390, height: 844, scale: 2.5, mobile: true };

/** Signs in as Maison Sokhna through the API and puts the session cookie in the browser. */
async function signIn(context) {
  const post = (path, body, cookie) =>
    fetch(WEB + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB, ...(cookie && { cookie }) },
      body: JSON.stringify(body),
    });
  const c = await (await post('/api/v1/auth/nostr/challenges', { purpose: 'sign_in' })).json();
  const sk = nip19.decode(DEMO_NSEC).data;
  const res = await post('/api/v1/auth/nostr/sessions', {
    challenge_id: c.challenge_id,
    event: finalizeEvent(c.event_template, sk),
    device_label: 'demo video',
  });
  const value = res.headers.get('set-cookie')?.match(/selly_session=([^;]+)/)?.[1];
  if (!value) throw new Error(`sign-in failed: HTTP ${res.status}`);
  await context.addCookies([
    {
      name: 'selly_session',
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

const wait = (page, ms) => page.waitForTimeout(ms);

/** Moves the mouse to an element along a curve, at a hand's pace, then clicks it. */
async function point(page, locator, { click = true, settle = 250 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`not visible: ${locator}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 28 });
  await wait(page, settle);
  if (click) await page.mouse.click(x, y, { delay: 90 });
}

/** A finger tap on a phone. */
async function tap(page, locator, settle = 300) {
  await locator.scrollIntoViewIfNeeded();
  await wait(page, settle);
  const box = await locator.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Types like a person: a little uneven, slower on spaces. */
async function type(page, text, base = 55) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await wait(page, base + (ch === ' ' ? 60 : 0) + ((ch.charCodeAt(0) * 37) % 40));
  }
}

/** Scrolls smoothly by `dy` pixels over `ms`. */
async function glide(page, dy, ms = 1400) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((r) => {
        const y0 = scrollY;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          scrollTo(0, y0 + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
          if (k < 1) requestAnimationFrame(step);
          else r();
        };
        requestAnimationFrame(step);
      }),
    [dy, ms],
  );
}

export const takes = {
  /** Shot 3: the home page, its title rolling in, the cursor rolling it over to green. */
  landing: {
    viewport: DESKTOP,
    // The home page draws its own cursor.
    pointer: false,
    async run(page, { mark }) {
      await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
      mark('loaded');
      await page.mouse.move(1300, 820);
      await wait(page, 2600);
      const lines = page.locator('h1 .hero-line, h1 > span, h1').first();
      const box = await lines.boundingBox();
      if (box) {
        mark('hover');
        await page.mouse.move(box.x + 40, box.y + box.height * 0.3, { steps: 30 });
        await page.mouse.move(box.x + box.width - 40, box.y + box.height * 0.35, { steps: 90 });
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.75, { steps: 60 });
      }
      await wait(page, 1600);
      mark('scroll');
      await glide(page, 900, 2200);
      await wait(page, 1500);
    },
  },

  /** Shot 4: Sokhna adds the white sneakers from a photo and a sentence, then confirms. */
  photo: {
    viewport: DESKTOP,
    async setup(page, context) {
      console.log(`  reset: ${reset().split('\n').at(-1)}`);
      await signIn(context);
    },
    async run(page, { mark }) {
      await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
      await page.mouse.move(900, 600);
      await wait(page, 1200);
      mark('home');
      const chooser = page.waitForEvent('filechooser');
      await point(page, page.getByRole('button', { name: 'Add from a photo' }).first());
      (await chooser).setFiles(SNEAKERS_PHOTO);
      mark('photo');
      const box = page.getByLabel('Your message to Selly');
      await box.waitFor();
      await wait(page, 900);
      await point(page, box);
      mark('typing');
      await type(page, 'White sneakers, 20,000. Sizes 40 to 44, two pairs each.');
      await wait(page, 400);
      await point(
        page,
        page.locator('.selly-panel button[type="submit"], form button[type="submit"]').last(),
      );
      mark('sent');
      await page.getByText('Shall I publish it?').waitFor({ timeout: 30_000 });
      mark('draft');
      await wait(page, 2200);
      await point(page, page.getByRole('button', { name: 'Confirm', exact: true }));
      mark('confirm');
      await page.getByText('Done! The white sneakers').waitFor({ timeout: 30_000 });
      mark('done');
      await wait(page, 2400);
    },
  },

  /** Shots 5 to 7: Fatou opens the shop on her phone, asks Selly, gets her order and pays it. */
  customer: {
    viewport: PHONE,
    tail: 2500,
    async run(page, { mark, note }) {
      await page.goto(`${WEB}/s/maison-sokhna`, { waitUntil: 'networkidle' });
      await wait(page, 1500);
      mark('shop');
      await glide(page, 520, 1600);
      await wait(page, 700);
      const card = page.getByRole('link', { name: /White sneakers/ }).first();
      await card.scrollIntoViewIfNeeded();
      await wait(page, 900);
      await tap(page, card);
      await page.waitForURL(/\/p\//);
      await page.waitForLoadState('networkidle');
      mark('product');
      await wait(page, 1800);
      await tap(page, page.getByRole('button', { name: 'Ask Selly a question' }));
      const input = page.locator('textarea').last();
      await input.waitFor();
      await page.getByText('A question about this item?').waitFor({ timeout: 15_000 });
      mark('chat');
      await wait(page, 1400);
      await tap(page, input);
      await type(page, 'Nanga def! Do you have these in 42?', 65);
      await wait(page, 300);
      await tap(page, page.getByRole('button', { name: 'Send' }), 150);
      mark('ask1');
      await page.getByText('Mangi fi').waitFor({ timeout: 20_000 });
      mark('reply1');
      await wait(page, 3000);
      await tap(page, input);
      await type(page, 'Delivered to Mermoz, how much?', 65);
      await wait(page, 300);
      await tap(page, page.getByRole('button', { name: 'Send' }), 150);
      mark('ask2');
      await page.getByText('Your order is ready').waitFor({ timeout: 20_000 });
      mark('reply2');
      await wait(page, 3200);
      await tap(page, page.getByText('Pay for the order →'));
      await page.waitForURL(/\/c\//);
      await page.getByText('Open my wallet').waitFor();
      mark('checkout');
      const sats = (await page.locator('body').innerText()).match(/that is ([\d,]+) sats/)?.[1];
      if (sats) note('sats', Number(sats.replaceAll(',', '')));
      await wait(page, 4000);
      // The wallet is the fake one: the tap shows, the fake wallet pays the invoice.
      const uri = await page.getByText('Open my wallet').evaluate((a) => {
        a.addEventListener('click', (e) => e.preventDefault(), { once: true });
        return a.closest('a').href;
      });
      await tap(page, page.getByText('Open my wallet'));
      mark('approve');
      // Back to the top, where the QR turns into the check mark.
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
      await wait(page, 1300);
      const paid = await fetch(`${WALLET}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: uri.replace(/^lightning:/i, '') }),
      });
      if (!paid.ok) throw new Error(`pay: HTTP ${paid.status} ${await paid.text()}`);
      mark('pay');
      await page.getByText('Payment received.').first().waitFor({ timeout: 20_000 });
      mark('paid');
      await wait(page, 3500);
    },
  },

  /** Shot 8: the order is paid, ready to ship; the money is in Sokhna's wallet. */
  dashboard: {
    viewport: DESKTOP,
    async setup(page, context) {
      await signIn(context);
    },
    async run(page, { mark }) {
      await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
      await page.mouse.move(1000, 500);
      await wait(page, 2000);
      mark('home');
      await point(page, page.getByRole('link', { name: 'Orders' }).first());
      await page.waitForURL(/commandes/);
      await page.waitForLoadState('networkidle');
      mark('orders');
      await wait(page, 1800);
      await point(page, page.getByText('White sneakers').first());
      await page.waitForLoadState('networkidle');
      mark('order');
      await wait(page, 3000);
      await point(page, page.getByRole('link', { name: 'Wallet' }).first());
      await page.waitForURL(/portefeuille/);
      await page.waitForLoadState('networkidle');
      mark('wallet');
      await wait(page, 4000);
    },
  },

  /** Shot 9: the pricing page and the guide for customers without bitcoin. */
  pricing: {
    viewport: DESKTOP,
    async run(page, { mark }) {
      await page.goto(`${WEB}/tarifs`, { waitUntil: 'networkidle' });
      await page.mouse.move(1200, 700);
      await wait(page, 1500);
      mark('pricing');
      await glide(page, 600, 2000);
      await wait(page, 1500);
      await page.goto(`${WEB}/aide/payer-en-bitcoin`, { waitUntil: 'networkidle' });
      mark('guide');
      await wait(page, 1200);
      await glide(page, 700, 2400);
      await wait(page, 1200);
    },
  },
};

export const sneakersPhoto = () => readFileSync(SNEAKERS_PHOTO);
