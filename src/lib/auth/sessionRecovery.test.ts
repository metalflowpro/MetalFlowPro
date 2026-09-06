import { describe, expect, it } from 'vitest';
import { isJwtIssuedInFutureError } from './sessionRecovery';

describe('session recovery', () => {
  it('detects the Supabase future-JWT error', () => {
    expect(isJwtIssuedInFutureError('JWT issued at future')).toBe(true);
    expect(isJwtIssuedInFutureError('JWT issued at future: 123')).toBe(true);
  });

  it('does not classify unrelated errors as clock skew', () => {
    expect(isJwtIssuedInFutureError('JWT expired')).toBe(false);
    expect(isJwtIssuedInFutureError(undefined)).toBe(false);
  });
});

