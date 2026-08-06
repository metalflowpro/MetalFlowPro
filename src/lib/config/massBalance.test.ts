import { describe, it, expect } from 'vitest';
import {
  GROUP_ENERGY_KWH_T, GROUP_CN_KG_T, GROUP_LIME_KG_T,
  GROUP_SOLIDS_PCT, GROUP_MASS_FACTOR, GROUP_AU_FACTORS,
  GROUP_ABSOLUTE_MASS_TPH, GROUP_ABSOLUTE_AU_GT,
  GRAV_BLEED_OF_UF, GRAVITY_PULL, OXIDATION_MIN_MASS_PULL,
} from './massBalance';

// Verrouille la COHÉRENCE PHYSIQUE des paramètres de flux, pas leurs valeurs
// exactes (qui sont des consignes d'exploitation ajustables par site). Attrape
// une faute d'échelle lors d'un recalage — un % solides à 650, un ratio inversé.

describe('% solides', () => {
  it('reste dans [0, 100] pour tous les groupes', () => {
    for (const [grp, pct] of Object.entries(GROUP_SOLIDS_PCT)) {
      expect(pct, grp).toBeGreaterThanOrEqual(0);
      expect(pct, grp).toBeLessThanOrEqual(100);
    }
  });

  it('donne 100 % aux étages secs et 0 % aux solutions claires', () => {
    // Concassage/criblage/tas : pas de pulpe. Ces étages ne doivent jamais être
    // traités comme une pulpe, sinon le calcul d'eau de procédé diverge.
    for (const grp of ['Ali', 'Crush', 'Screen', 'Heap'] as const) {
      expect(GROUP_SOLIDS_PCT[grp], grp).toBe(100);
    }
    // Solutions (PLS, ADR, éluat, Merrill-Crowe) : pas de solides.
    for (const grp of ['PLS', 'ADR', 'Elut', 'MC'] as const) {
      expect(GROUP_SOLIDS_PCT[grp], grp).toBe(0);
    }
  });

  it('épaissit puis filtre : le % solides doit monter le long de la chaîne', () => {
    expect(GROUP_SOLIDS_PCT.Thick).toBeGreaterThan(GROUP_SOLIDS_PCT.Float);
    expect(GROUP_SOLIDS_PCT.Filt).toBeGreaterThan(GROUP_SOLIDS_PCT.Thick);
  });
});

describe('ratios massiques', () => {
  it('sont strictement positifs', () => {
    for (const [grp, f] of Object.entries(GROUP_MASS_FACTOR)) {
      expect(f, grp).toBeGreaterThan(0);
    }
  });

  it('concentre fortement en gravimétrie et déshydrate en filtration', () => {
    // Un concentré gravimétrique est une fraction infime de l'alimentation.
    expect(GROUP_MASS_FACTOR.GravConc).toBeLessThan(0.01);
    // La filtration retire de l'eau : la masse diminue.
    expect(GROUP_MASS_FACTOR.Filt).toBeLessThan(1);
  });

  it('donne aux solutions un ratio liquide/solide supérieur à 1', () => {
    for (const grp of ['PLS', 'ADR', 'MC'] as const) {
      expect(GROUP_MASS_FACTOR[grp], grp).toBeGreaterThan(1);
    }
  });
});

describe('circuit gravité', () => {
  it('ne soutire qu\'une fraction de la sousverse', () => {
    expect(GRAV_BLEED_OF_UF).toBeGreaterThan(0);
    expect(GRAV_BLEED_OF_UF).toBeLessThan(1);
  });

  it('compose des rendements < 1 et plafonne le tirage', () => {
    expect(GRAVITY_PULL.passEfficiency).toBeGreaterThan(0);
    expect(GRAVITY_PULL.passEfficiency).toBeLessThan(1);
    expect(GRAVITY_PULL.ilrEfficiency).toBeGreaterThan(0);
    expect(GRAVITY_PULL.ilrEfficiency).toBeLessThanOrEqual(1);
    expect(GRAVITY_PULL.maxPull).toBeLessThan(1);
    // Même à 100 % de GRG, le tirage composé reste sous le plafond.
    expect(GRAVITY_PULL.passEfficiency * GRAVITY_PULL.ilrEfficiency).toBeLessThan(GRAVITY_PULL.maxPull);
  });
});

