import { describe, it, expect } from 'vitest';
import { formatDecimal, formatDecimalGrouped, GROUP_SEP } from './number';

describe('formatDecimal — the seven specified examples', () => {
  it.each([
    ['12,00', '12'],
    ['12,50', '12,5'],
    ['0,00', '0'],
    ['0,50', '0,5'],
    ['123,45678', '123,45'], // truncated, NOT rounded (would be 123,46)
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
    expect(formatDecimal(123.45678)).toBe('123,45');
  });

  it('truncates rather than rounds', () => {
    expect(formatDecimal(1.999)).toBe('1,99');   // not 2
    expect(formatDecimal(0.999)).toBe('0,99');
    expect(formatDecimal(99.9999)).toBe('99,99');
  });

  it('survives binary-float truncation traps', () => {
    // 10.99 * 100 === 1098.9999999999998 in IEEE-754 — the naive Math.trunc bug.
    expect(formatDecimal(10.99)).toBe('10,99');
    expect(formatDecimal(0.29)).toBe('0,29');
    expect(formatDecimal(1.005)).toBe('1'); // truncates the 3rd decimal away
    expect(formatDecimal(2.675)).toBe('2,67');
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
    expect(formatDecimal(-123.456)).toBe('-123,45');
  });

  it('never emits "-0"', () => {
    expect(formatDecimal(-0)).toBe('0');
    expect(formatDecimal(-0.004)).toBe('0'); // truncates to zero → no sign
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

  it('honours a custom decimal cap', () => {
    expect(formatDecimal(123.45678, 3)).toBe('123,456');
    expect(formatDecimal(123.45678, 0)).toBe('123');
    expect(formatDecimal(12.5, 0)).toBe('12');
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
    expect(formatDecimalGrouped(1234.56789)).toBe(`1${GROUP_SEP}234,56`);
  });

  it('groups negatives', () => {
    expect(formatDecimalGrouped(-1234.5)).toBe(`-1${GROUP_SEP}234,5`);
  });

  it('leaves sub-thousand values ungrouped', () => {
    expect(formatDecimalGrouped(999.99)).toBe('999,99');
    expect(formatDecimalGrouped(0.5)).toBe('0,5');
  });
});
