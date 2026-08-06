import { describe, it, expect } from 'vitest';
import {
  predictRecovery, predictNacn, predictCao,
  RECOVERY_MODEL, NACN_MODEL, CAO_MODEL,
  BLEND_GRADE_WINDOW, DEFAULT_BLEND_QUALITY_LIMITS,
} from './engine';

// Ces tests verrouillent le COMPORTEMENT MONOTONE et les bornes des corrélations
// métallurgiques, pas leurs coefficients exacts — ces derniers doivent rester
// recalibrables par gisement (voir le bloc de doc dans engine.ts). Ils attrapent
// une inversion de signe ou une faute de saisie lors d'un recalage.

describe('predictRecovery — corrélation de récupération Au', () => {
  it('atteint la récupération de base sur un minerai propre et bien titré', () => {
    const M = RECOVERY_MODEL;
    // Aucun facteur pénalisant : sulfures et PRC sous seuil, BWi sous seuil,
    // teneur au-dessus du seuil de basse teneur.
    expect(predictRecovery(M.lowGradeThresholdGt, M.sulfidesThresholdPct, M.prcThresholdPct, M.bwiThreshold))
      .toBeCloseTo(M.basePct, 10);
  });

  it('décroît quand les sulfures augmentent au-delà du seuil', () => {
    const M = RECOVERY_MODEL;
    const clean = predictRecovery(5, M.sulfidesThresholdPct, 0, null);
    const sulphidic = predictRecovery(5, M.sulfidesThresholdPct + 4, 0, null);
    expect(sulphidic).toBeLessThan(clean);
  });

  it('pénalise fortement le carbone organique préempteur (PRC)', () => {
    const M = RECOVERY_MODEL;
    const clean = predictRecovery(5, 0, M.prcThresholdPct, null);
    const carbonaceous = predictRecovery(5, 0, M.prcThresholdPct + 1, null);
    expect(carbonaceous).toBeLessThan(clean);
    // Le PRC est le facteur le plus pénalisant par unité (préemption de l'or).
    expect(M.prcPenaltyPerPct).toBeGreaterThan(M.sulfidesPenaltyPerPct);
  });

  it('ne pénalise le BWi que lorsqu\'il dépasse le seuil, et ignore un BWi absent', () => {
    const M = RECOVERY_MODEL;
    const soft = predictRecovery(5, 0, 0, M.bwiThreshold);
    const hard = predictRecovery(5, 0, 0, M.bwiThreshold + 6);
    expect(hard).toBeLessThan(soft);
    // BWi non mesuré ⇒ aucune pénalité, pas un NaN.
    expect(predictRecovery(5, 0, 0, null)).toBeCloseTo(soft, 10);
  });

  it('pénalise la basse teneur (pertes relatives plus fortes)', () => {
    const M = RECOVERY_MODEL;
    expect(predictRecovery(0.5, 0, 0, null)).toBeLessThan(predictRecovery(M.lowGradeThresholdGt, 0, 0, null));
  });

  it('reste borné même sur des entrées extrêmes', () => {
    const M = RECOVERY_MODEL;
    expect(predictRecovery(0, 50, 10, 40)).toBe(M.minPct);   // minerai catastrophique
    expect(M.maxPct).toBeLessThan(100);                      // aucune récupération totale
  });

  it('ne dépasse jamais la récupération de base (le modèle ne fait que pénaliser)', () => {
    const M = RECOVERY_MODEL;
    // Le plafond maxPct est DÉFENSIF : il n'est pas atteignable tant que le
    // modèle part de basePct et ne fait que soustraire. Ce test documente cet
    // invariant — si un terme BONIFIANT est ajouté un jour, il faudra
    // décider explicitement s'il peut dépasser basePct.
    expect(predictRecovery(100, 0, 0, 0)).toBe(M.basePct);
    expect(M.basePct).toBeLessThanOrEqual(M.maxPct);
  });
});

describe('predictNacn — consommation de cyanure', () => {
  it('croît avec la teneur en or et avec les sulfures cyanicides', () => {
    expect(predictNacn(5, 0)).toBeGreaterThan(predictNacn(1, 0));
    expect(predictNacn(1, 5)).toBeGreaterThan(predictNacn(1, 0));
  });

  it('reste dans les bornes déclarées', () => {
    expect(predictNacn(0, 0)).toBeGreaterThanOrEqual(NACN_MODEL.minKgT);
    expect(predictNacn(100, 100)).toBe(NACN_MODEL.maxKgT);
  });
});

describe('predictCao — consommation de chaux', () => {
  it('croît avec les sulfures (acidité générée) et le carbone organique', () => {
    expect(predictCao(5, 0)).toBeGreaterThan(predictCao(0, 0));
    expect(predictCao(0, 2)).toBeGreaterThan(predictCao(0, 0));
  });

  it('reste dans les bornes déclarées', () => {
    expect(predictCao(0, 0)).toBeGreaterThanOrEqual(CAO_MODEL.minKgT);
    expect(predictCao(100, 100)).toBe(CAO_MODEL.maxKgT);
  });
});

describe('contraintes de mélange (spécification d\'alimentation)', () => {
  it('encadre la teneur cible, sans inverser min et max', () => {
    expect(BLEND_GRADE_WINDOW.minFactor).toBeGreaterThan(0);
    expect(BLEND_GRADE_WINDOW.minFactor).toBeLessThan(1);
    expect(BLEND_GRADE_WINDOW.maxFactor).toBeGreaterThan(1);
  });

  it('applique des plafonds de contaminants strictement positifs et fractionnaires', () => {
    const L = DEFAULT_BLEND_QUALITY_LIMITS;
    for (const [k, v] of Object.entries(L)) {
      expect(v, k).toBeGreaterThan(0);
    }
    // Contaminants exprimés en % : un plafond > 100 % n'aurait pas de sens.
    for (const k of ['maxSulfidesPct', 'maxPrcPct', 'maxClayPct'] as const) {
      expect(L[k], k).toBeLessThanOrEqual(100);
    }
  });

  it('tolère moins de carbone organique que de sulfures', () => {
    // Le carbone préempteur nuit à des teneurs bien plus faibles que les sulfures.
    expect(DEFAULT_BLEND_QUALITY_LIMITS.maxPrcPct)
      .toBeLessThan(DEFAULT_BLEND_QUALITY_LIMITS.maxSulfidesPct);
  });
});

describe('cohérence des bornes de tous les modèles', () => {
  it('a toujours un minimum strictement inférieur au maximum', () => {
    expect(RECOVERY_MODEL.minPct).toBeLessThan(RECOVERY_MODEL.maxPct);
    expect(NACN_MODEL.minKgT).toBeLessThan(NACN_MODEL.maxKgT);
    expect(CAO_MODEL.minKgT).toBeLessThan(CAO_MODEL.maxKgT);
  });

  it('n\'utilise que des pénalités positives (une pénalité négative serait un bonus)', () => {
    const M = RECOVERY_MODEL;
    for (const p of [M.sulfidesPenaltyPerPct, M.prcPenaltyPerPct, M.bwiPenaltyPerUnit, M.lowGradePenaltyPerGt]) {
      expect(p).toBeGreaterThan(0);
    }
  });
});
