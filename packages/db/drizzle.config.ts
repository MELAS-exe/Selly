import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/core/schema.ts', './src/agent/schema.ts'],
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_DIRECT_URL ?? 'postgres://selly:selly@localhost:5432/selly',
  },
});
