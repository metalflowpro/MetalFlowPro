import { describe, it, expect } from 'vitest';
import {
  buildProjectDataBundle, toGeneratorFeed, toFeedInput, snapshotBundle,
  REQUIRED_FIELDS, type ConnectorInputs,
} from './projectDataConnector';
import { sourced } from './provenance';
import type { RouteSampleCounts } from '../analytics/routeEstimation';

const COUNTS: RouteSampleCounts = { chem: 10, comminution: 2, knelson: 3, flotation: 4, leaching: 5, mineralogy: 1 };

function inputs(over: Partial<ConnectorInputs> = {}): ConnectorInputs {
  return {
    throughputTph: [sourced(913, 'design_criteria', { note: 'Critères de conception' })],
    goldGrade: [
      sourced(0.92, 'lims_approved', { note: 'moyenne LIMS' }),
      sourced(1.0, 'design_criteria'),
    ],
    grgPct: [sourced(12, 'lims_approved')],
    sulphidePct: [sourced(4, 'lims_approved')],
    corgPct: [sourced(0.05, 'lims_approved')],
    labP80Um: [sourced(106, 'testwork_validated', { note: 'Étude P80' })],
    sampleCounts: COUNTS,
    ...over,
  };
}

describe('buildProjectDataBundle — applique la hiérarchie', () => {
  it('retient la teneur LIMS approuvée plutôt que le critère de conception', () => {
    const b = buildProjectDataBundle(inputs());
    expect(b.goldGrade?.value).toBe(0.92);
    expect(b.goldGrade?.tier).toBe('lims_approved');
    expect(b.goldGrade?.provenance).toBe('measured');
  });

  it('retombe sur le critère de conception quand l’essai manque', () => {
    const b = buildProjectDataBundle(inputs({
      goldGrade: [sourced(null, 'lims_approved'), sourced(1.1, 'design_criteria')],
    }));
    expect(b.goldGrade?.value).toBe(1.1);
    expect(b.goldGrade?.tier).toBe('design_criteria');
    expect(b.goldGrade?.provenance).toBe('estimated');
  });

  it('laisse les champs sans candidat à null', () => {
    const b = buildProjectDataBundle(inputs({ bwiKwhT: undefined }));
    expect(b.bwiKwhT).toBeNull();
  });

  it('copie le décompte d’essais tel quel', () => {
    expect(buildProjectDataBundle(inputs()).sampleCounts).toEqual(COUNTS);
  });
});

describe('champs obligatoires', () => {
  it('signale le débit manquant', () => {
    const b = buildProjectDataBundle(inputs({ throughputTph: [sourced(null, 'design_criteria')] }));
    expect(b.missingRequired).toContain('throughputTph');
  });
  it('ne signale rien quand tous les obligatoires sont présents', () => {
    const b = buildProjectDataBundle(inputs());
    expect(b.missingRequired).toHaveLength(0);
    expect(REQUIRED_FIELDS.every(f => b[f] != null)).toBe(true);
  });
});

describe('qualité globale', () => {
  it('vert quand les champs présents sont majoritairement validés', () => {
    // throughput=critère, le reste = LIMS/testwork validés → ≥80% validés.
    const b = buildProjectDataBundle(inputs());
    expect(b.quality).toBe('green');
  });
  it('rouge quand la majorité des champs sont des hypothèses', () => {
    const b = buildProjectDataBundle({
      throughputTph: [sourced(500, 'user_assumption')],
      goldGrade: [sourced(1, 'user_assumption')],
      grgPct: [sourced(5, 'template_default')],
    });
    expect(b.quality).toBe('red');
  });
});

describe('toGeneratorFeed', () => {
  it('reporte les valeurs et garde null pour les champs absents', () => {
    const feed = toGeneratorFeed(buildProjectDataBundle(inputs({ bwiKwhT: undefined })));
    expect(feed.goldGrade).toBe(0.92);
    expect(feed.grgPct).toBe(12);
    expect(feed.labP80Um).toBe(106);
    expect(feed.bwiKwhT).toBeNull(); // absent → hypothèse, pas 0
  });
});

describe('toFeedInput', () => {
  const defaults = { silver_grade: 15, p80: 150, hardness_bwi: 14, sulphide_content: 5, carbon_content: 0.1, moisture: 8 };
  it('utilise les valeurs projet et retombe sur les défauts pour les champs absents', () => {
    const fi = toFeedInput(buildProjectDataBundle(inputs({ bwiKwhT: undefined, silverGrade: undefined })), 'free_milling', defaults);
    expect(fi.feed_rate).toBe(913);
    expect(fi.gold_grade).toBe(0.92);
    expect(fi.p80).toBe(106);          // Étude P80
    expect(fi.hardness_bwi).toBe(14);  // repli défaut
    expect(fi.silver_grade).toBe(15);  // repli défaut
    expect(fi.ore_type).toBe('free_milling');
  });
});

describe('snapshotBundle (§8 — snapshot immuable)', () => {
  it('sérialise chaque champ présent avec valeur, tier et provenance', () => {
    const snap = snapshotBundle(buildProjectDataBundle(inputs()));
    expect(snap.goldGrade).toEqual({ value: 0.92, tier: 'lims_approved', provenance: 'measured', note: 'moyenne LIMS' });
    expect(snap.labP80Um?.tier).toBe('testwork_validated');
    // Les champs absents ne sont pas sérialisés.
    expect(snap.bwiKwhT === undefined || snap.bwiKwhT === null).toBeTruthy();
  });
});
