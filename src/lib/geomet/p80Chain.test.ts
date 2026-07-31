import { describe, it, expect } from 'vitest';
import {
  buildP80Chain, checkCoherence, finalMillWindow, weakestLink,
  interpolateScenarioPoint, whatIfP80,
  type ChainContext,
} from './p80Chain';
import {
  runP80Optimization, defaultCircuitChain,
  type P80OptimizationInputs, type ScenarioPoint,
} from './p80Optimization';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const psdCurve = [
  { sieve: 53, passing: 42 }, { sieve: 75, passing: 58 }, { sieve: 106, passing: 72 },
  { sieve: 150, passing: 84 }, { sieve: 212, passing: 93 }, { sieve: 300, passing: 98 },
];

function inputs(over: Partial<P80OptimizationInputs> = {}): P80OptimizationInputs {
  return {
    psdCurve,
    psdMeta: { source: 'lims', sampleId: 'ECH-01', unit: 'um' },
    f80Um: 12_000,
    headF80Um: 600_000,
    bwi: 15,
    recovery: { auFreePct: 35, recoveryCeilingPct: 94 },
    goldGradeGt: 2.1,
    goldPriceUsdOz: 2400,
    elecCostUsdKwh: 0.07,
    plantFactor: 1.15,
    throughputTph: 250,
    availablePowerKw: null,
    designEnergyTargetKwhT: null,
    processMaxP80Um: null,
    kIndusMode: 'default',
    kIndusManual: null,
    kIndusInputs: {},
    labTargetEngineerUm: null,
    withRegrind: false,
    data: { hasPsd: true, hasMeasuredWi: true, hasRecoveryData: true, nSamples: 12 },
    ...over,
  } as P80OptimizationInputs;
}

function ctx(over: Partial<ChainContext> = {}): ChainContext {
  return {
    bwi: 15, bwiIsMeasured: true, f80Um: 12_000,
    auFreePct: 35, recoveryCeilingPct: 94,
    throughputTph: 250, elecCostUsdKwh: 0.07, plantFactor: 1.15,
    dcP80GrindUm: null,
    circuitChain: defaultCircuitChain(false),
    limsSampleLabel: 'ECH-01', psdPointCount: psdCurve.length,
    labP80MeanUm: null, labP80ControlUm: null, psdTestCount: 1, p80WeightedByFeed: false,
    ...over,
  };
}

// ─── Cheminement ─────────────────────────────────────────────────────────────

