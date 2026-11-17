import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './core/schema';

export type Db = ReturnType<typeof createDb>['db'];

/** Connect to PostgreSQL. Call `close()` on shutdown. */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  // The pool too: core takes dedicated connections from it for LISTEN and for the job leader lock.
  return { db, pool, close: () => pool.end() };
}

/** Apply every migration in `folder` (packages/db/migrations, or /app/migrations in the core image). */
export async function runMigrations(db: Db, folder: string) {
  await migrate(db, { migrationsFolder: folder });
}
