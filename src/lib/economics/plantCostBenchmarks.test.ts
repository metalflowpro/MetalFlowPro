import { describe, it, expect } from 'vitest';
import {
  PLANT_CAPEX_BENCHMARKS, buildPlantCapexLines, buildPlantOpexLines, labourRowAnnualCost, opexSummary,
  plantCapexScaleFactor, plantStaffCount,
} from './plantCostBenchmarks';

describe('plantCapexScaleFactor — loi des six-dixièmes', () => {
  it('vaut 1 au débit de référence et suit (Q/Qref)^0,6', () => {
    expect(plantCapexScaleFactor(200)).toBeCloseTo(1, 12);
    expect(plantCapexScaleFactor(400)).toBeCloseTo(2 ** 0.6, 12);
  });
  it('n’est plus plafonné : une usine de 1 517 t/h coûte plus qu’une de 400 t/h', () => {
    // L'ancien facteur linéaire borné à 2 rendait ces deux usines identiques.
    expect(plantCapexScaleFactor(1517)).toBeGreaterThan(plantCapexScaleFactor(400));
    expect(plantCapexScaleFactor(1517)).toBeCloseTo((1517 / 200) ** 0.6, 9);
  });
  it('débit nul ou négatif → 0', () => {
    expect(plantCapexScaleFactor(0)).toBe(0);
    expect(plantCapexScaleFactor(-5)).toBe(0);
  });
});

describe('buildPlantCapexLines', () => {
  it('ne garde que les équipements actifs + les lignes fixes, mis à l’échelle', () => {
    const lines = buildPlantCapexLines({ sag: true, cil: true }, 200);
    const fixed = PLANT_CAPEX_BENCHMARKS.filter(b => b.equipIds.length === 0).length;
    expect(lines).toHaveLength(2 + fixed);
    expect(lines.find(l => l.description.startsWith('Broyeur SAG'))!.value_musd).toBe(18);
    const big = buildPlantCapexLines({ sag: true }, 400).find(l => l.description.startsWith('Broyeur SAG'))!;
    expect(big.value_musd).toBeCloseTo(18 * 2 ** 0.6, 2);
  });
  it('ne contient plus de ligne forfaitaire de travaux miniers (module Coûts miniers)', () => {
    expect(buildPlantCapexLines({}, 200).some(l => l.category === 'Travaux miniers')).toBe(false);
  });
});

describe('buildPlantOpexLines', () => {
  const base = {
    equip: { cil: true, sag: true }, tph: 250, annualTonnes: 2e6,
    measured: { nacnKgT: null, limeKgT: null, energyKwhT: null },
    criteria: { nacnKgT: null, limeKgT: null, ballKgT: null },
    electricityUsdKwh: 0.07, totalCapexMusd: 0,
  };
  it('le bilan massique prime sur les Critères, qui priment sur le repli', () => {
    const cn = (m: number | null, c: number | null) => buildPlantOpexLines({ ...base, measured: { ...base.measured, nacnKgT: m }, criteria: { ...base.criteria, nacnKgT: c } })
      .find(l => l.description.startsWith('NaCN'))!.value_usd_t;
    expect(cn(0.9, 0.3)).toBeGreaterThan(cn(null, 0.3));
    expect(cn(null, 0.3)).toBeLessThan(cn(null, null)); // repli 0,45 kg/t
  });
  it('la maintenance suit le CAPEX fourni (usine seule)', () => {
    const m = (capex: number) => buildPlantOpexLines({ ...base, totalCapexMusd: capex }).find(l => l.category === 'Maintenance')!.value_usd_t;
    expect(m(200)).toBeCloseTo(2 * m(100), 6);
  });
  it('effectif : économies d’échelle (10× le débit ≠ 10× le personnel)', () => {
    expect(plantStaffCount(1000)).toBeLessThan(10 * plantStaffCount(100));
    expect(plantStaffCount(50)).toBe(plantStaffCount(100));
  });
});

describe('main-d’œuvre & sommaire', () => {
  const row = { n_emp: 2, sal_base_h: 40, bonus_pct: 5, benefits_pct: 20, ot_pct: 10 };
  it('une seule formule : base + prime + avantages (sur base + prime) + heures sup.', () => {
    const c = labourRowAnnualCost(row, 2080);
    const base = 40 * 2080 * 2;
    expect(c.total).toBeCloseTo(base + base * 0.05 + base * 1.05 * 0.2 + base * 0.1, 6);
  });
  it('le total du sommaire = somme des lignes et les % font 100', () => {
    const s = opexSummary({
      labourRows: [row], powerRows: [{ kw_mec: 1000, eff_elec: 0.95, load_factor: 0.8, dispo: 90, h_j: 24 }],
      reagentRows: [{ conso_unit: 0.5, cost_unit: 2 }], mobileRows: [{ qty: 1, h_an: 2000, usd_h: 30 }],
      maintenanceUsdT: 1.5, annualTonnes: 1e6, electricityUsdKwh: 0.07, plantCapexMusd: 100,
    });
    expect(s.total).toBeCloseTo(s.rows.reduce((a, r) => a + r.value, 0), 6);
    expect(s.rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(100, 6);
  });
  it('une ligne de puissance au rendement nul ne produit pas d’infini', () => {
    const s = opexSummary({ labourRows: [], powerRows: [{ kw_mec: 10, eff_elec: 0, load_factor: 1, dispo: 100, h_j: 24 }], reagentRows: [], mobileRows: [], maintenanceUsdT: 0, annualTonnes: 0, electricityUsdKwh: 0.1, plantCapexMusd: 0 });
    expect(Number.isFinite(s.total)).toBe(true);
  });
});