describe('buildP80Chain — le cheminement suit l\'ordre du raisonnement', () => {
  it('déroule les sept étapes dans l\'ordre, sans trou de numérotation', () => {
    const steps = buildP80Chain(runP80Optimization(inputs()), ctx());
    expect(steps.map(s => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(steps.map(s => s.id)).toEqual([
      'mesure', 'cible_labo', 'passage_usine', 'coherence', 'energie', 'arbitrage', 'consigne',
    ]);
  });

  it('chaque étape pose une question et livre une conséquence', () => {
    const steps = buildP80Chain(runP80Optimization(inputs()), ctx());
    for (const s of steps) {
      expect(s.question.endsWith('?'), `${s.id} : la question n'en est pas une`).toBe(true);
      expect(s.soWhat.length, `${s.id} : conséquence vide`).toBeGreaterThan(20);
      expect(s.value.length, `${s.id} : valeur vide`).toBeGreaterThan(0);
    }
  });

  // Le cœur du problème signalé : on ne voyait pas COMMENT on passait du labo
  // à l'usine. Le calcul littéral doit porter les deux nombres et le facteur.
  it('affiche le calcul littéral du passage labo → usine, nombres substitués', () => {
    const r = runP80Optimization(inputs());
    const steps = buildP80Chain(r, ctx());
    const passage = steps.find(s => s.id === 'passage_usine')!;
    expect(passage.computation).toContain(`${Math.round(r.labTarget.valueUm)} µm`);
    expect(passage.computation).toContain(r.kIndus.k.toFixed(2));
    expect(passage.computation).toContain(`${Math.round(r.p80OptimalPlantUm)} µm`);
  });

  it('signale K_indus au défaut comme le maillon faible, en chiffrant son effet', () => {
    const steps = buildP80Chain(runP80Optimization(inputs({ kIndusMode: 'default' })), ctx());
    const passage = steps.find(s => s.id === 'passage_usine')!;
    expect(passage.status).toBe('attention');
    expect(passage.warning).toContain('défaut');
  });

  it('ne crie pas au loup quand K_indus a été rattaché au circuit', () => {
    const r = runP80Optimization(inputs({ kIndusMode: 'manual', kIndusManual: 1.22 }));
    const passage = buildP80Chain(r, ctx()).find(s => s.id === 'passage_usine')!;
    expect(passage.status).toBe('ok');
    expect(passage.warning).toBeNull();
  });

  it('marque le BWi non mesuré comme fragilité de l\'étape énergie', () => {
    const steps = buildP80Chain(runP80Optimization(inputs()), ctx({ bwiIsMeasured: false }));
    const energie = steps.find(s => s.id === 'energie')!;
    expect(energie.status).toBe('attention');
    expect(energie.inputs.find(i => i.label === 'BWi')?.isDefault).toBe(true);
  });

  it('rend le maillon bloquant prioritaire sur les simples attentions', () => {
    // Cible labo très fine + K faible → consigne sous le plancher du broyeur.
    const r = runP80Optimization(inputs({ labTargetEngineerUm: 12, kIndusMode: 'manual', kIndusManual: 1.0 }));
    const steps = buildP80Chain(r, ctx());
    const weak = weakestLink(steps);
    expect(weak?.id).toBe('coherence');
    expect(weak?.status).toBe('bloquant');
  });

  it('ne désigne aucun maillon faible quand tout est étayé', () => {
    const r = runP80Optimization(inputs({ kIndusMode: 'manual', kIndusManual: 1.2 }));
    expect(weakestLink(buildP80Chain(r, ctx()))).toBeNull();
  });

  // « 96026 µm » se déchiffre, « 96 mm » se lit — et cette section existe
  // justement pour être lue.
  it('exprime les consignes de concassage en mm et celles de broyage en µm', () => {
    const steps = buildP80Chain(runP80Optimization(inputs()), ctx());
    const consigne = steps.find(s => s.id === 'consigne')!;
    expect(consigne.computation).toMatch(/Concassage primaire → \d+ mm/);
    expect(consigne.computation).toMatch(/ball mill → \d+ µm/);
    expect(consigne.computation).not.toMatch(/\d{5,} µm/);
  });

  // Le module affiche « P80 moy. labo » comme mesure de référence. L'étape 1
  // affichait le P80 de la seule courbe chargée : deux nombres contradictoires
  // pour « la granulométrie mesurée », dans la même page.
  it('affiche la moyenne labo représentative, pas le P80 de la courbe chargée', () => {
    const r = runP80Optimization(inputs());
    const mesure = buildP80Chain(r, ctx({ labP80MeanUm: 107, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    expect(mesure.value).toBe('107 µm');
    expect(mesure.value).not.toBe(`${Math.round(r.p80Lims.valueUm!)} µm`);
    expect(mesure.computation).toContain('courbe granulométrique combinée');
    expect(mesure.computation).toContain('15 essais');
  });

  // Choix utilisateur : montrer les deux méthodes. La courbe combinée est la
  // valeur affichée ; la moyenne des P80 apparaît en contrôle à côté.
  it('affiche la moyenne des P80 en contrôle, sans en faire la valeur de référence', () => {
    const mesure = buildP80Chain(runP80Optimization(inputs()),
      ctx({ labP80MeanUm: 107, labP80ControlUm: 121, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    expect(mesure.value).toBe('107 µm');                          // courbe combinée = référence
    const ctrl = mesure.inputs.find(i => i.label.includes('Contrôle'));
    expect(ctrl?.value).toBe('121 µm');                           // moyenne des P80 = contrôle
  });

  it('chiffre l\'écart entre les deux méthodes quand il est matériel', () => {
    const mesure = buildP80Chain(runP80Optimization(inputs()),
      ctx({ labP80MeanUm: 100, labP80ControlUm: 120, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    const ctrl = mesure.inputs.find(i => i.label.includes('Contrôle'))!;
    expect(ctrl.origin).toContain('20 %');                        // |120-100|/100
  });

  it('dit que les deux méthodes concordent quand l\'écart est négligeable', () => {
    const mesure = buildP80Chain(runP80Optimization(inputs()),
      ctx({ labP80MeanUm: 100, labP80ControlUm: 102, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    const ctrl = mesure.inputs.find(i => i.label.includes('Contrôle'))!;
    expect(ctrl.origin).toContain('concorde');
  });

  it('rappelle le P80 de la courbe affichée sans le confondre avec la moyenne', () => {
    const r = runP80Optimization(inputs());
    const mesure = buildP80Chain(r, ctx({ labP80MeanUm: 107, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    expect(mesure.computation).toContain(`${Math.round(r.p80Lims.valueUm!)} µm`);
    expect(mesure.inputs.some(i => i.label === 'Courbe affichée')).toBe(true);
    expect(mesure.inputs.some(i => i.label === 'Essais PSD' && i.value === '15')).toBe(true);
  });

  it('alerte quand la courbe affichée n\'est pas représentative du gisement', () => {
    // Cas signalé : VAR-01 à 175 µm contre 107 µm de moyenne, soit +64 %.
    // Le fixture reproduit le même ordre de grandeur d'écart (≈ +67 %).
    const r = runP80Optimization(inputs());
    const moyenne = 80;
    const mesure = buildP80Chain(r, ctx({ labP80MeanUm: moyenne, psdTestCount: 15, limsSampleLabel: 'VAR-01' }))
      .find(s => s.id === 'mesure')!;
    expect(r.p80Lims.valueUm!).toBeGreaterThan(moyenne * 1.25);   // l'écart est bien matériel
    expect(mesure.status).toBe('attention');
    expect(mesure.warning).toContain('VAR-01');
    expect(mesure.warning).toContain('ne représente pas');
  });

  it('ne signale rien quand la courbe affichée colle à la moyenne', () => {
    const r = runP80Optimization(inputs());
    const proche = Math.round(r.p80Lims.valueUm!);
    const mesure = buildP80Chain(r, ctx({ labP80MeanUm: proche, psdTestCount: 15, p80WeightedByFeed: true }))
      .find(s => s.id === 'mesure')!;
    expect(mesure.status).toBe('ok');
    expect(mesure.warning).toBeNull();
  });

  it('marque une pondération à poids égaux comme hypothèse, pas comme mesure', () => {
    const mesure = buildP80Chain(runP80Optimization(inputs()), ctx({ labP80MeanUm: 107, psdTestCount: 15, p80WeightedByFeed: false }))
      .find(s => s.id === 'mesure')!;
    expect(mesure.inputs.find(i => i.label === 'Essais PSD')?.isDefault).toBe(true);
    expect(mesure.inputs.find(i => i.label === 'Essais PSD')?.origin).toContain('poids égaux');
  });

  // Sur une courbe importée à la main, la moyenne LIMS ne décrit plus ce que
  // l'ingénieur regarde : la chaîne doit retomber sur la courbe chargée.
  it('retombe sur la courbe chargée quand aucune moyenne labo n\'est fournie', () => {
    const r = runP80Optimization(inputs());
    const mesure = buildP80Chain(r, ctx({ labP80MeanUm: null })).find(s => s.id === 'mesure')!;
    expect(mesure.value).toBe(`${Math.round(r.p80Lims.valueUm!)} µm`);
    expect(mesure.status).toBe('ok');
  });

  it('signale une mesure PSD inexploitable plutôt que d\'inventer un P80', () => {
    // Courbe qui n'atteint jamais 80 % passant.
    const r = runP80Optimization(inputs({ psdCurve: [
      { sieve: 53, passing: 20 }, { sieve: 75, passing: 35 }, { sieve: 106, passing: 48 },
    ] }));
    const mesure = buildP80Chain(r, ctx({ psdPointCount: 3 })).find(s => s.id === 'mesure')!;
    expect(mesure.status).toBe('attention');
    expect(mesure.value).toBe('non calculable');
  });
});

// ─── Cohérence : l'apport propre de ce module ────────────────────────────────

describe('checkCoherence — confronte la consigne aux contraintes du circuit', () => {
  const chain = defaultCircuitChain(false);

  it('retient la fenêtre du dernier broyeur de la chaîne', () => {
    const w = finalMillWindow(chain);
    expect(w).not.toBeNull();
    expect(w!.window[0]).toBeLessThan(w!.window[1]);
  });

  it('valide une consigne qui tient dans la fenêtre mécanique', () => {
    const w = finalMillWindow(chain)!.window;
    const milieu = Math.round((w[0] + w[1]) / 2);
    const c = checkCoherence(milieu, chain, null);
    expect(c.status).toBe('ok');
    expect(c.belowMillWindow).toBe(false);
    expect(c.aboveMillWindow).toBe(false);
  });

  it('bloque une consigne plus fine que ce que le broyeur sait produire', () => {
    const w = finalMillWindow(chain)!.window;
    const c = checkCoherence(Math.max(1, w[0] - 10), chain, null);
    expect(c.belowMillWindow).toBe(true);
    expect(c.status).toBe('bloquant');
    expect(c.message).toContain('regrind');
  });

  it('bloque une consigne plus grossière que la fenêtre du broyeur', () => {
    const w = finalMillWindow(chain)!.window;
    const c = checkCoherence(w[1] + 50, chain, null);
    expect(c.aboveMillWindow).toBe(true);
    expect(c.status).toBe('bloquant');
  });

  // Dépasser le plafond procédé est un arbitrage, pas une impossibilité
  // physique : la nuance doit apparaître dans le statut.
  it('distingue le dépassement du plafond procédé, qui s\'arbitre', () => {
    const w = finalMillWindow(chain)!.window;
    const dansFenetre = Math.round((w[0] + w[1]) / 2);
    const c = checkCoherence(dansFenetre, chain, Math.round(dansFenetre / 2));
    expect(c.aboveProcessMax).toBe(true);
    expect(c.status).toBe('attention');
    expect(c.message).toContain('lixiviation');
  });

  it('applique la marge de 25 % au P80 des Critères, comme le moteur', () => {
    const c = checkCoherence(125, chain, 100);
    expect(c.processMaxUm).toBe(125);
    expect(c.aboveProcessMax).toBe(false);   // 125 ≤ 125 : à la limite, pas au-delà
  });
});

// ─── « Et si ? » ─────────────────────────────────────────────────────────────

describe('interpolateScenarioPoint — lecture de la courbe économique', () => {
  const pts: ScenarioPoint[] = [
    { p80: 50, energyKwhT: 20, recoveryPct: 92, energyCostUsdT: 1.4, revenueUsdT: 140, netUsdT: 138, marginalNetPerUm: null },
    { p80: 100, energyKwhT: 14, recoveryPct: 90, energyCostUsdT: 1.0, revenueUsdT: 137, netUsdT: 136, marginalNetPerUm: null },
    { p80: 200, energyKwhT: 10, recoveryPct: 85, energyCostUsdT: 0.7, revenueUsdT: 129, netUsdT: 128, marginalNetPerUm: null },
  ];

  it('rend le point exact quand il existe', () => {
    expect(interpolateScenarioPoint(pts, 100)?.energyKwhT).toBeCloseTo(14, 6);
  });

  it('interpole en log de la taille, pas linéairement', () => {
    // 100 est le milieu géométrique de 50 et 200 : l'interpolation log doit
    // rendre la demi-somme, ce qu'une interpolation linéaire ne ferait pas.
    const r = interpolateScenarioPoint([pts[0], pts[2]], 100)!;
    expect(r.energyKwhT).toBeCloseTo(15, 6);
    expect(r.recoveryPct).toBeCloseTo(88.5, 6);
  });

  it('borne aux extrémités plutôt que d\'extrapoler', () => {
    expect(interpolateScenarioPoint(pts, 10)?.p80Um).toBe(50);
    expect(interpolateScenarioPoint(pts, 5000)?.p80Um).toBe(200);
  });

  it('rend null sur une courbe vide ou une taille absurde', () => {
    expect(interpolateScenarioPoint([], 100)).toBeNull();
    expect(interpolateScenarioPoint(pts, 0)).toBeNull();
    expect(interpolateScenarioPoint(pts, -5)).toBeNull();
  });
});

describe('whatIfP80 — répondre à « pourquoi pas une autre finesse ? »', () => {
  const pts: ScenarioPoint[] = [
    { p80: 50, energyKwhT: 20, recoveryPct: 92, energyCostUsdT: 1.4, revenueUsdT: 140, netUsdT: 138, marginalNetPerUm: null },
    { p80: 100, energyKwhT: 14, recoveryPct: 90, energyCostUsdT: 1.0, revenueUsdT: 137, netUsdT: 140, marginalNetPerUm: null },
    { p80: 200, energyKwhT: 10, recoveryPct: 85, energyCostUsdT: 0.7, revenueUsdT: 129, netUsdT: 128, marginalNetPerUm: null },
  ];

  it('reconnaît la consigne recommandée elle-même', () => {
    expect(whatIfP80(pts, 100, 100)!.verdict).toContain('consigne recommandée');
  });

  it('chiffre l\'écart dans les trois dimensions à la fois', () => {
    const r = whatIfP80(pts, 100, 200)!;
    expect(r.deltaEnergyKwhT).toBeCloseTo(-4, 6);
    expect(r.deltaRecoveryPct).toBeCloseTo(-5, 6);
    expect(r.deltaNetUsdT).toBeCloseTo(-12, 6);
    expect(r.better).toBe(false);
  });

  it('explique un broyage plus grossier par la récupération perdue', () => {
    expect(whatIfP80(pts, 100, 200)!.verdict).toContain('récupération perdue');
  });

  it('explique un broyage plus fin par l\'énergie non payée', () => {
    const r = whatIfP80(pts, 100, 50)!;
    expect(r.better).toBe(false);
    expect(r.verdict).toContain('n\'est pas payé');
  });

  it('reconnaît un candidat réellement meilleur', () => {
    const r = whatIfP80(pts, 200, 100)!;
    expect(r.better).toBe(true);
    expect(r.verdict).toContain('Meilleur');
  });

  // Un écart de quelques centimes par tonne ne justifie aucune décision : le
  // dire évite de faire trancher un choix de design par du bruit.
  it('refuse de trancher sur un écart non significatif', () => {
    const plats: ScenarioPoint[] = [
      { p80: 100, energyKwhT: 14, recoveryPct: 90, energyCostUsdT: 1, revenueUsdT: 137, netUsdT: 136.00, marginalNetPerUm: null },
      { p80: 120, energyKwhT: 13.8, recoveryPct: 89.9, energyCostUsdT: 1, revenueUsdT: 137, netUsdT: 136.02, marginalNetPerUm: null },
    ];
    const r = whatIfP80(plats, 100, 120)!;
    expect(r.better).toBe(false);
    expect(r.verdict).toContain('Équivalent');
  });

  it('annualise l\'écart quand le débit est connu, et pas sinon', () => {
    expect(whatIfP80(pts, 100, 200, { throughputTph: 250, operatingHoursPerYear: 8000 })!.deltaNetUsdYear)
      .toBeCloseTo(-12 * 250 * 8000, 3);
    expect(whatIfP80(pts, 100, 200)!.deltaNetUsdYear).toBeNull();
    expect(whatIfP80(pts, 100, 200, { throughputTph: 0 })!.deltaNetUsdYear).toBeNull();
  });

  it('rend null plutôt qu\'un écart trompeur sans courbe', () => {
    expect(whatIfP80([], 100, 120)).toBeNull();
  });
});
