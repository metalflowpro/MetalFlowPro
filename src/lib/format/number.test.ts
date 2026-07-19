import { describe, it, expect } from 'vitest';
import { formatDecimal, formatDecimalGrouped, GROUP_SEP } from './number';

describe('formatDecimal — the seven specified examples', () => {
  it.each([
    ['12,00', '12'],
    ['12,50', '12,5'],
    ['0,00', '0'],
    ['0,50', '0,5'],
    ['123,45678', '123,46'], // rounded to 2 decimals
    ['10,990', '10,99'],
    ['5', '5'],
  ])('%s → %s', (input, expected) => {
    expect(formatDecimal(input)).toBe(expected);
  });
});

describe('formatDecimal — numeric input', () => {
  it('accepts numbers as well as strings', () => {
    expect(formatDecimal(12)).toBe('12');
    expect(formatDecimal(12.5)).toBe('12,5');
    expect(formatDecimal(123.45678)).toBe('123,46');
  });

  it('rounds to the requested precision', () => {
    expect(formatDecimal(1.999)).toBe('2');       // rounds up
    expect(formatDecimal(0.999)).toBe('1');
    expect(formatDecimal(99.9999)).toBe('100');
    expect(formatDecimal(1.994)).toBe('1,99');    // rounds down
    expect(formatDecimal(1.996)).toBe('2');
  });

  it('rounds at 3 and 4 decimals when the site asks for it', () => {
    expect(formatDecimal(0.00044, 4)).toBe('0,0004');
    expect(formatDecimal(0.00046, 4)).toBe('0,0005');
    expect(formatDecimal(1.2346, 3)).toBe('1,235');
    expect(formatDecimal(0.1, 4)).toBe('0,1');    // trailing zeros still stripped
  });

  it('keeps precise grades that 2 decimals would zero out', () => {
    // The reason some columns pass 3–4: 0.004 g/t must not read as "0".
    expect(formatDecimal(0.004, 3)).toBe('0,004');
    expect(formatDecimal(0.004, 2)).toBe('0');    // whereas 2 decimals rounds it away
  });

  it('strips a single trailing zero and a double', () => {
    expect(formatDecimal(12.5)).toBe('12,5');
    expect(formatDecimal(12.0)).toBe('12');
    expect(formatDecimal(3.4)).toBe('3,4');
    expect(formatDecimal(3.40)).toBe('3,4');
  });
});

describe('formatDecimal — negatives and zero', () => {
  it('keeps the sign', () => {
    expect(formatDecimal(-12.5)).toBe('-12,5');
    expect(formatDecimal(-0.5)).toBe('-0,5');
    expect(formatDecimal(-123.456)).toBe('-123,46');
  });

  it('never emits "-0"', () => {
    expect(formatDecimal(-0)).toBe('0');
    expect(formatDecimal(-0.004)).toBe('0'); // rounds to zero → no sign
    expect(formatDecimal(-0.001)).toBe('0');
  });

  it('formats zero as a bare 0', () => {
    expect(formatDecimal(0)).toBe('0');
    expect(formatDecimal('0,000')).toBe('0');
    expect(formatDecimal(0.0)).toBe('0');
  });
});

describe('formatDecimal — input handling & edge cases', () => {
  it('accepts comma- or dot-decimal strings', () => {
    expect(formatDecimal('12.50')).toBe('12,5');
    expect(formatDecimal('12,50')).toBe('12,5');
    expect(formatDecimal(' 12,5 ')).toBe('12,5');
  });

  it('returns empty string for non-finite / empty input', () => {
    expect(formatDecimal(NaN)).toBe('');
    expect(formatDecimal(Infinity)).toBe('');
    expect(formatDecimal(null)).toBe('');
    expect(formatDecimal(undefined)).toBe('');
    expect(formatDecimal('')).toBe('');
    expect(formatDecimal('abc')).toBe('');
  });

  it('honours a custom decimal precision', () => {
    expect(formatDecimal(123.45678, 3)).toBe('123,457'); // rounded
    expect(formatDecimal(123.45678, 0)).toBe('123');
    expect(formatDecimal(123.6, 0)).toBe('124');         // rounds up at 0 decimals
    expect(formatDecimal(12.5, 0)).toBe('13');           // .5 rounds away from zero
  });

  it('handles large integers without decimals', () => {
    expect(formatDecimal(1234567)).toBe('1234567');
    expect(formatDecimal(1000000.0)).toBe('1000000');
  });
});

describe('formatDecimalGrouped', () => {
  it('groups thousands with a space and keeps the decimal rule', () => {
    expect(formatDecimalGrouped(1234567.8)).toBe(`1${GROUP_SEP}234${GROUP_SEP}567,8`);
    expect(formatDecimalGrouped(45330000)).toBe(`45${GROUP_SEP}330${GROUP_SEP}000`);
    expect(formatDecimalGrouped(1234.56789)).toBe(`1${GROUP_SEP}234,57`);
  });

  it('groups negatives', () => {
    expect(formatDecimalGrouped(-1234.5)).toBe(`-1${GROUP_SEP}234,5`);
  });

  it('leaves sub-thousand values ungrouped', () => {
    expect(formatDecimalGrouped(999.99)).toBe('999,99');
    expect(formatDecimalGrouped(0.5)).toBe('0,5');
  });
});
