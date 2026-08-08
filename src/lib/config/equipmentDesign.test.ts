import { describe, it, expect } from 'vitest';
import { COMMON_DESIGN_FACTORS, EQUIPMENT_DESIGN_FACTORS } from './equipmentDesign';

// Ces tests verrouillent la COHÉRENCE PHYSIQUE des facteurs de dimensionnement,
// pas leur valeur exacte (qui doit rester ajustable par site). Ils attrapent une
// faute de frappe lors d'un recalage (0.35 → 35, 1.25 → 0.125) sans figer la
// convention d'ingénierie.

describe('marges de conception', () => {
  it('majorent toujours le débit nominal, jamais l\'inverse', () => {
    expect(COMMON_DESIGN_FACTORS.designMarginFactor).toBeGreaterThan(1);
    expect(COMMON_DESIGN_FACTORS.designMarginFactor).toBeLessThan(2);
  });

  it('restent dans une plage d\'ingénierie plausible pour chaque équipement', () => {
    const margins: number[] = [];
    for (const equip of Object.values(EQUIPMENT_DESIGN_FACTORS)) {
      for (const [key, value] of Object.entries(equip)) {
        if (/MarginFactor$/.test(key) && typeof value === 'number') margins.push(value);
      }
    }
    expect(margins.length).toBeGreaterThan(5); // le balayage trouve bien des marges
    for (const m of margins) {
      expect(m).toBeGreaterThan(1);   // une marge ne sous-dimensionne jamais
      expect(m).toBeLessThanOrEqual(2); // +100 % serait une faute de saisie
    }
  });

  it('donne au scalpeur ROM une marge au moins égale à la marge commune', () => {
    // Le grizzly reçoit le ROM brut non régulé : sa marge ne peut pas être plus
    // serrée que celle des équipements alimentés en aval.
    expect(EQUIPMENT_DESIGN_FACTORS.grizzly.designMarginFactor)
      .toBeGreaterThanOrEqual(COMMON_DESIGN_FACTORS.designMarginFactor);
  });
});

describe('fractions (taux de remplissage, % solides, rendements)', () => {
  it('sont toutes strictement comprises entre 0 et 1', () => {
    const fractions: [string, number][] = [];
    for (const [equipName, equip] of Object.entries(EQUIPMENT_DESIGN_FACTORS)) {
      for (const [key, value] of Object.entries(equip)) {
        if (/(Fraction|Efficiency)$/.test(key) && typeof value === 'number') {
          fractions.push([`${equipName}.${key}`, value]);
        }
      }
    }
    expect(fractions.length).toBeGreaterThan(8);
    for (const [name, v] of fractions) {
      expect(v, name).toBeGreaterThan(0);
      expect(v, name).toBeLessThanOrEqual(1);
    }
  });
});

describe('facteurs de correction du Wi de broyage', () => {
  it('majorent le Wi pour le broyage primaire, le minorent pour le regrind', () => {
    // Le SAG/AG voit un minerai plus tenace que l'essai BWi standard…
    expect(EQUIPMENT_DESIGN_FACTORS.sag.bwiCorrectionFactor).toBeGreaterThan(1);
    expect(EQUIPMENT_DESIGN_FACTORS.ag.bwiCorrectionFactor).toBeGreaterThan(1);
    // …alors que le regrind broie des mixtes déjà concentrés, plus tendres.
    for (const mill of ['vertimill', 'isamill', 'towermill'] as const) {
      expect(EQUIPMENT_DESIGN_FACTORS[mill].bwiCorrectionFactor, mill).toBeLessThan(1);
      expect(EQUIPMENT_DESIGN_FACTORS[mill].bwiCorrectionFactor, mill).toBeGreaterThan(0);
    }
  });

  it('applique au SAG un rendement énergétique inférieur à Bond', () => {
    // Le SAG est moins efficace que l'équation de Bond ne le prédit pour un ball mill.
    expect(EQUIPMENT_DESIGN_FACTORS.sag.bondEnergyFactor).toBeLessThan(1);
    expect(EQUIPMENT_DESIGN_FACTORS.ag.bondEnergyFactor).toBeLessThan(1);
  });
});

describe('cohérence inter-équipements', () => {
  it('donne au CIL un nombre de cuves entier et plausible', () => {
    const n = EQUIPMENT_DESIGN_FACTORS.cil.tankCount;
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('envoie la quasi-totalité du débit en résidus (récupération massique faible)', () => {
    // En or, la masse récupérée est négligeable : les résidus ≈ l'alimentation.
    const f = EQUIPMENT_DESIGN_FACTORS.tailings.tailingsMassFraction;
    expect(f).toBeGreaterThan(0.99);
    expect(f).toBeLessThanOrEqual(1);
  });

  it('majore la puissance usine totale au-delà du seul broyage', () => {
    // Broyage + auxiliaires/pompage/services > broyage seul.
    expect(EQUIPMENT_DESIGN_FACTORS.power.plantTotalFromGrindingFactor).toBeGreaterThan(1);
  });

  it('vise un P80 de regrind plus fin que le P80 usine', () => {
    expect(EQUIPMENT_DESIGN_FACTORS.cone.p80FromCssFactor).toBeGreaterThan(1); // P80 produit > CSS
  });
});
