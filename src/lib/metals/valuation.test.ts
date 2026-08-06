import { describe, it, expect } from 'vitest';
import {
  containedUnitsPerTonne, recoverableUnitsPerTonne, metalValuePerTonne,
  revenuePerTonne, metalEquivalent, type MetalAssay,
} from './valuation';

// Bloc-test NSR réel du projet Morrison (Feasibility Study, Table 4.6) :
// Cu 0,371 % @ 81,83 % / 2,45 $/lb ; Au 0,191 g/t @ 49,48 % / 570 $/oz ;
// Mo 0,004 % @ 50 % / 28 $/lb. Sert de jeu de validation bout-en-bout — ces
// valeurs ne sont PAS codées dans l'app, seulement dans ce test.
const CU: MetalAssay = { symbol: 'Cu', grade: 0.371, recovery: 0.8183, price: 2.45 };
const AU: MetalAssay = { symbol: 'Au', grade: 0.191, recovery: 0.4948, price: 570 };
const MO: MetalAssay = { symbol: 'Mo', grade: 0.004, recovery: 0.50, price: 28 };

describe('masse contenue', () => {
  it('1 % de Cu dans 1 t ≈ 22,05 lb', () => {
    expect(containedUnitsPerTonne('Cu', 1)).toBeCloseTo(22.0462, 3);
  });
  it('récupérable = contenu × récupération × payable', () => {
    const a: MetalAssay = { ...CU, payable: 0.96 };
    expect(recoverableUnitsPerTonne(a)).toBeCloseTo(containedUnitsPerTonne('Cu', 0.371) * 0.8183 * 0.96, 6);
  });
});

describe('valeur par tonne', () => {
  it('valeur brute Cu du bloc Morrison ≈ 16,4 $/t (le NSR après TC/RC, 14,33 $/t, est plus bas)', () => {
    const v = metalValuePerTonne(CU);
    expect(v).toBeGreaterThan(16.0);
    expect(v).toBeLessThan(16.8);
    // Cohérence : la valeur brute doit dépasser le NSR net de fonderie du rapport.
    expect(v).toBeGreaterThan(14.33);
  });

  it('valeur brute Au du bloc Morrison ≈ 1,7 $/t', () => {
    expect(metalValuePerTonne(AU)).toBeCloseTo(1.73, 1);
  });

  it('revenuePerTonne additionne le panier', () => {
    const total = revenuePerTonne([CU, AU, MO]);
    expect(total).toBeCloseTo(metalValuePerTonne(CU) + metalValuePerTonne(AU) + metalValuePerTonne(MO), 9);
  });
});

describe('équivalent-métal (CuEq)', () => {
  it('sans métal secondaire, CuEq = teneur Cu', () => {
    expect(metalEquivalent([CU], { primary: 'Cu' })).toBeCloseTo(CU.grade, 9);
  });

  it('CuEq du bloc Morrison ≈ 0,438 % (Cu + crédits Au + Mo, récupérations incluses)', () => {
    expect(metalEquivalent([CU, AU, MO], { primary: 'Cu' })).toBeCloseTo(0.438, 2);
  });

  it('ajouter un crédit augmente strictement le CuEq (monotonie)', () => {
    const base = metalEquivalent([CU], { primary: 'Cu' });
    const withAu = metalEquivalent([CU, AU], { primary: 'Cu' });
    expect(withAu).toBeGreaterThan(base);
  });

  it('useRecovery change le chiffre et est explicite (in situ > récupérable ici)', () => {
    const recov = metalEquivalent([CU, AU, MO], { primary: 'Cu', useRecovery: true });
    const insitu = metalEquivalent([CU, AU, MO], { primary: 'Cu', useRecovery: false });
    expect(insitu).not.toBeCloseTo(recov, 4);
  });

  it('lève si le métal de référence est absent du panier', () => {
    expect(() => metalEquivalent([AU, MO], { primary: 'Cu' })).toThrow(/référence/);
  });

  it('un AuEq d’un panier or-seul vaut la teneur Au', () => {
    expect(metalEquivalent([AU], { primary: 'Au' })).toBeCloseTo(AU.grade, 9);
  });
});
