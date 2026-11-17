import { defineConfig } from 'vitest/config';

// The agent's tests start whole Fastify apps (and core on PGlite in src/e2e). With turbo running every
// package's tests at once, the default 5 s limit fails on a loaded machine, not on slow code.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
