import { describe, expect, it } from 'vitest';
import { storefrontStyle, usableBackground } from './brand-colors';

const branding = (background_color: string | null) => ({
  logo_url: null,
  primary_color: '#173b32',
  accent_color: '#8aae4a',
  background_color,
  banner: null,
});

describe('shop background', () => {
  it('takes a light colour, refuses one too dark for the text', () => {
    expect(usableBackground('#fff8ee')).toBe(true);
    expect(usableBackground('#ffffff')).toBe(true);
    expect(usableBackground('#8aae4a')).toBe(false);
    expect(usableBackground('#173b32')).toBe(false);
    expect(usableBackground(null)).toBe(false);
    expect(usableBackground('pink')).toBe(false);
  });

  it('becomes the page paper, or leaves Selly paper alone', () => {
    expect(storefrontStyle(branding('#fff8ee'))['--color-d-paper']).toBe('#fff8ee');
    expect(storefrontStyle(branding('#202020'))['--color-d-paper']).toBeUndefined();
    expect(storefrontStyle(branding(null))['--color-d-paper']).toBeUndefined();
  });
});
