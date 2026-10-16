import { describe, it, expect } from 'vitest';
import { abrasionFactor, equipmentHourlyCost, labourCostPerHour, labourCostPerYear, unitsRequired } from './costFormulas';
import type { LabourRate, MobileEquipmentSpec } from './types';

describe('labourCostPerYear — structure CTC des deux modèles de référence', () => {
  it('reproduit le taux chargé Eastwood d’un opérateur de jumbo (Labour_Input!S7 = 118,67 C$/h)', () => {
    // 48,01 C$/h × 2080 h ; prime 26 C$/h ; charges 38 % ; EPI 200 + voyages 4200 × 365/28.
    const rate: LabourRate = {
      id: 'x', label: 'Jumbo', payBasis: 'hourly', hourlyRate: 48.01, annualSalary: 0,
      bonusPct: (26 / 48.01) * 100, burdenPct: 38, siteCostsUsdYr: 200 + 4200 * 365 / 28,
    };
    expect(labourCostPerYear(rate, 2080)).toBeCloseTo(246_837.9, 0);
    expect(labourCostPerHour(rate, 2080)).toBeCloseTo(118.6721, 3);
  });

  it('reproduit le coût annuel Magino d’un opérateur de foreuse (LaborRates!G44 × 2190 h)', () => {
    // Base 31 + OT 4,78 + charges 12,35 + camp 9,27 = 57,40 C$/h, sur 2190 h.
    const rate: LabourRate = {
      id: 'x', label: 'Drill', payBasis: 'hourly', hourlyRate: 31, annualSalary: 0,
      bonusPct: (4.78 / 31) * 100, burdenPct: (12.35 / 31) * 100, siteCostsUsdYr: 9.27 * 2190,
    };
    expect(labourCostPerYear(rate, 2190)).toBeCloseTo(57.4 * 2190, 6);
  });

  it('traite un salarié sur son salaire annuel, indépendamment des heures', () => {
    const rate: LabourRate = { id: 's', label: 'Mgr', payBasis: 'salary', hourlyRate: 0, annualSalary: 202_000, bonusPct: 30, burdenPct: 35, siteCostsUsdYr: 54_950 };
    expect(labourCostPerYear(rate, 2080)).toBeCloseTo(388_250, 6); // Labour_Input!R88
    expect(labourCostPerYear(rate, 1000)).toBeCloseTo(388_250, 6);
  });
});

describe('equipmentHourlyCost — formule Magino EquipCost', () => {
  // Tombereau HD1500 (EquipCost ligne 13), facteurs Magino D28–D36.
  const truck: MobileEquipmentSpec = {
    id: 't', label: 'HD1500', deliveredPriceUsd: 2_118_812, lifeHours: 90_000,
    partsFactorPerKusd: 0.00907, fuelLph: 106.9955, powerKw: 0, lubeLph: 1.056 * 3.78541,
    tireCount: 6, tireListPriceUsd: 16_464 / 0.75, tireLifeHours: 3_500,
    wearPartsFactorPerKusd: 0.00055, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.44,
  };
  const factors = {
    dieselUsdL: 2.4567 / 3.7854, electricityUsdKwh: 0.086, lubeUsdL: 23.7 / 3.78541,
    partsFactor: 1, tireFactor: 0.75, maintLabourFactor: 0.5, abrasionIndex: 3,
  };

  it('retrouve chaque composante et le total P&C de la feuille (143,07 US$/h)', () => {
    const h = equipmentHourlyCost(truck, factors);
    expect(h.parts).toBeCloseTo(19.2176, 3);
    expect(h.fuel).toBeCloseTo(69.4394, 2);
    expect(h.tires).toBeCloseTo(28.224, 3);
    expect(h.lube).toBeCloseTo(25.0272, 3);
    expect(h.wearParts).toBeCloseTo(1.1653, 3);
    expect(h.partsAndConsumables).toBeCloseTo(143.0736, 1);
    expect(h.maintHoursPerOpHour).toBeCloseTo(0.22, 6);
  });

  it('applique le facteur d’abrasivité aux seules pièces d’usure et taillants', () => {
    const soft = equipmentHourlyCost(truck, { ...factors, abrasionIndex: 5 });
    const hard = equipmentHourlyCost(truck, { ...factors, abrasionIndex: 1 });
    expect(hard.wearParts / soft.wearParts).toBeCloseTo(1.2 / 0.8, 6);
    expect(hard.parts).toBeCloseTo(soft.parts, 9);
  });
});

describe('aides', () => {
  it('abrasionFactor suit les paliers Magino', () => {
    expect(abrasionFactor(1)).toBeCloseTo(1.2, 9);
    expect(abrasionFactor(3)).toBeCloseTo(1.0, 9);
    expect(abrasionFactor(5)).toBeCloseTo(0.8, 9);
  });
  it('unitsRequired arrondit au supérieur sans gonfler un compte rond', () => {
    expect(unitsRequired(3 * 5000, 5000)).toBe(3);
    expect(unitsRequired(3 * 5000 + 1, 5000)).toBe(4);
    expect(unitsRequired(0, 5000)).toBe(0);
  });
});
