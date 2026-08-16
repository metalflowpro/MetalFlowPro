import { describe, it, expect } from 'vitest';
import {
  moduleSyncStatus, chainSyncReport, SYNC_TOLERANCE_MS,
  DOWNSTREAM_LABELS, DOWNSTREAM_SOURCE, type ChainTimestamps,
} from './syncStatus';

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 16, 12, minutes, 0)).toISOString();

/** Chaîne saine : critères, puis flowsheet, puis les deux modules aval. */
const SAINE: ChainTimestamps = {
  criteriaAt: at(0), flowsheetAt: at(5), massBalanceAt: at(10), equipmentAt: at(12),
};

describe('la chaîne de dépendance est respectée', () => {
  it('le flowsheet dérive des critères, le bilan et les équipements du FLOWSHEET', () => {
    // C'est ce que trois boutons indépendants ne disent pas : régénérer le bilan
    // avant le flowsheet reproduirait l'ancien circuit.
    expect(DOWNSTREAM_SOURCE.flowsheet).toBe('criteria');
    expect(DOWNSTREAM_SOURCE.massbalance).toBe('flowsheet');
    expect(DOWNSTREAM_SOURCE.equipment).toBe('flowsheet');
  });

  it('le rapport suit l\'ordre de la chaîne', () => {
    expect(chainSyncReport(SAINE).statuses.map(s => s.module))
      .toEqual(['flowsheet', 'massbalance', 'equipment']);
  });

  it('une chaîne saine est entièrement à jour', () => {
    const r = chainSyncReport(SAINE);
    expect(r.allCurrent).toBe(true);
    expect(r.outOfDate).toHaveLength(0);
  });
});

describe('détection de péremption', () => {
  it('modifier les critères périme le flowsheet — le cas du rebroyage coché', () => {
    const ts = { ...SAINE, criteriaAt: at(30) };
    const s = moduleSyncStatus('flowsheet', ts);
    expect(s.state).toBe('stale');
    expect(s.message).toMatch(/Critères de conception a été modifié/);
    expect(s.behindMinutes).toBe(25);
  });

  it('modifier les critères périme TOUTE la chaîne aval', () => {
    // Le bilan et les équipements dérivent du flowsheet : tant qu'il n'est pas
    // régénéré ils ne sont pas encore périmés vis-à-vis de LUI, mais le rapport
    // doit tout de même conduire l'utilisateur à régénérer dans l'ordre.
    const r = chainSyncReport({ ...SAINE, criteriaAt: at(30) });
    expect(r.allCurrent).toBe(false);
    expect(r.outOfDate.map(s => s.module)).toEqual(['flowsheet']);

    // Une fois le flowsheet régénéré, l'aval devient à son tour périmé.
    const apres = chainSyncReport({ ...SAINE, criteriaAt: at(30), flowsheetAt: at(35) });
    expect(apres.outOfDate.map(s => s.module)).toEqual(['massbalance', 'equipment']);
  });

  it('régénérer le flowsheet périme le bilan et les équipements', () => {
    const ts = { ...SAINE, flowsheetAt: at(40) };
    expect(moduleSyncStatus('massbalance', ts).state).toBe('stale');
    expect(moduleSyncStatus('equipment', ts).state).toBe('stale');
    expect(moduleSyncStatus('massbalance', ts).sourceLabel).toBe(DOWNSTREAM_LABELS.flowsheet);
  });

  it('un module jamais généré est « manquant », pas « périmé »', () => {
    const s = moduleSyncStatus('equipment', { ...SAINE, equipmentAt: null });
    expect(s.state).toBe('missing');
    expect(s.message).toMatch(/jamais été généré/);
  });

  it('sans source horodatée, on n\'invente aucune alerte', () => {
    // Un faux positif provoquerait une régénération DESTRUCTIVE inutile.
    expect(moduleSyncStatus('flowsheet', { ...SAINE, criteriaAt: null }).state).toBe('current');
    expect(moduleSyncStatus('equipment', { ...SAINE, flowsheetAt: null }).state).toBe('current');
  });
});

describe('tolérance et robustesse', () => {
  it('une génération déclenchée juste après la saisie reste à jour', () => {
    const base = Date.UTC(2026, 7, 16, 12, 0, 0);
    const ts: ChainTimestamps = {
      criteriaAt: new Date(base + SYNC_TOLERANCE_MS - 100).toISOString(),
      flowsheetAt: new Date(base).toISOString(),
      massBalanceAt: null, equipmentAt: null,
    };
    expect(moduleSyncStatus('flowsheet', ts).state).toBe('current');
  });

  it('au-delà de la tolérance, la péremption est signalée', () => {
    const base = Date.UTC(2026, 7, 16, 12, 0, 0);
    const ts: ChainTimestamps = {
      criteriaAt: new Date(base + SYNC_TOLERANCE_MS + 60_000).toISOString(),
      flowsheetAt: new Date(base).toISOString(),
      massBalanceAt: null, equipmentAt: null,
    };
    expect(moduleSyncStatus('flowsheet', ts).state).toBe('stale');
  });

  it('un horodatage illisible est traité comme absent, sans planter', () => {
    const ts: ChainTimestamps = {
      criteriaAt: 'pas-une-date', flowsheetAt: at(5), massBalanceAt: at(6), equipmentAt: at(7),
    };
    expect(moduleSyncStatus('flowsheet', ts).state).toBe('current');
    expect(() => chainSyncReport(ts)).not.toThrow();
  });

  it('chaîne entièrement vierge : tout est manquant, rien n\'est en erreur', () => {
    const r = chainSyncReport({ criteriaAt: null, flowsheetAt: null, massBalanceAt: null, equipmentAt: null });
    expect(r.outOfDate.map(s => s.state)).toEqual(['missing', 'missing', 'missing']);
    expect(r.allCurrent).toBe(false);
  });

  it('chaque statut porte un message exploitable', () => {
    for (const s of chainSyncReport({ ...SAINE, criteriaAt: at(30) }).statuses) {
      expect(s.message.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
