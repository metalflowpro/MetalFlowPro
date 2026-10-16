import { describe, it, expect } from 'vitest';
import { LOGIN_THROTTLE, delayAfter, emailKey, formatWait, recordFailure, recordSuccess, remainingLockMs, type ThrottleStore } from './loginThrottle';

function memoryStore(): ThrottleStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, remove: k => { data.delete(k); } };
}

describe('loginThrottle', () => {
  it('laisse passer les premiers essais puis double le délai, avec plafond', () => {
    expect(delayAfter(LOGIN_THROTTLE.freeAttempts)).toBe(0);
    expect(delayAfter(LOGIN_THROTTLE.freeAttempts + 1)).toBe(LOGIN_THROTTLE.baseDelayMs);
    expect(delayAfter(LOGIN_THROTTLE.freeAttempts + 2)).toBe(2 * LOGIN_THROTTLE.baseDelayMs);
    expect(delayAfter(100)).toBe(LOGIN_THROTTLE.maxDelayMs);
  });

  it('bloque après les échecs et se libère une fois le délai écoulé', () => {
    const s = memoryStore();
    let t = 1_000_000;
    for (let i = 0; i < LOGIN_THROTTLE.freeAttempts; i++) recordFailure(s, 'a@b.c', t);
    expect(remainingLockMs(s, 'a@b.c', t)).toBe(0);
    recordFailure(s, 'a@b.c', t);
    expect(remainingLockMs(s, 'a@b.c', t)).toBe(LOGIN_THROTTLE.baseDelayMs);
    t += LOGIN_THROTTLE.baseDelayMs;
    expect(remainingLockMs(s, 'a@b.c', t)).toBe(0);
  });

  it('un succès remet le compteur à zéro ; les vieux échecs sont oubliés', () => {
    const s = memoryStore();
    for (let i = 0; i < 6; i++) recordFailure(s, 'x@y.z', 0);
    recordSuccess(s, 'x@y.z');
    expect(remainingLockMs(s, 'x@y.z', 0)).toBe(0);
    for (let i = 0; i < 6; i++) recordFailure(s, 'x@y.z', 0);
    expect(remainingLockMs(s, 'x@y.z', LOGIN_THROTTLE.resetAfterMs + 1)).toBe(0);
  });

  it('ne stocke jamais l’e-mail en clair et normalise la casse', () => {
    const s = memoryStore();
    recordFailure(s, ' Alice@Mine.com ', 0);
    expect([...s.data.keys()].join()).not.toContain('alice');
    expect(emailKey('ALICE@mine.com')).toBe(emailKey('alice@mine.com '));
  });

  it('un stockage corrompu ne bloque pas la connexion', () => {
    const s = memoryStore();
    s.data.set(emailKey('q@q.q'), '{pas du json');
    expect(remainingLockMs(s, 'q@q.q', 0)).toBe(0);
  });

  it('formatWait', () => {
    expect(formatWait(8_000)).toBe('8 s');
    expect(formatWait(90_000)).toBe('1 min 30 s');
    expect(formatWait(120_000)).toBe('2 min');
  });
});
