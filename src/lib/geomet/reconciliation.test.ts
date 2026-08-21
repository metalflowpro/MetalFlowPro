import { describe, it, expect } from 'vitest';
import {
  reconRowStatus, evaluateRows, reconciliationSummary, reconciliationSuggestions,
  type ReconRow,
} from './reconciliation';

describe('reconRowStatus', () => {
  it('classe selon l\'écart absolu', () => {
    expect(reconRowStatus(-0.6)).toBe('acceptable');
    expect(reconRowStatus(-2.4)).toBe('review');
    expect(reconRowStatus(-6.6)).toBe('revise');
    expect(reconRowStatus(null)).toBe('na');
  });
});

describe('evaluateRows', () => {
  it('calcule gap = observé − prédit', () => {
    const [r] = evaluateRows([{ domainName: 'A', predicted: 89.2, observed: 88.6 }]);
    expect(r.gap).toBeCloseTo(-0.6, 5);
    expect(r.status).toBe('acceptable');
  });
  it('ligne incomplète → gap null, statut na', () => {
    const [r] = evaluateRows([{ domainName: 'A', predicted: 90, observed: null }]);
    expect(r.gap).toBeNull();
    expect(r.status).toBe('na');
  });
});

describe('reconciliationSummary', () => {
  const rows: ReconRow[] = [
    { domainName: 'GID-001', predicted: 89.2, observed: 88.6 },
    { domainName: 'GID-002', predicted: 93.5, observed: 91.1 },
    { domainName: 'GID-003', predicted: 76.8, observed: 70.2 },
  ];
  it('agrège biais, MAE, RMSE et le pire écart', () => {
    const s = reconciliationSummary(rows);
    expect(s.n).toBe(3);
    expect(s.meanBias).toBeCloseTo((-0.6 - 2.4 - 6.6) / 3, 5);
    expect(s.mae).toBeCloseTo((0.6 + 2.4 + 6.6) / 3, 5);
    expect(s.worstDomain).toBe('GID-003');
    expect(s.rmse!).toBeGreaterThan(s.mae!);
  });
  it('pondère par le tonnage quand il est renseigné partout', () => {
    const weighted: ReconRow[] = [
      { domainName: 'A', predicted: 90, observed: 80, tonnage: 1 },   // gap -10, poids faible
      { domainName: 'B', predicted: 90, observed: 90, tonnage: 99 },  // gap 0, poids fort
    ];
    const s = reconciliationSummary(weighted);
    // Biais pondéré tiré vers 0 par la grosse campagne.
    expect(s.meanBias!).toBeCloseTo(-0.1, 5);
  });
  it('aucune ligne appariée → stats nulles', () => {
    const s = reconciliationSummary([{ domainName: 'A', predicted: null, observed: null }]);
    expect(s.n).toBe(0);
    expect(s.meanBias).toBeNull();
  });
});

describe('reconciliationSuggestions', () => {
  it('signale un biais systématique et les domaines à réviser', () => {
    const sugg = reconciliationSuggestions([
      { domainName: 'GID-002', predicted: 93.5, observed: 91.1 },
      { domainName: 'GID-003', predicted: 76.8, observed: 70.2 },
    ]);
    expect(sugg.some(s => s.includes('systématique'))).toBe(true);
    expect(sugg.some(s => s.includes('GID-003'))).toBe(true);
  });
  it('réconciliation propre → aucune suggestion', () => {
    const sugg = reconciliationSuggestions([
      { domainName: 'A', predicted: 90, observed: 90.3 },
      { domainName: 'B', predicted: 88, observed: 87.5 },
    ]);
    expect(sugg).toHaveLength(0);
  });
});
