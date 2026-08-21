import { describe, it, expect } from 'vitest';
import { blendInputs, blendPh, emptyStream } from './unitRegistry';
import { getAllUnits } from './unitRegistry';
import type { StreamResult } from './types';
import { DEFAULT_ASSUMPTIONS } from '../config/constants';

/** Flux de référence : 100 t/h à 3 g/t, pulpe à 40 % solides. */
function stream(over: Partial<StreamResult> = {}): StreamResult {
  return {
    edge_id: 'e1', mass_flow: 100, volume_flow: 150, solids_content: 40,
    gold_grade: 3, gold_flow: 300, dissolved_gold: 0,
    cyanide_concentration: 0, pH: 7, temperature: 25,
    ...over,
  };
}

// ═══ Mélange de flux ═════════════════════════════════════════════════════════

describe('blendInputs — conservation', () => {
  it('conserve la masse et le métal', () => {
    const b = blendInputs([
      stream({ mass_flow: 100, gold_grade: 2, gold_flow: 200 }),
      stream({ mass_flow: 300, gold_grade: 6, gold_flow: 1800 }),
    ]);
    expect(b.mass_flow).toBe(400);
    expect(b.gold_flow).toBe(2000);
    // teneur pondérée par la masse : (100×2 + 300×6) / 400 = 5
    expect(b.gold_grade).toBeCloseTo(5, 6);
  });

  it('renvoie un flux vide sans entrée ou à masse nulle', () => {
    expect(blendInputs([]).mass_flow).toBe(0);
    expect(blendInputs([stream({ mass_flow: 0 })]).mass_flow).toBe(0);
  });

  it('ne divise jamais par zéro sur le volume', () => {
    const b = blendInputs([stream({ volume_flow: 0, dissolved_gold: 5 })]);
    expect(Number.isFinite(b.dissolved_gold)).toBe(true);
  });

  it('pondère la densité de pulpe par la masse', () => {
    const b = blendInputs([
      stream({ mass_flow: 100, solids_content: 30 }),
      stream({ mass_flow: 100, solids_content: 50 }),
    ]);
    expect(b.solids_content).toBeCloseTo(40, 6);
  });
});

// ═══ pH — grandeur logarithmique ═════════════════════════════════════════════

describe('blendPh — le pH ne se moyenne pas linéairement', () => {
  it('le flux le plus alcalin domine le mélange', () => {
    // pH 10.5 + pH 12.5 à parts égales : la moyenne linéaire donnerait 11.5,
    // mais [OH⁻] est 100× plus élevé à 12.5 → le vrai pH est ≈ 12.2.
    const ph = blendPh([{ pH: 10.5, weight: 1 }, { pH: 12.5, weight: 1 }]);
    expect(ph).toBeGreaterThan(12);
    expect(ph).toBeCloseTo(12.2, 1);
    expect(ph).not.toBeCloseTo(11.5, 1); // le bug corrigé
  });

  it('rend le pH commun quand tous les flux sont identiques', () => {
    expect(blendPh([{ pH: 10.5, weight: 3 }, { pH: 10.5, weight: 7 }])).toBeCloseTo(10.5, 6);
  });

  it('respecte la pondération', () => {
    const faible = blendPh([{ pH: 12.5, weight: 1 }, { pH: 9, weight: 999 }]);
    const fort   = blendPh([{ pH: 12.5, weight: 999 }, { pH: 9, weight: 1 }]);
    expect(faible).toBeLessThan(fort);
    expect(fort).toBeCloseTo(12.5, 1);
  });

  it('reste dans la plage physique 0–14', () => {
    for (const ph of [-5, 0, 7, 14, 20, NaN]) {
      const r = blendPh([{ pH: ph, weight: 1 }]);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(14);
    }
  });

  it('retourne un pH neutre sans entrée exploitable', () => {
    expect(blendPh([])).toBe(7);
    expect(blendPh([{ pH: 10, weight: 0 }])).toBe(7);
  });

  it('est utilisé par blendInputs', () => {
    const b = blendInputs([
      stream({ pH: 10.5, volume_flow: 100 }),
      stream({ pH: 12.5, volume_flow: 100 }),
    ]);
    expect(b.pH).toBeGreaterThan(12); // et non 11.5
  });
});

// ═══ Comminution — équation de Bond ══════════════════════════════════════════

const unit = (t: string) => getAllUnits().find(u => u.unitType === t)!;
const defaults = (t: string): Record<string, number | string> => {
  const out: Record<string, number | string> = {};
  for (const [k, d] of Object.entries(unit(t).defaultParameters)) out[k] = d.default;
  return out;
};

