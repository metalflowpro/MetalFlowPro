import { describe, it, expect } from 'vitest';
import {
  recommendComminutionCircuit, circuitEnergyCostUsdT,
  CIRCUIT_SELECTION_THRESHOLDS, CIRCUIT_STAGE_TARGETS,
  type CircuitSelectionInputs,
} from './circuitSelection';

const T = CIRCUIT_SELECTION_THRESHOLDS;

/** Minerai tendre, broyage fin — cas nominal d'un SAB. */
const SOFT: CircuitSelectionInputs = {
  bwiKwhT: T.hardOreBwi - 3, romF80Um: 600_000, targetP80Um: 75, throughputTph: 500,
};

describe('garde-fous d\'entrée', () => {
  it('refuse des entrées non positives plutôt que de produire un circuit fantaisiste', () => {
    for (const bad of [
      { ...SOFT, bwiKwhT: 0 },
      { ...SOFT, romF80Um: 0 },
      { ...SOFT, targetP80Um: 0 },
    ]) {
      const r = recommendComminutionCircuit(bad);
      expect(r.recommended).toBeNull();
      expect(r.options).toHaveLength(0);
    }
  });

  it('refuse un P80 cible plus grossier que le ROM (aucune réduction à faire)', () => {
    const r = recommendComminutionCircuit({ ...SOFT, targetP80Um: SOFT.romF80Um + 1 });
    expect(r.recommended).toBeNull();
    expect(r.summary).toMatch(/aucune réduction/i);
  });
});

describe('sélection selon la dureté', () => {
  it('retient un SAB sur minerai tendre (pas de concasseur à galets inutile)', () => {
    const r = recommendComminutionCircuit(SOFT);
    expect(r.recommended?.id).toBe('sab');
  });

  it('écarte le SAB sur minerai dur — les galets s\'accumulent dans le SAG', () => {
    const hard = recommendComminutionCircuit({ ...SOFT, bwiKwhT: T.hardOreBwi + 2 });
    const sab = hard.options.find(o => o.id === 'sab')!;
    expect(sab.eligible).toBe(false);
    expect(sab.rationale).toMatch(/galets/i);
    expect(hard.recommended?.id).not.toBe('sab');
  });

  it('n\'ouvre le HPGR que sur minerai très dur ET débit suffisant', () => {
    const justHard = recommendComminutionCircuit({ ...SOFT, bwiKwhT: T.veryHardOreBwi - 1, throughputTph: T.hpgrMinThroughputTph });
    expect(justHard.options.find(o => o.id === 'hpgr_ball')!.eligible).toBe(false);

    const veryHardLowTonnage = recommendComminutionCircuit({ ...SOFT, bwiKwhT: T.veryHardOreBwi + 2, throughputTph: T.hpgrMinThroughputTph - 1 });
    const opt = veryHardLowTonnage.options.find(o => o.id === 'hpgr_ball')!;
    expect(opt.eligible).toBe(false);
    expect(opt.rationale).toMatch(/amortit/i);

    const veryHardHighTonnage = recommendComminutionCircuit({ ...SOFT, bwiKwhT: T.veryHardOreBwi + 2, throughputTph: T.hpgrMinThroughputTph + 500 });
    expect(veryHardHighTonnage.options.find(o => o.id === 'hpgr_ball')!.eligible).toBe(true);
  });
});

describe('sélection selon la finesse visée', () => {
  it('écarte le SAG seul dès qu\'un broyage fin est demandé', () => {
    const fine = recommendComminutionCircuit({ ...SOFT, targetP80Um: T.singleSagMaxFinenessUm - 50 });
    const single = fine.options.find(o => o.id === 'single_sag')!;
    expect(single.eligible).toBe(false);
    expect(single.rationale).toMatch(/boulets/i);
  });

  it('autorise le SAG seul sur un produit grossier et un minerai tendre', () => {
    const coarse = recommendComminutionCircuit({ ...SOFT, targetP80Um: T.singleSagMaxFinenessUm + 100 });
    expect(coarse.options.find(o => o.id === 'single_sag')!.eligible).toBe(true);
  });
});

