import { describe, expect, it } from 'vitest';
import { ApiError } from './browser-api';
import { describeError, SLUG_PATTERN, safeNext, slugify, stepFor, toE164 } from './onboarding';

describe('slugify', () => {
  it('turns a shop name into an address core accepts', () => {
    expect(slugify('Awa Style')).toBe('awa-style');
    expect(slugify('  Boutique Fatou & Fils !! ')).toBe('boutique-fatou-fils');
    expect(slugify('Thiès Élégance')).toBe('thies-elegance');
  });

  it('never ends with a dash after cutting to 40 characters', () => {
    const slug = slugify(`${'a'.repeat(39)} b`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('gives something core accepts, or nothing', () => {
    expect(SLUG_PATTERN.test(slugify('Awa Style'))).toBe(true);
    expect(SLUG_PATTERN.test(slugify('A'))).toBe(false);
    expect(slugify('***')).toBe('');
  });
});

describe('toE164', () => {
  it('reads the ways people write a Senegalese number', () => {
    expect(toE164('+221 77 123 45 67')).toBe('+221771234567');
    expect(toE164('00221771234567')).toBe('+221771234567');
    expect(toE164('77 123 45 67')).toBe('+221771234567');
  });

  it('keeps another country code', () => {
    expect(toE164('+33 6 12 34 56 78')).toBe('+33612345678');
  });

  it('refuses what it cannot read', () => {
    expect(toE164('')).toBeNull();
    expect(toE164('12345')).toBeNull();
    expect(toE164('+0123456789')).toBeNull();
    expect(toE164('hello')).toBeNull();
  });
});

describe('safeNext', () => {
  it('only goes to pages of the dashboard', () => {
    expect(safeNext('/app/onboarding')).toBe('/app/onboarding');
    expect(safeNext('/app')).toBe('/app');
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example/app')).toBeNull();
    expect(safeNext('/tarifs')).toBeNull();
    expect(safeNext('/app\\..\\evil')).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});

describe('stepFor', () => {
  it('shows the first thing still missing', () => {
    expect(stepFor({ live: true, live_blockers: [] })).toBe('done');
    expect(
      stepFor({ live: false, live_blockers: ['wallet_missing', 'subscription_required'] }),
    ).toBe('wallet');
    expect(stepFor({ live: false, live_blockers: ['wallet_degraded'] })).toBe('wallet');
    expect(stepFor({ live: false, live_blockers: ['subscription_required'] })).toBe('plan');
    expect(stepFor({ live: false, live_blockers: ['subscription_suspended'] })).toBe('plan');
  });
});

describe('describeError', () => {
  const problem = (code: string, detail?: string) =>
    new ApiError({
      type: 'about:blank',
      title: 'x',
      status: 422,
      code,
      ...(detail ? { detail } : {}),
    });

  it('uses core’s own words for a validation error', () => {
    expect(describeError(problem('VALIDATION_FAILED', 'The slug "awa" is already used.'))).toBe(
      'The slug "awa" is already used.',
    );
  });

  it('explains wallet errors in plain English', () => {
    expect(describeError(problem('NWC_PERMISSIONS_TOO_BROAD'))).toMatch(/receive-only/);
    expect(describeError(problem('NWC_TIMEOUT'))).toMatch(/online/);
  });

  it('does not leak an unknown error', () => {
    expect(describeError(problem('SOMETHING_NEW', 'internal detail'))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
