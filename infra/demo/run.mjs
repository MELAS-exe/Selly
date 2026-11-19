// The demo service of docker-compose.yml: the fake Lightning wallets, and Maison Sokhna (apps/core/scripts/demo-shop.mts)
// made once on an empty database. Local demo only, never in production.
//
// 1. Forwards localhost:9000 to the storage service: core signs upload URLs for http://localhost:9000, the address a
//    browser reaches, and the signature covers that host, so the seed script must send its photos there too.
// 2. Runs the fake wallets (pnpm dev:testwallet) for as long as the container lives: `docker compose exec demo pnpm
//    testwallet pay` pays the newest invoice.
// 3. Links the platform wallet (subscriptions), then makes the demo shop, in English when DEMO_LANG=en.
// 4. Writes READY, which the healthcheck waits for before the web app starts.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';

const STATE = '/state';
const READY = '/tmp/selly-demo-ready';
const CORE = process.env.CORE ?? 'http://core:4000';
const SLUG = 'maison-sokhna';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(READY, { force: true });

createServer((client) => {
  const upstream = connect(9000, 'storage');
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
}).listen(9000, '127.0.0.1');

const run = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: 'inherit' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command}: exit ${code}`)),
    );
  });

const wallets = spawn('pnpm dev:testwallet', { shell: true, stdio: 'inherit' });
wallets.on('exit', (code) => {
  console.error(`demo: the fake wallets stopped (exit ${code})`);
  process.exit(1);
});
for (let i = 0; ; i++) {
  if (
    await fetch('http://127.0.0.1:7788/uris').then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  if (i === 120) throw new Error('demo: the fake wallets did not start');
  await sleep(1000);
}

// A marker per step, in the same volume as the wallet keys: `docker compose down -v` wipes them with the database.
const done = (step) => `${STATE}/${step}.done`;

if (!existsSync(done('platform'))) {
  await run('pnpm testwallet link --platform');
  writeFileSync(done('platform'), '');
}

const store = await fetch(`${CORE}/api/v1/stores/${SLUG}`);
if (store.status === 404) {
  rmSync(done('shop'), { force: true });
  console.log('demo: making Maison Sokhna (two or three minutes)');
  await run('pnpm --filter @selly/core exec tsx scripts/demo-shop.mts');
  if (process.env.DEMO_LANG === 'en')
    await run('pnpm --filter @selly/core exec tsx scripts/demo-shop-en.mts');
  writeFileSync(done('shop'), '');
} else if (!existsSync(done('shop'))) {
  throw new Error(
    'demo: Maison Sokhna was left half made by an earlier run. Start over from an empty database: ' +
      'docker compose down -v, then docker compose up --build',
  );
}

writeFileSync(READY, '');
console.log(`demo: ready on http://localhost:3000/s/${SLUG}
  pay the newest invoice:  docker compose exec demo pnpm testwallet pay`);
