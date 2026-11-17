// Re-exports drizzle-orm from this package, so every app uses the same instance as the schemas
// (two copies resolved with different peers have incompatible types).
export * from 'drizzle-orm';
export { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
export type { PgDatabase } from 'drizzle-orm/pg-core';
