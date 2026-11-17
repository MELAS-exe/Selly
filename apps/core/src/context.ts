import type { core } from '@selly/db';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Config } from './config';
import type { InvoiceGateway } from './modules/payments/provider';
import type { RateService } from './modules/rates/service';

type Schema = { [K in keyof typeof core]: (typeof core)[K] };

/** Works for node-postgres (production) and PGlite (tests), and for transactions. */
export type Database = PgDatabase<any, Schema>;

export interface Context {
  config: Config;
  db: Database;
  now: () => Date;
  rates: RateService;
  invoices: InvoiceGateway;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Context;
  }
}
