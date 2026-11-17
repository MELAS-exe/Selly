import type { core } from '@selly/db';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Config } from './config';
import type { InvoiceGateway } from './modules/payments/provider';
import type { RateService } from './modules/rates/service';
import type { Keyring } from './secrets';

type Schema = { [K in keyof typeof core]: (typeof core)[K] };

/** Works for node-postgres (production) and PGlite (tests), and for transactions. */
export type Database = PgDatabase<any, Schema>;

export interface Context {
  config: Config;
  db: Database;
  now: () => Date;
  rates: RateService;
  invoices: InvoiceGateway;
  /** Null when no SECRETS_KEK_V<n> is set: wallets cannot be linked or used. */
  keyring: Keyring | null;
  log: Logger;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Context;
  }
}