describe('énergie et cohérence des étages', () => {
  it('enchaîne les étages du grossier au fin, sans discontinuité', () => {
    const r = recommendComminutionCircuit(SOFT);
    const stages = r.recommended!.stages;
    for (const s of stages) {
      expect(s.p80Um, s.label).toBeLessThan(s.f80Um);          // chaque étage réduit
      expect(s.specificEnergyKwhT, s.label).toBeGreaterThan(0); // et consomme
    }
    // Le premier étage part du ROM, le dernier atteint la cible.
    expect(stages[0].f80Um).toBe(SOFT.romF80Um);
    expect(stages[stages.length - 1].p80Um).toBe(SOFT.targetP80Um);
  });

  it('somme l\'énergie des étages dans le total', () => {
    const opt = recommendComminutionCircuit(SOFT).recommended!;
    const sum = opt.stages.reduce((s, st) => s + st.specificEnergyKwhT, 0);
    expect(opt.totalEnergyKwhT).toBeCloseTo(sum, 10);
  });

  it('déduit la puissance requise du débit, et l\'omet sans débit', () => {
    const withTph = recommendComminutionCircuit(SOFT).recommended!;
    expect(withTph.powerRequiredKw).toBeCloseTo(withTph.totalEnergyKwhT * 500, 6);

    const noTph = recommendComminutionCircuit({ ...SOFT, throughputTph: null }).recommended!;
    expect(noTph.powerRequiredKw).toBeNull();
  });

  it('demande plus d\'énergie pour un broyage plus fin', () => {
    const coarse = recommendComminutionCircuit({ ...SOFT, targetP80Um: 150 }).recommended!;
    const fine = recommendComminutionCircuit({ ...SOFT, targetP80Um: 45 }).recommended!;
    expect(fine.totalEnergyKwhT).toBeGreaterThan(coarse.totalEnergyKwhT);
  });

  it('ne place jamais le produit du concassage primaire au-dessus du ROM', () => {
    // Sur un ROM déjà fin, la cible de concassage primaire doit s'y adapter.
    const smallRom = recommendComminutionCircuit({ ...SOFT, romF80Um: 50_000 }).recommended!;
    expect(smallRom.stages[0].p80Um).toBeLessThan(50_000);
  });
});

describe('classement et recommandation', () => {
  it('place les configurations éligibles avant les écartées', () => {
    const r = recommendComminutionCircuit(SOFT);
    const firstIneligible = r.options.findIndex(o => !o.eligible);
    if (firstIneligible >= 0) {
      for (let i = firstIneligible; i < r.options.length; i++) {
        expect(r.options[i].eligible, r.options[i].id).toBe(false);
      }
    }
  });

  it('recommande toujours une option éligible, ou aucune', () => {
    const r = recommendComminutionCircuit(SOFT);
    expect(r.recommended!.eligible).toBe(true);
    expect(r.options[0]).toBe(r.recommended);
  });

  it('justifie chaque configuration, retenue comme écartée', () => {
    for (const o of recommendComminutionCircuit(SOFT).options) {
      expect(o.rationale.length, o.id).toBeGreaterThan(0);
    }
  });

  it('résume le choix avec l\'énergie et les bornes granulométriques', () => {
    const r = recommendComminutionCircuit(SOFT);
    expect(r.summary).toContain('kWh/t');
  });
});

describe('coût énergétique', () => {
  it('croît avec le prix du kWh et avec l\'énergie', () => {
    const opt = recommendComminutionCircuit(SOFT).recommended!;
    expect(circuitEnergyCostUsdT(opt, 0.10)).toBeCloseTo(opt.totalEnergyKwhT * 0.10, 10);
    expect(circuitEnergyCostUsdT(opt, 0.20)).toBeGreaterThan(circuitEnergyCostUsdT(opt, 0.10));
  });
});

describe('cibles d\'étage', () => {
  it('décroissent du concassage primaire au SAG', () => {
    const S = CIRCUIT_STAGE_TARGETS;
    expect(S.primaryCrushP80Um).toBeGreaterThan(S.secondaryCrushP80Um);
    expect(S.secondaryCrushP80Um).toBeGreaterThan(S.tertiaryCrushP80Um);
    expect(S.tertiaryCrushP80Um).toBeGreaterThan(S.hpgrP80Um);
    expect(S.hpgrP80Um).toBeGreaterThan(S.sagP80Um);
  });

  it('garde des seuils de dureté ordonnés', () => {
    expect(T.hardOreBwi).toBeLessThan(T.veryHardOreBwi);
  });
});
