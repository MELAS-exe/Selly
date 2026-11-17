import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('agent', () => {
  it('answers the health check', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'agent' });
  });
});