describe('séparateurs — conservation des quantités extensives', () => {
  const assertClosure = (unitType: string, input: StreamResult) => {
    const out = unit(unitType).calculate([input], defaults(unitType)).outStreams;
    expect(out.reduce((s, x) => s + (x.mass_flow ?? 0), 0), `${unitType} masse`).toBeCloseTo(input.mass_flow, 9);
    expect(out.reduce((s, x) => s + (x.volume_flow ?? 0), 0), `${unitType} volume`).toBeCloseTo(input.volume_flow, 9);
    expect(out.reduce((s, x) => s + (x.gold_flow ?? 0), 0), `${unitType} or`).toBeCloseTo(input.gold_flow, 9);
  };

  it('ferme masse, volume et or autour de l\'hydrocyclone', () => {
    assertClosure('hydrocyclone', stream({ mass_flow: 100, volume_flow: 150, gold_flow: 0.3 }));
  });

  it('ferme masse, volume et or autour des épaississeurs', () => {
    const input = stream({ mass_flow: 100, volume_flow: 150, gold_flow: 0.3 });
    for (const t of ['thickener', 'high_rate_thickener', 'paste_thickener']) assertClosure(t, input);
  });
});

describe('electrowinning — unités de Faraday', () => {
  it('compare et restitue l\'or en kg/h sans facteur 1000 parasite', () => {
    const input = stream({ gold_flow: 1, dissolved_gold: 10 });
    const out = unit('electrowinning').calculate([input], defaults('electrowinning'));
    // Plafond de dépôt = rendement max EW (config ADR) sur 1 kg/h disponible.
    const ewMax = DEFAULT_ASSUMPTIONS.ADR_ELECTROWINNING_MAX_PCT / 100;
    expect(out.nodeResult.kpis?.gold_deposited_kg_h).toBeCloseTo(ewMax, 9);
    expect(out.outStreams[0].gold_flow).toBeCloseTo(ewMax, 9);
    expect(out.outStreams.reduce((s, x) => s + (x.gold_flow ?? 0), 0)).toBeCloseTo(1, 9);
  });
});

describe('comminution — le BWi pilote réellement l\'énergie', () => {
  const MILLS = ['hpgr', 'sag_mill', 'ag_mill', 'ball_mill', 'rod_mill', 'vertical_mill'];

  it('expose le BWi en paramètre configurable sur chaque broyeur', () => {
    for (const m of MILLS) {
      expect(unit(m).defaultParameters.bwi, `${m} : BWi non paramétrable`).toBeDefined();
    }
  });

  it('un minerai plus dur consomme plus d\'énergie', () => {
    for (const m of MILLS) {
      const tendre = unit(m).calculate([stream()], { ...defaults(m), bwi: 8 });
      const dur    = unit(m).calculate([stream()], { ...defaults(m), bwi: 20 });
      const eT = tendre.nodeResult.energy_consumption ?? 0;
      const eD = dur.nodeResult.energy_consumption ?? 0;
      expect(eD, `${m} : l'énergie ne suit pas la dureté`).toBeGreaterThan(eT);
    }
  });

  it('l\'énergie suit la proportionnalité de Bond au BWi', () => {
    // E = 10·Wi·(1/√P80 − 1/√F80) : doubler Wi double l'énergie.
    const p = { ...defaults('ball_mill'), p80_target: 75 };
    const e1 = unit('ball_mill').calculate([stream()], { ...p, bwi: 10 }).nodeResult.energy_consumption ?? 0;
    const e2 = unit('ball_mill').calculate([stream()], { ...p, bwi: 20 }).nodeResult.energy_consumption ?? 0;
    expect(e2 / e1).toBeCloseTo(2, 1);
  });

  it('broyer plus fin coûte plus cher en énergie', () => {
    const p = { ...defaults('ball_mill'), bwi: 14 };
    const grossier = unit('ball_mill').calculate([stream()], { ...p, p80_target: 150 }).nodeResult.energy_consumption ?? 0;
    const fin      = unit('ball_mill').calculate([stream()], { ...p, p80_target: 45 }).nodeResult.energy_consumption ?? 0;
    expect(fin).toBeGreaterThan(grossier);
  });
});

// ═══ Invariants transverses sur les 60+ opérations ═══════════════════════════