describe('facteurs or', () => {
  it('enrichit le concentré gravimétrique', () => {
    expect(GROUP_AU_FACTORS.gravConcUpgrade).toBeGreaterThan(1);
  });

  it('utilise des rendements de lixiviation dans ]0,1]', () => {
    for (const k of ['cilLeachEfficiency', 'leachEfficiency', 'floatRecovery'] as const) {
      expect(GROUP_AU_FACTORS[k], k).toBeGreaterThan(0);
      expect(GROUP_AU_FACTORS[k], k).toBeLessThanOrEqual(1);
    }
    // Un circuit CIL (charbon en lixiviation) dépasse une simple cuve de lixiviation.
    expect(GROUP_AU_FACTORS.cilLeachEfficiency).toBeGreaterThan(GROUP_AU_FACTORS.leachEfficiency);
  });

  it('répartit l\'or récupéré en parts fractionnaires', () => {
    for (const k of ['plsShare', 'adrShare', 'mcShare'] as const) {
      expect(GROUP_AU_FACTORS[k], k).toBeGreaterThan(0);
      expect(GROUP_AU_FACTORS[k], k).toBeLessThan(1);
    }
  });
});

describe('étages de fin de chaîne', () => {
  it('concentre l\'or de plusieurs ordres de grandeur, éluat → cathode → doré', () => {
    expect(GROUP_ABSOLUTE_AU_GT.Elut).toBeLessThan(GROUP_ABSOLUTE_AU_GT.EW);
    expect(GROUP_ABSOLUTE_AU_GT.EW).toBeLessThan(GROUP_ABSOLUTE_AU_GT.Smelt);
    // Le doré reste sous l'or pur (1 000 000 g/t).
    expect(GROUP_ABSOLUTE_AU_GT.Smelt).toBeLessThan(1_000_000);
  });

  it('réduit la masse à mesure que l\'or se concentre', () => {
    expect(GROUP_ABSOLUTE_MASS_TPH.Elut).toBeGreaterThan(GROUP_ABSOLUTE_MASS_TPH.EW);
    expect(GROUP_ABSOLUTE_MASS_TPH.EW).toBeGreaterThan(GROUP_ABSOLUTE_MASS_TPH.Smelt);
  });
});

describe('consommations par groupe', () => {
  it('n\'a aucune consommation négative', () => {
    for (const table of [GROUP_ENERGY_KWH_T, GROUP_CN_KG_T, GROUP_LIME_KG_T]) {
      for (const [grp, v] of Object.entries(table)) {
        expect(v, grp).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fait du broyage le poste énergétique dominant', () => {
    const grind = GROUP_ENERGY_KWH_T.Grind;
    for (const [grp, v] of Object.entries(GROUP_ENERGY_KWH_T)) {
      if (grp === 'Grind' || grp === 'POX') continue; // POX est thermique, hors comminution
      expect(v, grp).toBeLessThanOrEqual(grind);
    }
  });

  it('ne consomme cyanure et chaux que sur les étages concernés', () => {
    // Un étage de concassage qui consommerait du cyanure signalerait une clé erronée.
    for (const grp of ['Crush', 'Grind', 'Thick', 'Filt']) {
      expect(GROUP_CN_KG_T[grp], grp).toBeUndefined();
      expect(GROUP_LIME_KG_T[grp], grp).toBeUndefined();
    }
    // L'oxydation sous pression est le plus gros consommateur de chaux (neutralisation).
    expect(GROUP_LIME_KG_T.POX).toBeGreaterThan(GROUP_LIME_KG_T.CIL);
  });
});

describe('plancher d\'oxydation', () => {
  it('garde un rendement pondéral plancher fractionnaire', () => {
    expect(OXIDATION_MIN_MASS_PULL).toBeGreaterThan(0);
    expect(OXIDATION_MIN_MASS_PULL).toBeLessThan(1);
  });
});
