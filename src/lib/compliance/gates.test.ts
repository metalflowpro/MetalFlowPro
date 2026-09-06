import { describe, it, expect } from 'vitest';
import {
  gateResource, gateReserve, gateEconomics, gateReport, evaluateGates, canExportReport,
  BIAS_TOLERANCE_FRACTION_OF_STDEV,
  type ComplianceInput,
} from './gates';

const OK: ComplianceInput = {
  resource: {
    hasEffectiveRun: true, effectiveDate: '2026-05-04', crossValMeanError: 0.001,
    crossValStdev: 0.2, hasGradeTonnage: true, qpAssigned: true,
  },
  reserve: {
    inferredBlocksInPlan: 0, dilutionApplied: true, miningRecoveryApplied: true,
    reserveTonnes: 224_000_000, resourceMITonnes: 265_000_000, qpAssigned: true,
  },
  economics: { pricesFromSingleSource: true, hasSensitivity: true },
  report: { itemsComplete: 25, itemsTotal: 25, allItemsSignedOff: true },
};

describe('gate V5 — réserve (règle dure CIM)', () => {
  it('ÉCHOUE si un bloc inféré est présent dans le plan minier', () => {
    const g = gateReserve({ ...OK.reserve, inferredBlocksInPlan: 3 });
    expect(g.status).toBe('fail');
    const c = g.checks.find(c => c.id === 'no_inferred')!;
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/3 bloc/);
  });

  it('ÉCHOUE si la réserve dépasse la ressource M+I contrainte', () => {
    const g = gateReserve({ ...OK.reserve, reserveTonnes: 300_000_000 });
    expect(g.checks.find(c => c.id === 'tonnage')!.status).toBe('fail');
    expect(g.status).toBe('fail');
  });

  it('PASSE quand inféré=0, dilution/récup appliquées, tonnage cohérent, QP assigné', () => {
    expect(gateReserve(OK.reserve).status).toBe('pass');
  });
});

describe('gate V3 — ressource', () => {
  it('échoue sans date d\'effet ni QP', () => {
    const g = gateResource({ ...OK.resource, effectiveDate: null, qpAssigned: false });
    expect(g.status).toBe('fail');
  });
  it('avertit (pas échec) si le biais dépasse la tolérance', () => {
    const g = gateResource({ ...OK.resource, crossValMeanError: 0.5, crossValStdev: 0.2 });
    expect(g.checks.find(c => c.id === 'bias')!.status).toBe('warn');
    // les autres contrôles durs passent → statut global = warn
    expect(g.status).toBe('warn');
  });

  it('juge le biais à exactement 10 % de σ comme acceptable (borne incluse)', () => {
    const stdev = 0.2;
    const g = gateResource({
      ...OK.resource,
      crossValStdev: stdev,
      crossValMeanError: BIAS_TOLERANCE_FRACTION_OF_STDEV * stdev,
    });
    expect(g.checks.find(c => c.id === 'bias')!.status).toBe('pass');
  });

  it('n\'échoue pas sur le biais quand σ est indisponible (tolérance non jugeable)', () => {
    // Régression : le panneau passait crossValStdev en dur à null, ce qui rendait
    // ce contrôle vide. Sans σ on ne peut pas juger — mais on ne doit pas non plus
    // faussement avertir sur un biais mesuré.
    const g = gateResource({ ...OK.resource, crossValStdev: null, crossValMeanError: 999 });
    expect(g.checks.find(c => c.id === 'bias')!.status).toBe('pass');
  });

  it('avertit quand la validation croisée est absente', () => {
    const g = gateResource({ ...OK.resource, crossValMeanError: null, crossValStdev: null });
    expect(g.checks.find(c => c.id === 'cross_val')!.status).toBe('warn');
    expect(g.checks.find(c => c.id === 'bias')!.status).toBe('warn');
  });

  it('bloque un run explicitement marqué non publiable par le quality gate', () => {
    const g = gateResource({ ...OK.resource, qualityStatus: 'fail' });
    expect(g.checks.find(c => c.id === 'quality_gate')!.status).toBe('fail');
    expect(g.status).toBe('fail');
  });
});

describe('gate V7 — rapport', () => {
  it('échoue si tous les items ne sont pas renseignés', () => {
    const g = gateReport({ itemsComplete: 20, itemsTotal: 25, allItemsSignedOff: false });
    expect(g.status).toBe('fail');
  });
});

describe('gate V6 — économie', () => {
  it('avertit si les prix ne viennent pas de la source unique', () => {
    const g = gateEconomics({ pricesFromSingleSource: false, hasSensitivity: true });
    expect(g.status).toBe('warn');
  });
});

describe('évaluation globale + export', () => {
  it('tout vert → aucun gate en échec, export autorisé', () => {
    const gates = evaluateGates(OK);
    expect(gates.every(g => g.status === 'pass')).toBe(true);
    expect(canExportReport(gates)).toBe(true);
  });

  it('un inféré en réserve bloque l\'export', () => {
    const gates = evaluateGates({ ...OK, reserve: { ...OK.reserve, inferredBlocksInPlan: 1 } });
    expect(canExportReport(gates)).toBe(false);
  });
});
