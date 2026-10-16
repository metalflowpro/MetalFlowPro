import { describe, it, expect } from 'vitest';
import { headingCost, computeUndergroundCost, stopeUnitCost, type UndergroundInputs } from './underground';
import { cadToUsd } from '../config/constants';
import {
  UG_CALENDAR_REFERENCE, UG_HANDLING_REFERENCE, UG_INTENSITY_REFERENCE, UG_LABOUR_RATES, UG_REFERENCE_ANNUAL_ORE_T, UG_ROLE_RATES, UG_STAFF,
  ugCapitalHeadingReference, ugFleetReference, ugInfrastructureReference, ugOperatingHeadingReference, ugStopeReference,
} from './referenceData';

// Taux horaires chargés Eastwood (Labour_Input colonne S), convertis comme le référentiel.
const rates = {
  driller: cadToUsd(118.6721),
  blaster: cadToUsd(110.1721),
  bolter: cadToUsd(118.6721),
  mucker: cadToUsd(103.1721),
  mechanic: cadToUsd(103.5447),
};
const cal = { hoursPerShift: 12, availableEquipHPerShift: (12 - 3.9133) * 0.7 };

describe('headingCost — reproduit les galeries types Eastwood', () => {
  it('galerie capitale 5,0 × 5,0 m, main-d’œuvre par activité : 7 211 C$/m (CapexDev5.0x5.0!G101)', () => {
    const r = headingCost({ ...ugCapitalHeadingReference(2.87), labourBasis: 'activity' }, cal, rates);
    expect(r.hours.drilling).toBeCloseTo(2.1798, 2);
    expect(r.hours.blasting).toBeCloseTo(3.05, 6);
    expect(r.hours.groundSupport).toBeCloseTo(4.6667, 3);
    expect(r.hours.mucking).toBeCloseTo(4.9272, 2);
    expect(r.perMetre.labour).toBeCloseTo(cadToUsd(2202.66), -1);
    expect(r.perMetre.total / cadToUsd(7210.97)).toBeGreaterThan(0.99);
    expect(r.perMetre.total / cadToUsd(7210.97)).toBeLessThan(1.01);
  });

  it('galerie d’exploitation 4,5 × 4,5 m, main-d’œuvre par activité : 6 400 C$/m (OpexDev4.5x4.5!G101)', () => {
    const r = headingCost({ ...ugOperatingHeadingReference(2.94), labourBasis: 'activity' }, cal, rates);
    expect(r.perMetre.total / cadToUsd(6400.02)).toBeGreaterThan(0.97);
    expect(r.perMetre.total / cadToUsd(6400.02)).toBeLessThan(1.03);
  });

  it('base publiée (main-d’œuvre unitaire) : 4 263 C$/m par fonction + 772 C$/m de main-d’œuvre', () => {
    const r = headingCost(ugOperatingHeadingReference(2.94), cal, rates);
    // OpexDev4.5x4.5!C54+D54+E54 (allocation incluse) et Opex Summary!F27 / 53 837 m.
    const byFunction = r.perMetre.consumables + r.perMetre.equipment + r.perMetre.energy + r.perMetre.allowance;
    expect(byFunction / cadToUsd(4263.46)).toBeGreaterThan(0.97);
    expect(byFunction / cadToUsd(4263.46)).toBeLessThan(1.03);
    expect(r.perMetre.labour).toBeCloseTo(cadToUsd(41_563_124 / 53_836.6), 6);
    expect(r.perMetre.labourActivity).toBeGreaterThan(r.perMetre.labour);
  });

  it('une galerie plus large coûte plus cher au mètre (plus de marin et de soutènement)', () => {
    const base = ugCapitalHeadingReference(2.8);
    const wide = { ...base, widthM: 6, boltsPerRound: base.boltsPerRound + 8 };
    expect(headingCost(wide, cal, rates).perMetre.total).toBeGreaterThan(headingCost(base, cal, rates).perMetre.total);
  });
});

describe('stopeUnitCost', () => {
  it('par fonction + main-d’œuvre : moyenne pondérée = 37,68 + 4,66 C$/t (Mine Dev-Stoping Cost!G250, Opex Summary!F28)', () => {
    const stopes = ugStopeReference();
    const avg = stopes.reduce((s, m) => s + m.share * stopeUnitCost(m), 0);
    expect(avg / cadToUsd(37.6758 + 48_077_644 / 10_314_906)).toBeGreaterThan(0.99);
    expect(avg / cadToUsd(37.6758 + 48_077_644 / 10_314_906)).toBeLessThan(1.01);
  });
});

