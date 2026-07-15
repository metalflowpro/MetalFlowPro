import { describe, it, expect } from 'vitest';
import { parseSettingInput } from './Economics';

// `undefined` means "do not write" (revert the field); `null` means "clear the
// override so the documented default applies"; a number means "persist it".
describe('parseSettingInput', () => {
  it('persists an explicit zero instead of dropping it', () => {
    // Regression: the old `parseFloat(v) || null` turned 0 into null, so a
    // royalty deliberately set to 0% silently reverted to the 3% default.
    expect(parseSettingInput('0', 3)).toBe(0);
    expect(parseSettingInput('0', null)).toBe(0);
  });

  it('clears the override when the field is emptied', () => {
    expect(parseSettingInput('', 8000)).toBeNull();
  });

  it('does not write when an already-empty field is left empty', () => {
    expect(parseSettingInput('', null)).toBeUndefined();
  });

  it('does not write when the value is unchanged', () => {
    expect(parseSettingInput('8000', 8000)).toBeUndefined();
  });

  it('writes when the value changed', () => {
    expect(parseSettingInput('8100', 8000)).toBe(8100);
  });

  it('reverts on unparseable input rather than writing garbage', () => {
    expect(parseSettingInput('abc', 8000)).toBeUndefined();
    expect(parseSettingInput('--', 8000)).toBeUndefined();
    expect(parseSettingInput('1.2.3', 8000)).toBeUndefined();
  });

  it('accepts decimals and trims whitespace', () => {
    expect(parseSettingInput('0.5', null)).toBe(0.5);
    expect(parseSettingInput('  12  ', null)).toBe(12);
  });
});
