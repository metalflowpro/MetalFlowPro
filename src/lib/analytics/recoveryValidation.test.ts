import { describe, it, expect } from 'vitest';
import { crossValidateRecovery, recommendGrind } from './recoveryValidation';
import { trainRecoveryModel, type TrainingSample } from './recoveryModel';

/**
 * Génère un jeu où la récupération suit une vraie relation linéaire bruitée :
 * plus le P80 est fin (petit) et l'or libre élevé, plus la récupération monte.
 */
function syntheticSamples(n: number, noise = 0): TrainingSample[] {
  const out: TrainingSample[] = [];
  for (let i = 0; i < n; i++) {
    // Chaque variable suit un cycle de période différente (2,3,4,5,7,9,11)
    // pour éviter toute colinéarité qui rendrait la matrice singulière.
    const p80 = 40 + (i % 10) * 12;      // 40 → 148 µm
    const auFree = 50 + (i % 5) * 8;     // 50 → 82 %
    const sSulfide = 1 + (i % 4) * 0.5;
    const auGrade = 2 + (i % 3);
    const cOrganic = 0.05 + (i % 7) * 0.06;
    const bwi = 12 + (i % 9) * 0.4;
    const grg = 20 + (i % 11) * 2.5;
    // récup = 95 − 0.08·p80 + 0.15·auFree − 1.2·sSulfide (+ bruit déterministe)
    const det = 95 - 0.08 * p80 + 0.15 * auFree - 1.2 * sSulfide;
    const wobble = noise * ((i * 37) % 11 - 5);
    out.push({
      auGrade, sSulfide, cOrganic, bwi, grg, p80, auFree,
      recovery: Math.max(50, Math.min(98, det + wobble)),
    });
  }
  return out;
}

describe('crossValidateRecovery', () => {
  it('signale un jeu trop petit sans prétendre valider', () => {
    const cv = crossValidateRecovery(syntheticSamples(7));
    expect(cv?.verdict).toBe('insuffisant');
    expect(cv?.message).toContain('essais');
  });

  it('juge robuste un signal linéaire propre', () => {
    const cv = crossValidateRecovery(syntheticSamples(30, 0));
    expect(cv).not.toBeNull();
    expect(cv!.cvRSquared).toBeGreaterThan(0.6);
    expect(cv!.verdict).toBe('robuste');
    expect(cv!.folds).toBeGreaterThanOrEqual(2);
  });

  it('donne un R² hors échantillon inférieur ou proche de l\'in-sample', () => {
    const cv = crossValidateRecovery(syntheticSamples(24, 3));
    expect(cv).not.toBeNull();
    // le hors-échantillon ne doit jamais dépasser nettement l'in-sample
    expect(cv!.cvRSquared).toBeLessThanOrEqual(cv!.inSampleRSquared + 0.05);
  });

  it('détecte le sur-apprentissage sur une cible décorrélée', () => {
    // Variables toutes variables (aucune constante), mais récupération sans
    // lien avec elles : le modèle in-sample colle au bruit, le hors-échantillon
    // s'effondre. C'est le cas d'école du sur-apprentissage.
    const noise: TrainingSample[] = Array.from({ length: 22 }, (_, i) => ({
      auGrade: 1 + (i % 5), sSulfide: 0.5 + (i % 4) * 0.7, cOrganic: 0.05 + (i % 6) * 0.05,
      bwi: 11 + (i % 7) * 0.6, grg: 15 + (i % 9) * 2, p80: 40 + (i % 8) * 14,
      auFree: 45 + (i % 10) * 4,
      recovery: 70 + ((i * 53) % 17), // sans corrélation avec les variables
    }));
    const cv = crossValidateRecovery(noise);
    expect(cv).not.toBeNull();
    expect(Number.isNaN(cv!.cvRSquared)).toBe(false);
    // l'in-sample gonfle, le hors-échantillon s'effondre → CV nettement plus bas
    expect(cv!.cvRSquared).toBeLessThan(cv!.inSampleRSquared);
    expect(cv!.cvRSquared).toBeLessThan(0.5);
  });

  it('adapte le nombre de plis à la taille de l\'échantillon', () => {
    const cv = crossValidateRecovery(syntheticSamples(14), 5);
    expect(cv!.folds).toBeLessThanOrEqual(5);
    expect(cv!.folds).toBeGreaterThanOrEqual(2);
  });
});

