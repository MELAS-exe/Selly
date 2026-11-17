// Against a real PostgreSQL (CI job "postgres"; locally: TEST_DATABASE_URL=postgres://... pnpm test).
// PGlite runs one session, so what needs several connections is checked here: every migration applies, a NOTIFY
// from one pool reaches a LISTEN on another, and two processes never both hold the job lock.

import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from '@selly/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, silentLogger } from './context';
import { PgLeader } from './leader';
import { PgSignals, signal } from './signals';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('on PostgreSQL', () => {
  let a: ReturnType<typeof createDb>;
  let b: ReturnType<typeof createDb>;

  beforeAll(async () => {
    a = createDb(url as string);
    b = createDb(url as string);
    await runMigrations(
      a.db,
      fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
    );
  }, 60_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it('applies every migration', async () => {
    const { rows } = await a.pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema in ('core', 'agent')",
    );
    expect(rows[0]?.n).toBeGreaterThan(20);
  });

  it('delivers a signal sent in a transaction on one pool to a listener on another, on commit', async () => {
    const signals = new PgSignals(a.pool, silentLogger);
    await signals.start();
    const got: string[] = [];
    const off = signals.on('vendor', 'v1', () => got.push('v1'));
    try {
      await (b.db as unknown as Database).transaction(async (tx) => {
        await signal(tx, 'vendor', 'v1');
        await new Promise((r) => setTimeout(r, 200));
        expect(got).toEqual([]); // not before commit
      });
      await expect.poll(() => got, { timeout: 3000 }).toEqual(['v1']);
    } finally {
      off();
      signals.close();
    }
  });

  it('lets one process hold the job lock at a time', async () => {
    const x = new PgLeader(a.pool, silentLogger);
    const y = new PgLeader(b.pool, silentLogger);
    await x.tryLead();
    await y.tryLead();
    expect([x.isLeader(), y.isLeader()]).toEqual([true, false]);
    x.close();
    await expect
      .poll(
        async () => {
          await y.tryLead();
          return y.isLeader();
        },
        { timeout: 5000 },
      )
      .toBe(true);
    y.close();
  });
});
