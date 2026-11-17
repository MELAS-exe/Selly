import { describe, expect, it } from 'vitest';
import { checkPermissions } from './index';

describe('checkPermissions', () => {
  it('accepts a receive-only connection', () => {
    expect(checkPermissions(['make_invoice', 'lookup_invoice', 'get_info', 'get_balance'])).toEqual(
      {
        ok: true,
        receiveOnly: true,
        hasBalance: true,
      },
    );
  });
  it('refuses a missing lookup_invoice', () => {
    expect(checkPermissions(['make_invoice'])).toMatchObject({
      ok: false,
      code: 'NWC_METHODS_MISSING',
    });
  });
  it('refuses spending methods', () => {
    expect(checkPermissions(['make_invoice', 'lookup_invoice', 'pay_invoice'])).toMatchObject({
      ok: false,
      code: 'NWC_PERMISSIONS_TOO_BROAD',
    });
  });
});