describe('recommendGrind', () => {
  const model = trainRecoveryModel(syntheticSamples(30, 0))!;
  const current = { auGrade: 3, sSulfide: 1.5, cOrganic: 0.2, bwi: 14, grg: 25, p80: 120, auFree: 65 };

  it('recommande de broyer plus fin quand le modèle lie finesse et récupération', () => {
    const { recommendation, scan } = recommendGrind(model, current, { p80Min: 40, p80Max: 200 });
    // le signal synthétique : récup ↑ quand p80 ↓ → optimum au bord fin
    expect(recommendation.optimalP80).toBeLessThan(current.p80);
    expect(recommendation.direction).toBe('broyer_plus_fin');
    expect(recommendation.gainPct).toBeGreaterThan(0);
    expect(scan.length).toBeGreaterThan(10);
  });

  it('chiffre le gain et l\'effet marginal', () => {
    const { recommendation } = recommendGrind(model, current, { p80Min: 40, p80Max: 200 });
    expect(recommendation.predictedRecovery).toBeGreaterThan(recommendation.currentRecovery);
    expect(recommendation.marginalPerUm).toBeLessThan(0); // récup baisse quand p80 augmente
    expect(recommendation.message).toContain('récupération');
  });

  it('recommande de maintenir si le point courant est déjà optimal', () => {
    // P80 courant au bord fin de la plage → aucun gain possible plus fin.
    const atOptimum = { ...current, p80: 40 };
    const { recommendation } = recommendGrind(model, atOptimum, { p80Min: 40, p80Max: 200 });
    expect(recommendation.direction).toBe('maintenir');
  });

  it('marque la recommandation peu fiable quand la validation croisée est faible', () => {
    const weakCv = { folds: 3, cvRSquared: 0.1, cvRmse: 8, inSampleRSquared: 0.9, overfitGap: 0.8, verdict: 'surajusté' as const, message: '' };
    const { recommendation } = recommendGrind(model, current, { p80Min: 40, p80Max: 200, cv: weakCv });
    expect(recommendation.confident).toBe(false);
    if (recommendation.direction !== 'maintenir') {
      expect(recommendation.message).toContain('Confiance limitée');
    }
  });

  it('NE recommande JAMAIS de broyer plus grossier même si le modèle a un signe P80 non physique', () => {
    // Jeu artefact : la récupération MONTE avec un P80 grossier (colinéarité) —
    // physiquement impossible. Le modèle ajuste alors un coefficient P80 > 0.
    const reversed: TrainingSample[] = [];
    for (let i = 0; i < 30; i++) {
      const p80 = 40 + (i % 10) * 12;
      const auFree = 50 + (i % 5) * 8;
      const sSulfide = 1 + (i % 4) * 0.5;
      // récup CROÎT avec p80 (signal inversé, non physique)
      reversed.push({
        auGrade: 2 + (i % 3), sSulfide, cOrganic: 0.05 + (i % 7) * 0.06,
        bwi: 12 + (i % 9) * 0.4, grg: 20 + (i % 11) * 2.5, p80, auFree,
        recovery: Math.max(50, Math.min(98, 70 + 0.10 * p80 + 0.15 * auFree - 1.2 * sSulfide)),
      });
    }
    const badModel = trainRecoveryModel(reversed)!;
    // La régression sous contraintes de signe retire le P80 (signe positif
    // non physique) : coefficient ≤ 0, jamais positif.
    expect(badModel.coefficients.p80).toBeLessThanOrEqual(0);
    const cur = { auGrade: 3, sSulfide: 1.5, cOrganic: 0.2, bwi: 14, grg: 25, p80: 100, auFree: 65 };
    const { recommendation } = recommendGrind(badModel, cur, { p80Min: 40, p80Max: 200 });
    expect(recommendation.direction).not.toBe('broyer_plus_grossier');
    expect(recommendation.direction).toBe('maintenir');
    expect(recommendation.confident).toBe(false);
    expect(recommendation.gainPct).toBe(0);
  });
});
