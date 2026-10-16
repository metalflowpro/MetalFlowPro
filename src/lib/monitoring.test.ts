import { describe, it, expect } from 'vitest';
import { initMonitoring, isMonitoringEnabled, reportError } from './monitoring';

describe('monitoring (dormant sans DSN)', () => {
  it('reste désactivé sans VITE_SENTRY_DSN', async () => {
    expect(isMonitoringEnabled({})).toBe(false);
    expect(isMonitoringEnabled({ VITE_SENTRY_DSN: '   ' })).toBe(false);
    await expect(initMonitoring({})).resolves.toBeUndefined();
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
  it('s’active dès qu’un DSN est défini', () => {
    expect(isMonitoringEnabled({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' })).toBe(true);
  });
});
