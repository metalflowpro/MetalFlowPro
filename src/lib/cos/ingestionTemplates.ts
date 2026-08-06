import type {
  Project,
  CosEquipmentStatus,
  CosOreLot,
  CosStockpile,
  CosStream,
} from '../../types';
import { TROY_OZ_GRAMS } from '../config/constants';
import { predictRecovery, predictNacn, predictCao } from './engine';

/**
 * Templates de données d'entrée du module COS (ingestion L2 → contextualisation L3).
 *
 * Chaque template est un GÉNÉRATEUR : le payload d'exemple est reconstruit à
 * chaque rendu à partir (1) de la configuration d'ingestion du projet et
 * (2) des données réelles importées des autres modules (équipements, lots,
 * stockpiles, courants, cibles projet).
 *
 * Les valeurs sont dérivées des paramètres du projet (débit cible, teneur,
 * récupération…) dès qu'ils existent. Là où AUCUNE donnée projet ne peut les
 * fournir — un lot de minerai sans analyse d'arsenic, un capteur d'humidité
 * absent — le générateur retombe sur les repères de SAMPLE_DATA_FALLBACKS
 * ci-dessous, regroupés et documentés plutôt que dispersés dans les payloads.
 *
 * ⚠️ Ce sont des valeurs d'ILLUSTRATION destinées à rendre l'aperçu du template
 * lisible, PAS des hypothèses de conception : elles ne doivent jamais alimenter
 * un calcul de dimensionnement ou une étude. Le module ne les utilise que pour
 * afficher un exemple de fichier d'ingestion.
 */

/**
 * Repères d'illustration utilisés uniquement quand ni le projet ni les données
 * importées ne renseignent la grandeur. Ordres de grandeur d'un minerai
 * sulfuré aurifère typique — à ne jamais confondre avec des données de projet.
 */
export const SAMPLE_DATA_FALLBACKS = {
  /** Teneur en sulfures (%) d'un lot sans analyse soufre. */
  sulfidesPct: 1.5,
  /** Carbone organique préempteur (%) d'un lot sans analyse TOC. */
  organicCarbonPct: 0.3,
  /** Arsenic (ppm) d'un lot sans analyse ICP. */
  arsenicPpm: 1200,
  /** Argiles (%) d'un lot sans caractérisation minéralogique. */
  clayPct: 3.0,
  /** Humidité (%) affichée quand aucun capteur/analyse ne la fournit. */
  moisturePct: 7.5,
  /** Masse volumique de pulpe (t/m³) quand le courant ne la porte pas. */
  pulpDensityTM3: 1.35,
} as const;

// ─── Drapeaux de qualité (convention commune) ─────────────────────

export interface QualityFlag {
  key: string;
  code: number;
  label: string;
}

export const INGESTION_QUALITY_FLAGS: QualityFlag[] = [
  { key: 'good',       code: 1, label: 'Mesure valide' },
  { key: 'suspect',    code: 2, label: 'Hors plage / instable' },
  { key: 'bad',        code: 3, label: 'Capteur en défaut' },
  { key: 'missing',    code: 4, label: 'Absente' },
  { key: 'frozen',     code: 5, label: 'Variance nulle (capteur gelé)' },
  { key: 'substitute', code: 6, label: 'Valeur provisoire/remplaçante (P754 n°6, sign-off requis)' },
];

// ─── Configuration d'ingestion (persistée par projet) ─────────────

export interface IngestionConfig {
  site_code: string;
  tz: string;
  mine_name: string;
  lab_id: string;
  opc_source_grinding: string;
  opc_source_leaching: string;
  opc_source_utilities: string;
  lims_source: string;
  cmms_source: string;
  geomet_source: string;
  shift_start_utc_h: number;
  shift_duration_h: number;
}

/** Valeurs par défaut dérivées du projet (code, nom) — modifiables par l'utilisateur. */
export function defaultIngestionConfig(project: Pick<Project, 'code' | 'name'>): IngestionConfig {
  const slug = (project.code || project.name || 'site')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    site_code: `site-${slug}`,
    tz: 'America/Toronto',
    mine_name: `mine-${slug}`,
    lab_id: 'lab-central',
    opc_source_grinding: 'opcua:opc-server-01',
    opc_source_leaching: 'opcua:opc-server-02',
    opc_source_utilities: 'opcua:opc-server-03',
    lims_source: 'lims:lab-central',
    cmms_source: 'cmms:gmao-prod',
    geomet_source: 'mining:geomet-db',
    shift_start_utc_h: 12,
    shift_duration_h: 8,
  };
}

// ─── Contexte de génération ───────────────────────────────────────

export interface TemplateContext {
  config: IngestionConfig;
  project: Project;
  now: Date;
  equipment: CosEquipmentStatus[];
  oreLots: CosOreLot[];
  stockpiles: CosStockpile[];
  streams: CosStream[];
}