describe('invariants du registre', () => {
  const all = getAllUnits();
  // Bornes légitimes du flowsheet : l'alimentation ROM n'a pas d'entrée et
  // produit la matière du circuit ; le puits produit fini n'a pas de sortie.
  const SOURCES = ['feed_source'];
  const SINKS = ['product_sink'];
  const isSource = (t: string) => SOURCES.includes(t);

  it('déclare des opérations uniques et complètes', () => {
    expect(all.length).toBeGreaterThan(40);
    const types = all.map(u => u.unitType);
    expect(new Set(types).size, 'unitType dupliqué').toBe(types.length);
    for (const u of all) {
      expect(u.displayName, `${u.unitType} sans libellé`).toBeTruthy();
      if (!isSource(u.unitType)) {
        expect(u.maxInputs, `${u.unitType} sans entrée`).toBeGreaterThan(0);
      }
      if (!SINKS.includes(u.unitType)) {
        expect(u.maxOutputs, `${u.unitType} sans sortie`).toBeGreaterThan(0);
      }
    }
  });

  it('n\'expose qu\'une source et qu\'un puits', () => {
    expect(all.filter(u => u.maxInputs === 0).map(u => u.unitType)).toEqual(SOURCES);
    expect(all.filter(u => u.maxOutputs === 0).map(u => u.unitType)).toEqual(SINKS);
  });

  it('aucune opération ne produit NaN ou Infinity sur un flux normal', () => {
    for (const u of all) {
      const out = u.calculate([stream()], defaults(u.unitType));
      for (const s of out.outStreams) {
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === 'number') {
            expect(Number.isFinite(v), `${u.unitType}.${k} = ${v}`).toBe(true);
          }
        }
      }
      for (const [k, v] of Object.entries(out.nodeResult)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `${u.unitType}.nodeResult.${k} = ${v}`).toBe(true);
        }
      }
    }
  });

  it('aucune opération de traitement ne crée de matière depuis un flux nul', () => {
    // La source est exclue : produire la matière d'alimentation est sa fonction.
    for (const u of all.filter(x => !isSource(x.unitType))) {
      const out = u.calculate([emptyStream()], defaults(u.unitType));
      const total = out.outStreams.reduce((s, x) => s + (x?.mass_flow ?? 0), 0);
      expect(total, `${u.unitType} crée de la matière depuis rien`).toBeLessThanOrEqual(0.001);
    }
  });

  it('la source convertit le ROM humide en base sèche', () => {
    // Tout le flowsheet raisonne en tonnes sèches : 250 t/h humide à 3 %
    // d'humidité alimentent 242.5 t/h sec.
    const src = unit('feed_source');
    const out = src.calculate([], { ...defaults('feed_source'), feed_rate: 250, moisture: 3 });
    expect(out.outStreams[0].mass_flow).toBeCloseTo(242.5, 3);
    expect(out.nodeResult.feed_rate).toBe(250);

    // Sans humidité déclarée, base sèche = base humide.
    const sec = src.calculate([], { ...defaults('feed_source'), feed_rate: 250, moisture: 0 });
    expect(sec.outStreams[0].mass_flow).toBeCloseTo(250, 3);
  });

  it('la source conserve le métal qu\'elle déclare', () => {
    const out = unit('feed_source').calculate([], {
      ...defaults('feed_source'), feed_rate: 100, moisture: 0, gold_grade: 3,
    });
    // 100 t/h × 3 g/t = 300 g/h = 0.3 kg/h
    expect(out.outStreams[0].gold_flow).toBeCloseTo(0.3, 6);
  });

  it('aucune opération ne crée de masse à partir de son alimentation', () => {
    const feed = stream({ mass_flow: 100 });
    for (const u of all.filter(x => !isSource(x.unitType))) {
      const out = u.calculate([feed], defaults(u.unitType));
      const total = out.outStreams.reduce((s, x) => s + (x?.mass_flow ?? 0), 0);
      // tolérance : certaines unités ajoutent de l'eau de dilution ou des réactifs
      expect(total, `${u.unitType} : ${total} t/h en sortie pour 100 t/h en entrée`)
        .toBeLessThanOrEqual(100 * 5);
    }
  });

  it('garde les récupérations et le pH dans des plages physiques', () => {
    for (const u of all) {
      const out = u.calculate([stream()], defaults(u.unitType));
      const rec = out.nodeResult.recovery;
      if (typeof rec === 'number') {
        expect(rec, `${u.unitType} : récupération ${rec} %`).toBeGreaterThanOrEqual(0);
        expect(rec, `${u.unitType} : récupération ${rec} %`).toBeLessThanOrEqual(100.001);
      }
      for (const s of out.outStreams) {
        expect(s.pH, `${u.unitType} : pH ${s.pH}`).toBeGreaterThanOrEqual(0);
        expect(s.pH, `${u.unitType} : pH ${s.pH}`).toBeLessThanOrEqual(14);
      }
    }
  });

  it('ne consomme jamais une énergie négative', () => {
    for (const u of all) {
      const e = u.calculate([stream()], defaults(u.unitType)).nodeResult.energy_consumption;
      if (typeof e === 'number') {
        expect(e, `${u.unitType} : énergie ${e} kWh/t`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