function inputs(annualOre: number, years = 8, pp = 2): UndergroundInputs {
  const periods = [
    ...Array.from({ length: pp }, (_, k) => ({ year: k - pp + 1, preProduction: true, oreTonnes: 0 })),
    ...Array.from({ length: years }, (_, i) => ({ year: i + 1, preProduction: false, oreTonnes: annualOre })),
  ];
  return {
    periods,
    ...UG_CALENDAR_REFERENCE,
    paidHoursPerYear: 2080,
    devOreFraction: UG_INTENSITY_REFERENCE.devOreFraction,
    opLateralMPerKt: UG_INTENSITY_REFERENCE.opLateralMPerKt,
    capLateralMPerKtProduction: UG_INTENSITY_REFERENCE.capLateralMPerKtProduction,
    preProductionCapLateralM: UG_INTENSITY_REFERENCE.preProductionCapLateralM,
    verticalMPerKtProduction: UG_INTENSITY_REFERENCE.verticalMPerKtProduction,
    preProductionVerticalM: UG_INTENSITY_REFERENCE.preProductionVerticalM,
    verticalUsdPerM: UG_INTENSITY_REFERENCE.verticalUsdPerM,
    backfillTPerStopeT: UG_INTENSITY_REFERENCE.backfillTPerStopeT,
    capitalHeading: ugCapitalHeadingReference(2.9),
    operatingHeading: ugOperatingHeadingReference(2.9),
    stopes: ugStopeReference(),
    ...UG_HANDLING_REFERENCE,
    rates: UG_LABOUR_RATES,
    roleRates: { ...UG_ROLE_RATES },
    staff: UG_STAFF,
    fleet: ugFleetReference(),
    infrastructure: ugInfrastructureReference(),
    contingencyPct: 30,
  };
}

describe('computeUndergroundCost', () => {
  it('capitalise toute la dépense de pré-production et n’a pas d’OPEX avant la production', () => {
    const r = computeUndergroundCost(inputs(1_200_000));
    const pre = r.periods.filter(p => p.preProduction).map(p => p.index);
    for (const o of r.opex) for (const i of pre) expect(o.byPeriod[i]).toBe(0);
    const capitalised = r.capex.find(c => c.key === 'capitalised_preprod')!;
    expect(capitalised.initialUsd).toBeGreaterThan(0);
    expect(capitalised.sustainingUsd).toBe(0);
  });

  it('donne un OPEX unitaire proche du plan Eastwood (96,7 C$/t hors usine/G&A)', () => {
    // Eastwood Opex Summary!G37 : 96,73 C$/t sur la période de production. Les
    // intensités sont celles du plan Eastwood ; on tolère ±15 % (calendrier
    // simplifié, pas de location de flotte de l'entrepreneur).
    const r = computeUndergroundCost(inputs(UG_REFERENCE_ANNUAL_ORE_T, 15));
    expect(r.totals.opexUsdPerOreTonne / cadToUsd(96.73)).toBeGreaterThan(0.85);
    expect(r.totals.opexUsdPerOreTonne / cadToUsd(96.73)).toBeLessThan(1.15);
  });

  it('l’OPEX total croît avec le débit, et l’unitaire baisse (coûts fixes dilués)', () => {
    const small = computeUndergroundCost(inputs(600_000));
    const big = computeUndergroundCost(inputs(1_800_000));
    expect(big.totals.productionOpexUsd).toBeGreaterThan(small.totals.productionOpexUsd);
    expect(big.totals.opexUsdPerOreTonne).toBeLessThan(small.totals.opexUsdPerOreTonne);
  });

  it('dimensionne une flotte de production plus grande pour un débit plus élevé', () => {
    const lhd = (t: number) => computeUndergroundCost(inputs(t)).fleet.find(f => f.id === 'prod_lhd')!.units[2];
    expect(lhd(2_000_000)).toBeGreaterThan(lhd(500_000));
  });

  it('applique la contingence à tout le capital', () => {
    const r = computeUndergroundCost(inputs(1_000_000));
    const base = r.capex.filter(c => c.key !== 'contingency').reduce((s, c) => s + c.initialUsd + c.sustainingUsd, 0);
    const cont = r.capex.find(c => c.key === 'contingency')!;
    expect(cont.initialUsd + cont.sustainingUsd).toBeCloseTo(base * 0.3, 0);
  });
});