// ─── Helpers temps / format ───────────────────────────────────────

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const ISO_COMPACT_SEPARATORS = new RegExp('[-:' + 'TZ]', 'g');
const compact = (d: Date) => d.toISOString().replace(ISO_COMPACT_SEPARATORS, '').slice(0, 14);
const r = (v: number, dec = 1) => +v.toFixed(dec);

/** Fenêtre du quart courant, calculée depuis la config (début UTC + durée). */
export function shiftWindow(now: Date, cfg: IngestionConfig): { from: Date; to: Date; id: string } {
  const start = new Date(now);
  start.setUTCHours(cfg.shift_start_utc_h, 0, 0, 0);
  if (start > now) start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start.getTime() + cfg.shift_duration_h * 3600000);
  const half = ((now.getTime() - start.getTime()) / 3600000) % 24 < 12;
  return { from: start, to: end, id: `SHIFT-${dayStr(start)}-${half ? 'D' : 'N'}` };
}

// ─── Valeurs dérivées du projet / des modules ─────────────────────

interface DerivedValues {
  feedTph: number;
  feedAuGt: number;
  recoveryPct: number;
  tailAuGt: number;
  sulfidesPct: number;
  prcPct: number;
  nacnKgT: number;
  caoKgT: number;
  grinder: CosEquipmentStatus | null;
  grinderTag: string;
  feedStream: CosStream | null;
  tailStream: CosStream | null;
  productStream: CosStream | null;
  lot: CosOreLot | null;
  stockpile: CosStockpile | null;
}

function derive(ctx: TemplateContext): DerivedValues {
  const { project, equipment, oreLots, stockpiles, streams } = ctx;
  const lot = oreLots[0] ?? null;
  const stockpile = stockpiles[0] ?? null;
  const feedStream = streams.find(s => s.stream_type === 'feed') ?? null;
  const tailStream = streams.find(s => s.stream_type === 'tail') ?? null;
  const productStream = streams.find(s => s.stream_type === 'product') ?? null;
  const grinder = equipment.find(e => e.section === 'grinding') ?? equipment[0] ?? null;

  const feedTph = feedStream?.mass_tph || project.target_tph;
  const feedAuGt = feedStream?.au_g_t || lot?.au_g_t || project.gold_grade_g_t;
  const sulfidesPct = lot?.sulfides_pct ?? SAMPLE_DATA_FALLBACKS.sulfidesPct;
  const prcPct = lot?.organic_carbon_pct ?? SAMPLE_DATA_FALLBACKS.organicCarbonPct;
  const recoveryPct = predictRecovery(feedAuGt, sulfidesPct, prcPct, lot?.bwi ?? null);
  const projRec = project.recovery_pct || recoveryPct;
  const tailAuGt = tailStream?.au_g_t || r(feedAuGt * (1 - projRec / 100), 3);

  return {
    feedTph,
    feedAuGt,
    recoveryPct: projRec,
    tailAuGt,
    sulfidesPct,
    prcPct,
    nacnKgT: r(predictNacn(feedAuGt, sulfidesPct), 2),
    caoKgT: r(predictCao(sulfidesPct, prcPct), 2),
    grinder,
    grinderTag: (grinder?.equipment_tag || 'MILL-01').toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    feedStream,
    tailStream,
    productStream,
    lot,
    stockpile,
  };
}

// ─── Définition des templates ─────────────────────────────────────

export type TemplateFormat = 'json' | 'csv' | 'ndjson';

export interface IngestionTemplate {
  id: string;
  section: string;
  title: string;
  description: string;
  format: TemplateFormat;
  /** Champ config donnant la source du payload (affiché en badge). */
  sourceOf: (cfg: IngestionConfig) => string;
  build: (ctx: TemplateContext) => string;
}

const J = (o: unknown) => JSON.stringify(o, null, 2);

