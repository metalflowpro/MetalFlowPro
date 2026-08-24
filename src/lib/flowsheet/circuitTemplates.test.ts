import { describe, it, expect } from 'vitest';
import { CIRCUIT_TEMPLATES, CIRCUIT_RADAR_AXES, findCircuitTemplate } from './circuitTemplates';
import { EQUIP_MAP } from './equipmentLibrary';

describe('modèles de circuit — intégrité structurelle', () => {
  it('expose les modèles aux codes uniques', () => {
    expect(CIRCUIT_TEMPLATES.length).toBeGreaterThanOrEqual(9);
    expect(new Set(CIRCUIT_TEMPLATES.map(t => t.code)).size).toBe(CIRCUIT_TEMPLATES.length);
  });

  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — identifiants de nœuds uniques',
    (_code, tpl) => {
      const ids = tpl.nodes.map(n => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  // Un code absent de la bibliothèque donnerait un nœud sans symbole ni couleur
  // sur le canvas — l'erreur ne se verrait qu'à l'écran, jamais au build.
  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — tous les équipements existent dans la bibliothèque',
    (_code, tpl) => {
      const unknown = tpl.nodes.filter(n => !EQUIP_MAP[n.equipCode]).map(n => n.equipCode);
      expect(unknown).toEqual([]);
    },
  );

  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — tous les flux relient deux nœuds du modèle',
    (_code, tpl) => {
      const ids = new Set(tpl.nodes.map(n => n.id));
      const dangling = tpl.edges.filter(e => !ids.has(e.from) || !ids.has(e.to));
      expect(dangling).toEqual([]);
      expect(tpl.edges.filter(e => e.from === e.to)).toEqual([]);
    },
  );

  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — aucun équipement orphelin',
    (_code, tpl) => {
      const wired = new Set(tpl.edges.flatMap(e => [e.from, e.to]));
      expect(tpl.nodes.filter(n => !wired.has(n.id)).map(n => n.id)).toEqual([]);
    },
  );

  // Le tracé automatique ordonne les colonnes sur les flux ALLER seuls : les
  // boucles de recyclage et l'eau de retour sont écartées, sinon le circuit de
  // broyage se déplierait en ligne droite. Un équipement qu'aucun flux aller
  // n'atteint atterrit donc en colonne 0, collé à l'alimentation.
  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — tout équipement est atteint depuis l\'alimentation par des flux aller',
    (_code, tpl) => {
      const forward = tpl.edges.filter(e => e.type !== 'recycle' && e.type !== 'water');
      const feed = tpl.nodes.find(n => n.equipCode === 'FEED_ROM')!;
      const seen = new Set([feed.id]);
      const queue = [feed.id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const e of forward) {
          if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
        }
      }
      expect(tpl.nodes.filter(n => !seen.has(n.id)).map(n => n.id)).toEqual([]);
    },
  );

  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — flux dupliqués absents',
    (_code, tpl) => {
      const keys = tpl.edges.map(e => `${e.from}→${e.to}`);
      expect(new Set(keys).size).toBe(keys.length);
    },
  );
});

describe('modèles de circuit — complétude métallurgique', () => {
  // « Complet » = de l'alimentation au doré ET aux résidus. Un modèle qui
  // s'arrête au CIL ne peut pas servir de base à un bilan de flux.
  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — part d\'une alimentation et aboutit au doré',
    (_code, tpl) => {
      const codes = tpl.nodes.map(n => n.equipCode);
      expect(codes).toContain('FEED_ROM');
      expect(codes).toContain('ADR_DORE');
    },
  );

  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — comporte un circuit de récupération du charbon fermé',
    (_code, tpl) => {
      const kiln = tpl.nodes.find(n => n.equipCode === 'ADR_KILN');
      expect(kiln, 'régénération du charbon absente').toBeDefined();
      expect(tpl.edges.some(e => e.from === kiln!.id && e.type === 'recycle')).toBe(true);
    },
  );

  it('achemine les résidus de chaque circuit en cuves vers un parc à résidus', () => {
    const inTanks = CIRCUIT_TEMPLATES.filter(t => t.code !== 'AU_HEAP_LEACH');
    for (const tpl of inTanks) {
      expect(tpl.nodes.map(n => n.equipCode), tpl.code).toContain('TAILS_TSF');
    }
    // Le heap leach ne produit pas de résidus épaissis : le tas reste en place.
    expect(findCircuitTemplate('AU_HEAP_LEACH')!.nodes.map(n => n.equipCode)).not.toContain('TAILS_TSF');
  });

  it('couvre les grandes familles de circuits aurifères', () => {
    const codes = CIRCUIT_TEMPLATES.map(t => t.code);
    expect(codes).toEqual(expect.arrayContaining([
      'AU_CIL_STD', 'AU_CIP_STD', 'AU_GRAV_CIL', 'AU_FLOT_CIL', 'AU_POX_CIL', 'AU_HEAP_LEACH',
    ]));
  });

  // CIL = charbon DANS les cuves de lixiviation ; CIP = cuverie de lixiviation
  // PUIS cuverie d'adsorption. Confondre les deux est l'erreur historique de
  // l'application — voir ../analytics/adsorptionCircuit.
  it('distingue le CIL du CIP par la présence d\'une cuverie de lixiviation séparée', () => {
    const cil = findCircuitTemplate('AU_CIL_STD')!.nodes.map(n => n.equipCode);
    const cip = findCircuitTemplate('AU_CIP_STD')!.nodes.map(n => n.equipCode);
    expect(cil).toContain('CIL_TANK');
    expect(cil).not.toContain('LEACH_TANK');
    expect(cip).toContain('CIP_TANK');
    expect(cip).toContain('LEACH_TANK');
  });

  it('ne nomme aucun circuit « Lixiviation + CIL/CIP » — le pléonasme corrigé', () => {
    for (const tpl of CIRCUIT_TEMPLATES) {
      expect(tpl.name, tpl.code).not.toMatch(/Lixiviation\s*\+\s*CI[LP]/i);
    }
  });
});

describe('modèles de circuit — scores de comparaison', () => {
  it.each(CIRCUIT_TEMPLATES.map(t => [t.code, t] as const))(
    '%s — un score borné sur chaque axe du radar',
    (_code, tpl) => {
      for (const axis of CIRCUIT_RADAR_AXES) {
        const v = tpl.scores[axis];
        expect(v, axis).toBeGreaterThan(0);
        expect(v, axis).toBeLessThanOrEqual(1);
      }
    },
  );

  it('documente chaque modèle par un domaine d\'emploi et ses limites', () => {
    for (const tpl of CIRCUIT_TEMPLATES) {
      expect(tpl.description.length, tpl.code).toBeGreaterThan(80);
      expect(tpl.applicability.length, tpl.code).toBeGreaterThan(0);
      expect(tpl.limitations.length, tpl.code).toBeGreaterThan(0);
    }
  });
});