export const COS_INGESTION_TEMPLATES: IngestionTemplate[] = [
  // 1. Tags temps réel — broyage
  {
    id: 'rt-grinding',
    section: '1. Tags temps réel (OPC-UA / SCADA / Historian)',
    title: 'Batch JSON — tags broyage',
    description: 'Flux temps réel par équipement (1–5 s). Tags dérivés des équipements COS de la section broyage et du débit cible projet.',
    format: 'json',
    sourceOf: c => c.opc_source_grinding,
    build: (ctx) => {
      const d = derive(ctx);
      const t0 = addMin(ctx.now, -1);
      const ts = iso(addMin(t0, 0.17));
      const assetPath = `plant/grinding/${(d.grinder?.equipment_tag || 'sag-mill-01').toLowerCase()}`;
      const powerKw = r(d.feedTph * 11.6, 1); // énergie spécifique broyage ~kWh/t dérivée du débit
      return J({
        source: ctx.config.opc_source_grinding,
        site: ctx.config.site_code,
        asset_path: assetPath,
        period: { from: iso(t0), to: iso(ctx.now) },
        tags: [
          { tag: `${d.grinderTag}.PWR`, unit: 'kW', ts, value: powerKw, quality: 'good', confidence: 0.99 },
          { tag: `${d.grinderTag}.FEED_DRY`, unit: 't/h', ts, value: r(d.feedTph, 1), quality: 'good', confidence: 0.98 },
          {
            tag: `${d.grinderTag}.P80`, unit: 'um', ts, value: 150.0,
            quality: 'substitute', confidence: 0.82,
            lineage: 'soft-sensor:model-p80-v3',
            note: 'PSA en ligne en maintenance, valeur estimée (sign-off requis)',
          },
          { tag: `${d.grinderTag}.DENSITY_PULP`, unit: '%solids', ts, value: d.feedStream?.solids_pct || 72.0, quality: 'good', confidence: 0.97 },
          { tag: `${d.grinderTag}.BALL_LVL`, unit: '%', ts, value: null, quality: 'missing', confidence: 0.0 },
        ],
      });
    },
  },

  // 1.2 Tags temps réel — lixiviation CIL
  {
    id: 'rt-leaching',
    section: '1. Tags temps réel (OPC-UA / SCADA / Historian)',
    title: 'Batch JSON — tags lixiviation CIL',
    description: 'Chimie de lixiviation en temps réel. Débit pulpe dérivé du débit projet et de la densité de pulpe.',
    format: 'json',
    sourceOf: c => c.opc_source_leaching,
    build: (ctx) => {
      const d = derive(ctx);
      const t0 = addMin(ctx.now, -5);
      const ts = iso(addMin(t0, 0.5));
      const pctSolids = d.feedStream?.solids_pct || 44.0;
      const pulpM3h = r((d.feedTph / (pctSolids / 100)) / (d.feedStream?.density_t_m3 ?? SAMPLE_DATA_FALLBACKS.pulpDensityTM3), 0);
      return J({
        source: ctx.config.opc_source_leaching,
        site: ctx.config.site_code,
        asset_path: 'plant/leaching/cil-train-A',
        period: { from: iso(t0), to: iso(ctx.now) },
        tags: [
          { tag: 'CIL_A.TANK1.PH', unit: 'pH', ts, value: 10.6, quality: 'good', confidence: 0.99 },
          { tag: 'CIL_A.TANK1.CN_FREE', unit: 'mg/L', ts, value: r(d.nacnKgT * 500, 0), quality: 'good', confidence: 0.98 },
          { tag: 'CIL_A.TANK1.DO', unit: 'mg/L', ts, value: 9.2, quality: 'good', confidence: 0.97 },
          { tag: 'CIL_A.TANK1.PCT_SOLIDS', unit: '%solids', ts, value: pctSolids, quality: 'good', confidence: 0.96 },
          { tag: 'CIL_A.TANK1.TEMP', unit: 'degC', ts, value: 26.4, quality: 'good', confidence: 0.99 },
          { tag: 'CIL_A.TANK1.FLOW_PULP', unit: 'm3/h', ts, value: pulpM3h, quality: 'good', confidence: 0.98 },
        ],
      });
    },
  },

  // 2. LIMS JSON
  {
    id: 'lims-json',
    section: '2. Résultats laboratoire (LIMS — assais)',
    title: 'JSON — assais du quart',
    description: 'Échantillons asynchrones avec précision/biais. Courants et teneurs importés des courants COS et des cibles projet ; alimentent la réconciliation.',
    format: 'json',
    sourceOf: c => c.lims_source,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const s1 = addMin(sw.from, 125);
      const s2 = addMin(sw.from, 150);
      const feedId = d.feedStream?.stream_id || 'STREAM_FEED_MILL';
      const tailId = d.tailStream?.stream_id || 'STREAM_TAILINGS';
      return J({
        source: ctx.config.lims_source,
        site: ctx.config.site_code,
        sample_set_id: `ASSAY-${dayStr(ctx.now)}-${sw.id.endsWith('D') ? 'D' : 'N'}`,
        received_at: iso(ctx.now),
        samples: [
          {
            sample_id: `SMP-${compact(s1)}`,
            stream_id: feedId,
            asset_path: `plant/grinding/${(d.grinder?.equipment_tag || 'sag-mill-01').toLowerCase()}/feed`,
            sampled_at: iso(s1),
            shift_id: sw.id,
            material: 'ore_feed',
            analyses: [
              { analyte: 'Au', method: 'fire_assay_AAS', value: r(d.feedAuGt * 1.05, 2), unit: 'g/t', precision_pct: 5.0, bias_pct: -0.4, lab: ctx.config.lab_id, note: `spot ponctuel ; moyenne pondérée du quart ≈ ${r(d.feedAuGt, 2)} g/t` },
              { analyte: 'S_sulfide', method: 'LECO', value: r(d.sulfidesPct, 1), unit: '%S', precision_pct: 3.0, lab: ctx.config.lab_id },
              { analyte: 'As', method: 'ICP', value: r((d.lot?.arsenic_ppm ?? SAMPLE_DATA_FALLBACKS.arsenicPpm) / 10000, 2), unit: '%As', precision_pct: 4.0, lab: ctx.config.lab_id },
              { analyte: 'Corg_PRC', method: 'TOC', value: r(d.prcPct, 2), unit: '%C', precision_pct: 6.0, lab: ctx.config.lab_id, flag: 'preg_robbing_check' },
              { analyte: 'Moisture', method: 'gravimetric', value: SAMPLE_DATA_FALLBACKS.moisturePct, unit: '%H2O', precision_pct: 2.0, lab: ctx.config.lab_id },
            ],
            status: 'provisional',
            signoff: null,
          },
          {
            sample_id: `SMP-${compact(s2)}`,
            stream_id: tailId,
            asset_path: 'plant/tailings/thickener-01/underflow',
            sampled_at: iso(s2),
            shift_id: sw.id,
            material: 'tailings',
            analyses: [
              { analyte: 'Au', method: 'fire_assay_AAS', value: r(d.tailAuGt, 2), unit: 'g/t', precision_pct: 8.0, bias_pct: 0.6, lab: ctx.config.lab_id },
              { analyte: 'CN_WAD', method: 'titration', value: r(d.nacnKgT * 120, 0), unit: 'mg/L', precision_pct: 5.0, lab: ctx.config.lab_id },
            ],
            status: 'final',
            signoff: { by: 'metallurgist:signoff', at: iso(ctx.now) },
          },
        ],
      });
    },
  },

  // 2.2 LIMS CSV
  {
    id: 'lims-csv',
    section: '2. Résultats laboratoire (LIMS — assais)',
    title: 'CSV — format tabulaire alternatif',
    description: 'Même contenu que le JSON LIMS, une ligne par analyte, importable par lot.',
    format: 'csv',
    sourceOf: c => c.lims_source,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const s1 = addMin(sw.from, 125);
      const s2 = addMin(sw.from, 150);
      const feedId = d.feedStream?.stream_id || 'STREAM_FEED_MILL';
      const tailId = d.tailStream?.stream_id || 'STREAM_TAILINGS';
      const feedPath = `plant/grinding/${(d.grinder?.equipment_tag || 'sag-mill-01').toLowerCase()}/feed`;
      const rows = [
        'sample_id,stream_id,asset_path,sampled_at,shift_id,material,analyte,method,value,unit,precision_pct,bias_pct,lab,status,signoff_by',
        `SMP-${compact(s1)},${feedId},${feedPath},${iso(s1)},${sw.id},ore_feed,Au,fire_assay_AAS,${r(d.feedAuGt * 1.05, 2)},g/t,5.0,-0.4,${ctx.config.lab_id},provisional,`,
        `SMP-${compact(s1)},${feedId},${feedPath},${iso(s1)},${sw.id},ore_feed,S_sulfide,LECO,${r(d.sulfidesPct, 1)},%S,3.0,,${ctx.config.lab_id},provisional,`,
        `SMP-${compact(s2)},${tailId},plant/tailings/thickener-01/underflow,${iso(s2)},${sw.id},tailings,Au,fire_assay_AAS,${r(d.tailAuGt, 2)},g/t,8.0,0.6,${ctx.config.lab_id},final,signoff`,
      ];
      return rows.join('\n');
    },
  },

  // 3.1 Ore lots
  {
    id: 'ore-lots',
    section: '3. Lots de minerai et alimentation minier',
    title: 'JSON — lots de minerai (caractérisation géo-métallurgique)',
    description: 'Lots réels importés de l\'onglet Blending (cos_ore_lots) ; à défaut, lot exemple dérivé des paramètres projet.',
    format: 'json',
    sourceOf: c => c.geomet_source,
    build: (ctx) => {
      const d = derive(ctx);
      const lots = ctx.oreLots.length > 0 ? ctx.oreLots.slice(0, 3) : null;
      const mk = (l: CosOreLot | null, i: number) => ({
        lot_id: l?.lot_id || `ORELOT-${dayStr(ctx.now).replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
        origin: { mine: ctx.config.mine_name, bench: 'B-0000', block: 'BLK-0000' },
        tonnage_dry_t: r(l?.tonnage_t ?? ctx.project.target_tph * 12, 0),
        characterization: {
          Au_g_t: r(l?.au_g_t ?? ctx.project.gold_grade_g_t, 2),
          S_sulfide_pct: r(l?.sulfides_pct ?? d.sulfidesPct, 2),
          As_pct: r((l?.arsenic_ppm ?? SAMPLE_DATA_FALLBACKS.arsenicPpm) / 10000, 3),
          Corg_PRC_pct: r(l?.organic_carbon_pct ?? d.prcPct, 2),
          Moisture_pct: 7.5,
          BWi_kWh_t: l?.bwi ?? null,
          SPI_min: l?.spi ?? null,
          clay_pct: r(l?.clay_pct ?? SAMPLE_DATA_FALLBACKS.clayPct, 1),
        },
        ore_type: (l?.organic_carbon_pct ?? d.prcPct) > 0.4 ? 'sulfide_partial_PRC' : 'sulfide',
        expected_recovery_pct: r(predictRecovery(l?.au_g_t ?? d.feedAuGt, l?.sulfides_pct ?? d.sulfidesPct, l?.organic_carbon_pct ?? d.prcPct, l?.bwi ?? null), 1),
        constraints: { max_PRC_blend_pct: 1.0, max_As_blend_pct: 0.25 },
        stockpile_id: l?.stockpile_id ?? d.stockpile?.name ?? 'SP-ROM-01',
        loaded_at: iso(addMin(ctx.now, -240)),
      });
      return J({
        source: ctx.config.geomet_source,
        site: ctx.config.site_code,
        ore_lots: lots ? lots.map((l, i) => mk(l, i)) : [mk(null, 0)],
      });
    },
  },

  // 3.2 Movements CSV
  {
    id: 'ore-movements',
    section: '3. Lots de minerai et alimentation minier',
    title: 'CSV — mouvements de minerai (ponts-bascules)',
    description: 'Mouvements camion mine → stockpile, tonnages humide/sec liés au lot.',
    format: 'csv',
    sourceOf: c => c.geomet_source,
    build: (ctx) => {
      const d = derive(ctx);
      const lotId = d.lot?.lot_id || `ORELOT-${dayStr(ctx.now).replace(/-/g, '')}-001`;
      const sp = d.stockpile?.name ?? 'SP-ROM-01';
      const moist = SAMPLE_DATA_FALLBACKS.moisturePct;
      const wet = r(ctx.project.target_tph / 5, 1); // charge camion ≈ débit/5
      const t1 = iso(addMin(ctx.now, -40));
      const t2 = iso(addMin(ctx.now, -36));
      return [
        'movement_id,ts,from,to,lot_id,tonnage_wet_t,moisture_pct,tonnage_dry_t,truck_id,operator',
        `MV-${compact(addMin(ctx.now, -40))},${t1},${ctx.config.mine_name}/B-0000,${sp},${lotId},${wet},${moist},${r(wet * (1 - moist / 100), 2)},TR-0001,operator:op1`,
        `MV-${compact(addMin(ctx.now, -36))},${t2},${ctx.config.mine_name}/B-0000,${sp},${lotId},${r(wet * 0.98, 1)},${moist},${r(wet * 0.98 * (1 - moist / 100), 2)},TR-0002,operator:op1`,
      ].join('\n');
    },
  },

  // 4. Stockpiles
  {
    id: 'stockpiles',
    section: '4. Stockpiles (modèle de tas / reclaim)',
    title: 'JSON — inventaire stockpiles',
    description: 'Stockpiles réels importés du module COS (cos_stockpiles) avec composition mélangée ; couches dérivées des lots.',
    format: 'json',
    sourceOf: c => c.geomet_source,
    build: (ctx) => {
      const d = derive(ctx);
      const sps = ctx.stockpiles.length > 0 ? ctx.stockpiles : null;
      const mk = (sp: CosStockpile | null) => ({
        stockpile_id: sp?.name ?? 'SP-ROM-01',
        type: 'rom',
        capacity_t: r((sp?.current_tonnage_t ?? ctx.project.target_tph * 100) * 2, 0),
        current_inventory_dry_t: r(sp?.current_tonnage_t ?? ctx.project.target_tph * 40, 0),
        layers: ctx.oreLots.slice(0, 2).map(l => ({
          lot_id: l.lot_id,
          tonnage_dry_t: r(l.tonnage_t, 0),
          Au_g_t: r(l.au_g_t, 2),
          placed_at: iso(addMin(ctx.now, -720)),
        })),
        blended_composite: {
          Au_g_t: r(sp?.blended_au_g_t ?? d.feedAuGt, 2),
          S_sulfide_pct: r(sp?.blended_sulfides_pct ?? d.sulfidesPct, 2),
          Corg_PRC_pct: r(sp?.blended_prc_pct ?? d.prcPct, 2),
        },
        last_reclaim_plan_id: `BLEND-PLAN-${dayStr(ctx.now)}-D-01`,
      });
      return J({
        site: ctx.config.site_code,
        stockpiles: sps ? sps.map(mk) : [mk(null)],
      });
    },
  },

  // 5. Reagents & utilities
  {
    id: 'reagents',
    section: '5. Consommation réactifs & utilités',
    title: 'JSON — réactifs et utilités horaires',
    description: 'Doses NaCN/CaO dérivées des modèles empiriques du moteur COS (teneur/sulfures du blend courant) ; électricité dérivée du débit.',
    format: 'json',
    sourceOf: c => c.opc_source_utilities,
    build: (ctx) => {
      const d = derive(ctx);
      const t0 = addMin(ctx.now, -60);
      const tph = d.feedTph;
      return J({
        source: ctx.config.opc_source_utilities,
        site: ctx.config.site_code,
        period: { from: iso(t0), to: iso(ctx.now) },
        reagents: [
          { reagent: 'NaCN', asset_path: 'plant/leaching/cil-train-A/dosing', consumed_kg: r(d.nacnKgT * tph, 1), dose_kg_t: d.nacnKgT, stock_t: r(d.nacnKgT * tph * 24 * 3 / 1000, 1), quality: 'good' },
          { reagent: 'CaO_lime', asset_path: 'plant/leaching/cil-train-A/dosing', consumed_kg: r(d.caoKgT * tph, 1), dose_kg_t: d.caoKgT, stock_t: r(d.caoKgT * tph * 24 * 3 / 1000, 1), quality: 'good' },
          { reagent: 'NaOH', asset_path: 'plant/elution/elution-circuit-A', consumed_kg: r(tph * 0.04, 1), stock_t: r(tph * 0.04 * 24 * 3 / 1000, 1), quality: 'good' },
          { reagent: 'activated_carbon', asset_path: 'plant/adsorption/cil-train-A/carbon', fresh_added_kg: 0, stock_t: r(tph * 0.02, 1), quality: 'good' },
          { reagent: 'O2', asset_path: 'plant/leaching/cil-train-A/oxygen', consumed_Nm3: r(tph * 0.6, 0), quality: 'good' },
        ],
        utilities: [
          { utility: 'electricity', asset_path: 'plant', consumed_kWh: r(tph * 15.5, 0) },
          { utility: 'process_water', asset_path: 'plant', consumed_m3: r(tph * 1.3, 0) },
          { utility: 'raw_water', asset_path: 'plant', consumed_m3: r(tph * 0.085, 0) },
        ],
      });
    },
  },

  // 6. CMMS events
  {
    id: 'cmms-events',
    section: '6. Événements équipements & arrêts (CMMS)',
    title: 'JSON — événements et arrêts',
    description: 'Événements dérivés de l\'état réel des équipements COS (pannes en cours, causes d\'arrêt).',
    format: 'json',
    sourceOf: c => c.cmms_source,
    build: (ctx) => {
      const d = derive(ctx);
      const faulty = ctx.equipment.find(e => e.state === 'fault') ?? null;
      const eq = faulty ?? d.grinder;
      const path = `plant/${eq?.section ?? 'grinding'}/${(eq?.equipment_tag ?? 'sag-mill-01').toLowerCase()}`;
      return J({
        source: ctx.config.cmms_source,
        site: ctx.config.site_code,
        events: [
          {
            event_id: `EVT-${compact(addMin(ctx.now, -30))}`,
            asset_path: path,
            type: faulty ? 'downtime' : 'performance_loss',
            severity: faulty ? 'high' : 'low',
            reason_code: (faulty?.downtime_reason ?? 'PERF_DEGRADATION').toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
            started_at: iso(addMin(ctx.now, -30)),
            ended_at: faulty ? null : iso(addMin(ctx.now, -12)),
            duration_min: faulty ? null : 18,
            description: faulty
              ? `${faulty.equipment_name} en arrêt — ${faulty.downtime_reason ?? 'cause à documenter'}`
              : `${eq?.equipment_name ?? 'Équipement'} en perte de performance`,
            work_order_id: null,
            operator: 'operator:op1',
          },
        ],
      });
    },
  },

  // 6.1 Work orders CSV
  {
    id: 'work-orders',
    section: '6. Événements équipements & arrêts (CMMS)',
    title: 'CSV — ordres de travail',
    description: 'Ordres de travail correctifs/préventifs rattachés aux équipements COS.',
    format: 'csv',
    sourceOf: c => c.cmms_source,
    build: (ctx) => {
      const d = derive(ctx);
      const path = `plant/${d.grinder?.section ?? 'grinding'}/${(d.grinder?.equipment_tag ?? 'sag-mill-01').toLowerCase()}`;
      return [
        'wo_id,asset_path,type,priority,created_at,scheduled_at,status,assignee,description',
        `WO-${compact(addMin(ctx.now, -60)).slice(4)},${path},corrective,3,${iso(addMin(ctx.now, -60))},${iso(addMin(ctx.now, 30))},planned,mech:m1,Inspection suite alerte santé (${d.grinder?.health_index ?? 100}/100)`,
        `WO-${compact(ctx.now).slice(4)},plant/leaching/cil-train-A/oxygen,preventive,2,${iso(ctx.now)},${iso(addMin(ctx.now, 1080))},planned,inst:i1,Calibrage débitmètre O2`,
      ].join('\n');
    },
  },

  // 7. Shifts & campaigns
  {
    id: 'shifts',
    section: '7. Contexte opérationnel (shifts / campagnes)',
    title: 'JSON — quart courant et campagne',
    description: 'Fenêtre de quart calculée depuis la config (début UTC + durée) ; cibles importées du projet (débit, récupération, onces).',
    format: 'json',
    sourceOf: c => `site:${c.site_code}`,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const hours = ctx.config.shift_duration_h;
      const ozTarget = r(ctx.project.target_tph * hours * d.feedAuGt * (d.recoveryPct / 100) / TROY_OZ_GRAMS, 0);
      return J({
        site: ctx.config.site_code,
        shifts: [
          {
            shift_id: sw.id,
            type: sw.id.endsWith('D') ? 'day' : 'night',
            tz: ctx.config.tz,
            start: iso(sw.from),
            end: iso(sw.to),
            campaign_id: `CAMP-${ctx.now.getUTCFullYear()}-${ctx.project.code || 'default'}`,
            supervisor: 'shift-lead:sup1',
            crew: ['operator:op1', 'operator:op2', 'metallurgist:met1'],
            targets: {
              throughput_t_h: ctx.project.target_tph,
              recovery_pct: r(d.recoveryPct, 1),
              Au_oz_target: ozTarget,
            },
          },
        ],
        campaigns: [
          {
            campaign_id: `CAMP-${ctx.now.getUTCFullYear()}-${ctx.project.code || 'default'}`,
            ore_strategy: d.prcPct > 0.4 ? 'stabilize_feed_blend_PRC_diluted' : 'stabilize_feed_blend',
            start: iso(addMin(sw.from, -2880)),
            end: null,
            notes: `Campagne ${ctx.project.name}`,
          },
        ],
      });
    },
  },

  // 8. Inventories
  {
    id: 'inventories',
    section: '8. Inventaires en cours (pour réconciliation)',
    title: 'JSON — snapshot des encours physiques',
    description: 'Encours circuit dérivés du débit projet et des courants COS — nécessaires au bilan entrée-sortie-stock (P754).',
    format: 'json',
    sourceOf: c => `site:${c.site_code}`,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const pctSolids = d.feedStream?.solids_pct || 44;
      const circuitVolM3 = r(d.feedTph * 6.5, 0); // ~6.5 h de rétention CIL
      return J({
        site: ctx.config.site_code,
        snapshot_at: iso(sw.to),
        inventories: [
          {
            asset_path: 'plant/leaching/cil-train-A/tank-1..6',
            material: 'pulp_in_circuit',
            volume_m3: circuitVolM3,
            pct_solids: pctSolids,
            Au_solution_mg_L: r(d.feedAuGt * 0.55, 2),
            Au_carbon_g_t: r(d.feedAuGt * 1000, 0),
            carbon_t: r(d.feedTph * 0.045, 1),
          },
          {
            asset_path: 'plant/adsorption/cil-train-A/loaded_carbon',
            material: 'loaded_carbon',
            mass_t: r(d.feedTph * 0.015, 1),
            Au_g_t: r(d.feedAuGt * 1000, 0),
          },
          {
            asset_path: 'plant/elution/elution-circuit-A/electrowin_cell',
            material: 'gold_sludge',
            mass_t: r(d.feedTph * 0.00004, 3),
            Au_g_t: 185000,
          },
          {
            asset_path: 'plant/refining/gold_room/safe',
            material: 'dore_bar',
            count: 4,
            mass_t: r(d.feedTph * 0.0001, 3),
            Au_g_t: 920000,
            inventory_role: 'stocktake_snapshot_not_period_output',
          },
        ],
      });
    },
  },

  // 9. Blend optimize request
  {
    id: 'blend-request',
    section: '9. Requête de plan de blend (entrée de l\'optimiseur)',
    title: 'JSON — POST /blend/optimize',
    description: 'Sources = lots COS disponibles ; cibles/contraintes importées du projet (débit, teneur min) — mêmes contraintes que l\'optimiseur de l\'onglet Blending.',
    format: 'json',
    sourceOf: c => `site:${c.site_code}`,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const sources = (ctx.oreLots.length > 0 ? ctx.oreLots.filter(l => l.is_available) : []).map(l => ({
        stockpile_id: l.stockpile_id ?? l.source_name,
        available_dry_t: r(l.tonnage_t, 0),
        Au_g_t: r(l.au_g_t, 2),
        S_sulfide_pct: r(l.sulfides_pct, 2),
        Corg_PRC_pct: r(l.organic_carbon_pct, 2),
        BWi_kWh_t: l.bwi,
      }));
      return J({
        site: ctx.config.site_code,
        shift_id: sw.id,
        horizon_h: ctx.config.shift_duration_h,
        objective: 'maximize_value_net',
        targets: {
          feed_t_h: ctx.project.target_tph,
          Au_feed_g_t_min: r(ctx.project.gold_grade_g_t * 0.6, 2),
          feed_stability_pct: 95,
        },
        available_sources: sources.length > 0 ? sources : [{
          stockpile_id: d.stockpile?.name ?? 'SP-ROM-01',
          available_dry_t: r(d.stockpile?.current_tonnage_t ?? ctx.project.target_tph * 40, 0),
          Au_g_t: r(d.feedAuGt, 2),
          S_sulfide_pct: r(d.sulfidesPct, 2),
          Corg_PRC_pct: r(d.prcPct, 2),
          BWi_kWh_t: d.lot?.bwi ?? null,
        }],
        constraints: {
          max_Corg_PRC_pct: 1.5,
          max_As_pct: 0.25,
          min_throughput_t_h: r(ctx.project.target_tph * 0.9, 0),
          max_BWi_kWh_t: 18,
          logistics: { max_reclaim_feeders: 2 },
        },
        weights: { recovery: 0.6, throughput: 0.3, reagent_cost: 0.1 },
      });
    },
  },

  // 10. Reconciliation request
  {
    id: 'recon-request',
    section: '10. Requête de réconciliation (entrée du solver)',
    title: 'JSON — POST /reconciliation/run',
    description: 'Courants importés du module COS (feed/product/tail), masses agrégées sur la durée du quart, méthode moindres carrés pondérés (AMIRA P754).',
    format: 'json',
    sourceOf: c => `site:${c.site_code}`,
    build: (ctx) => {
      const d = derive(ctx);
      const sw = shiftWindow(ctx.now, ctx.config);
      const h = ctx.config.shift_duration_h;
      const mkStream = (s: CosStream | null, fallbackId: string, dir: 'in' | 'out', massT: number, auGt: number, mp: number, gp: number) => ({
        stream_id: s?.stream_id ?? fallbackId,
        direction: dir,
        mass_dry_t: r(massT, 1),
        Au_g_t: r(auGt, auGt > 1000 ? 0 : 3),
        mass_precision_pct: mp,
        grade_precision_pct: gp,
      });
      const streams = [
        mkStream(d.feedStream, 'STREAM_FEED_MILL', 'in', d.feedTph * h, d.feedAuGt, 1.0, 5.0),
        mkStream(d.productStream, 'STREAM_LOADED_CARBON_A', 'out', d.feedTph * h * 0.0005, d.feedAuGt * 1000, 2.0, 6.0),
        mkStream(d.tailStream, 'STREAM_TAILINGS', 'out', d.feedTph * h * 0.99, d.tailAuGt, 1.5, 8.0),
      ];
      return J({
        site: ctx.config.site_code,
        period: { from: iso(sw.from), to: iso(sw.to) },
        shift_id: sw.id,
        level: 'shift',
        streams,
        inventory_deltas: [
          { asset_path: 'plant/leaching/cil-train-A', Au_in_circuit_delta_g: r(d.feedTph * h * d.feedAuGt * 0.01, 0) },
        ],
        method: 'weighted_least_squares',
        provisional_streams: ctx.streams.filter(s => s.is_provisional).map(s => s.stream_id),
      });
    },
  },

  // 11. Bus event
  {
    id: 'bus-event',
    section: '11. Schéma d\'événement COS (bus)',
    title: 'JSON — recommendation.created',
    description: 'Événement produit/consommé sur le bus. Entité et setpoints dérivés de l\'équipement broyage réel et du corridor de débit projet (±7 %).',
    format: 'json',
    sourceOf: c => `bus:${c.site_code}`,
    build: (ctx) => {
      const d = derive(ctx);
      const lo = r(ctx.project.target_tph * 0.93, 0);
      const hi = r(ctx.project.target_tph * 1.07, 0);
      return J({
        event: 'recommendation.created',
        ts: iso(ctx.now),
        site: ctx.config.site_code,
        entity: `equipment:${(d.grinder?.equipment_tag ?? 'sag-mill-01').toLowerCase()}`,
        domain: 'optimization.grinding',
        objective: 'maximize_throughput_within_p80',
        actions: [
          { setpoint: 'feed_rate', value: r(Math.min(hi, d.feedTph * 1.015), 1), unit: 't/h', within_corridor: [lo, hi] },
        ],
        expected_delta: { throughput: '+1.5%', recovery: '+0.1%' },
        confidence: 0.86,
        evidence: [
          { tag: `${d.grinderTag}.PWR`, note: 'sous-chargé' },
          { tag: `${d.grinderTag}.P80`, note: 'cible respectée' },
        ],
        status: 'pending_approval',
      });
    },
  },
];

/** Groupe les templates par section, dans l'ordre de déclaration. */
export function groupTemplatesBySection(templates: IngestionTemplate[]): Array<{ section: string; items: IngestionTemplate[] }> {
  const out: Array<{ section: string; items: IngestionTemplate[] }> = [];
  for (const t of templates) {
    const g = out.find(x => x.section === t.section);
    if (g) g.items.push(t); else out.push({ section: t.section, items: [t] });
  }
  return out;
}
