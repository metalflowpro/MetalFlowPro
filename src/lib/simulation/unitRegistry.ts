// ─── Unit Registry — complete process unit library ────────────────────────────
import type { UnitDefinition, StreamResult, UnitOutput } from './types';
import { DEFAULT_ASSUMPTIONS, FEED_STREAM_DEFAULTS, PHYSICAL_CONSTANTS } from '../config/constants';

const FARADAY = PHYSICAL_CONSTANTS.FARADAY_C_PER_MOL;
const M_AU    = PHYSICAL_CONSTANTS.AU_MOLAR_MASS_G_PER_MOL;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * pH d'un mélange de flux.
 *
 * Le pH est une grandeur LOGARITHMIQUE : le moyenner linéairement est faux.
 * Mélanger à masses égales un flux à pH 10.5 et un à pH 12.5 ne donne pas
 * pH 11.5 mais pH 12.2 — le flux le plus alcalin domine, car il apporte cent
 * fois plus d'ions hydroxyde.
 *
 * On moyenne donc les concentrations, pas les pH. Au-dessus de pH 7 c'est
 * [OH⁻] qui porte l'alcalinité (protective alkalinity du circuit cyanure) ;
 * en dessous c'est [H⁺]. L'écart compte directement pour la spéciation du
 * cyanure autour du pKa de HCN (≈ 9.3) et donc pour le dosage de chaux.
 */
export function blendPh(inputs: Array<{ pH: number; weight: number }>): number {
  const valid = inputs.filter(i => i.weight > 0 && Number.isFinite(i.pH));
  if (!valid.length) return 7;
  const w = valid.reduce((s, i) => s + i.weight, 0);
  if (w === 0) return 7;

  // Moyenne pondérée des concentrations en ion hydroxyde, puis retour au pH.
  const oh = valid.reduce((s, i) => {
    const pOH = 14 - Math.min(14, Math.max(0, i.pH));
    return s + Math.pow(10, -pOH) * i.weight;
  }, 0) / w;

  if (oh <= 0) return 7;
  return Math.min(14, Math.max(0, 14 + Math.log10(oh)));
}

export function blendInputs(inputs: StreamResult[]): StreamResult {
  if (!inputs.length) return emptyStream();
  const total_mass = inputs.reduce((s, i) => s + i.mass_flow, 0);
  if (total_mass === 0) return emptyStream();
  const total_vol  = inputs.reduce((s, i) => s + i.volume_flow, 0);
  return {
    edge_id:               inputs[0].edge_id ?? '',
    mass_flow:             total_mass,
    volume_flow:           total_vol,
    solids_content:        inputs.reduce((s, i) => s + i.solids_content * i.mass_flow, 0) / total_mass,
    gold_grade:            inputs.reduce((s, i) => s + i.gold_grade * i.mass_flow, 0) / total_mass,
    gold_flow:             inputs.reduce((s, i) => s + i.gold_flow, 0),
    dissolved_gold:        inputs.reduce((s, i) => s + i.dissolved_gold * i.volume_flow, 0) / Math.max(0.01, total_vol),
    cyanide_concentration: inputs.reduce((s, i) => s + i.cyanide_concentration * i.mass_flow, 0) / total_mass,
    // Le pH suit la chimie de la phase aqueuse : pondéré par le volume, pas
    // par la masse de solides, et moyenné en concentration (cf. blendPh).
    pH:                    blendPh(inputs.map(i => ({ pH: i.pH, weight: i.volume_flow > 0 ? i.volume_flow : i.mass_flow }))),
    temperature:           inputs.reduce((s, i) => s + i.temperature * i.mass_flow, 0) / total_mass,
  };
}

export function emptyStream(): StreamResult {
  return {
    edge_id: '', mass_flow: 0, volume_flow: 0, solids_content: 0,
    gold_grade: 0, gold_flow: 0, dissolved_gold: 0,
    cyanide_concentration: 0, pH: FEED_STREAM_DEFAULTS.pH, temperature: FEED_STREAM_DEFAULTS.temperatureC,
  };
}

function p(params: Record<string, number | string>, key: string, def: number): number {
  const v = params[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

/** Split every extensive stream quantity by the same fraction. */
function splitStream(feed: StreamResult, fraction: number, overrides: Partial<StreamResult> = {}): StreamResult {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    ...feed,
    mass_flow: feed.mass_flow * f,
    volume_flow: feed.volume_flow * f,
    gold_flow: feed.gold_flow * f,
    ...overrides,
  };
}

function passThrough(feed: StreamResult, energyKwht = 0, reagents: Record<string,number> = {}, cap = 500): UnitOutput {
  const util = feed.mass_flow / Math.max(1, cap);
  return {
    outStreams: [{ ...feed }],
    nodeResult: {
      feed_rate: feed.mass_flow, product_rate: feed.mass_flow,
      recovery: 100, energy_consumption: energyKwht,
      reagent_consumptions: reagents,
      utilization_rate: util, is_bottleneck: util > 0.85, kpis: {},
    },
  };
}

/**
 * Séparation par flottation — un séparateur, PAS un récupérateur.
 *
 * ⚠️ Convention métallurgique verrouillée : la flottation NE récupère pas d'or
 * en produit final, elle SÉPARE le flux en concentré + rejets. La répartition de
 * la masse d'or est faite ici par bilan (conc reçoit `auRecPct` de l'or, les
 * rejets le complément) ; le champ `recovery` du nœud n'est qu'un AFFICHAGE de
 * l'or dirigé vers le concentré. C'est le bilan métal du solveur (or au produit
 * vs or aux résidus, courant par courant) qui fixe la récupération GLOBALE — la
 * valeur de nœud n'est jamais composée en série. Ainsi, selon que le concentré
 * ou les rejets sont ensuite lixiviés, le graphe donne R_f×R_l ou l'additif,
 * sans qu'aucune formule ne soit codée.
 *
 * Sorties : [0] concentré, [1] rejets — l'ordre des arêtes sortantes doit suivre.
 */
function flotationSplit(
  feed: StreamResult,
  massPullPct: number,
  auRecPct: number,
  opts: { energyKwht: number; collectorKgT: number; frotherKgT: number; cap: number },
): UnitOutput {
  const massPull = Math.max(0, Math.min(1, massPullPct / 100));
  const auRec = Math.max(0, Math.min(1, auRecPct / 100));
  const concMass = feed.mass_flow * massPull;
  const tailMass = feed.mass_flow * (1 - massPull);
  const concGold = feed.gold_flow * auRec;
  const tailGold = feed.gold_flow * (1 - auRec);
  return {
    outStreams: [
      { ...emptyStream(), mass_flow: concMass, volume_flow: feed.volume_flow * massPull,
        gold_flow: concGold, gold_grade: concGold / Math.max(0.0001, concMass) * 1000,
        solids_content: feed.solids_content, pH: feed.pH, temperature: feed.temperature },
      { ...feed, mass_flow: tailMass, volume_flow: feed.volume_flow * (1 - massPull),
        gold_flow: tailGold, gold_grade: tailGold / Math.max(0.0001, tailMass) * 1000 },
    ],
    nodeResult: {
      feed_rate: feed.mass_flow, product_rate: concMass,
      recovery: auRec * 100, // AFFICHAGE : part d'or vers le concentré, non composée
      energy_consumption: opts.energyKwht,
      reagent_consumptions: { collector_pax: opts.collectorKgT, frother_mibc: opts.frotherKgT },
      utilization_rate: feed.mass_flow / Math.max(1, opts.cap),
      is_bottleneck: false,
      kpis: { mass_pull_pct: massPull * 100, au_to_concentrate_pct: auRec * 100,
        concentrate_grade_g_t: concGold / Math.max(0.0001, concMass) * 1000,
        upgrade_ratio: massPull > 0 ? auRec / massPull : 0 },
    },
  };
}

// ─── Unit Definitions ─────────────────────────────────────────────────────────

const units: UnitDefinition[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITAIRES — alimentation & transfert
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'feed_source', displayName: 'Alimentation ROM', category: 'Utilitaires',
    icon: '⬇', color: '#6B7280', maxInputs: 0, maxOutputs: 1,
    defaultParameters: {
      feed_rate:        { label: 'Débit (t/h)',            unit: 't/h',   default: 250,   type: 'number', min: 1 },
      gold_grade:       { label: 'Teneur Au (g/t)',         unit: 'g/t',   default: 2.0,   type: 'number', min: 0 },
      silver_grade:     { label: 'Teneur Ag (g/t)',         unit: 'g/t',   default: 10,    type: 'number', min: 0 },
      p80:              { label: 'P80 alimentation (µm)',    unit: 'µm',    default: 150000, type: 'number' },
      hardness_bwi:     { label: 'BWI (kWh/t)',             unit: 'kWh/t', default: DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T, type: 'number' },
      sulphide_content: { label: 'Sulfures (%)',             unit: '%',     default: 1.5,   type: 'number' },
      moisture:         { label: 'Humidité (%)',             unit: '%',     default: 3,     type: 'number' },
    },
    calculate(_, params) {
      const feed_rate  = p(params,'feed_rate', 250);
      const gold_grade = p(params,'gold_grade', 2.0);
      const moisture   = p(params,'moisture', 3) / 100;
      const dry_rate   = feed_rate * (1 - moisture);
      return {
        outStreams: [{
          edge_id: '', mass_flow: dry_rate, volume_flow: dry_rate / DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3,
          solids_content: 100, gold_grade,
          gold_flow: dry_rate * gold_grade / 1000,
          dissolved_gold: 0, cyanide_concentration: 0, pH: FEED_STREAM_DEFAULTS.pH, temperature: FEED_STREAM_DEFAULTS.temperatureC,
        }],
        nodeResult: {
          feed_rate, product_rate: dry_rate, recovery: 100,
          energy_consumption: 0, reagent_consumptions: {}, utilization_rate: 1,
          is_bottleneck: false, kpis: { moisture_pct: moisture * 100 },
        },
      };
    },
  },

  {
    unitType: 'stockpile', displayName: 'Stockpile ROM', category: 'Utilitaires',
    icon: '⛰', color: '#78716C', maxInputs: 2, maxOutputs: 1,
    defaultParameters: {
      live_capacity_t: { label: 'Capacité vive (t)', unit: 't', default: 10000, type: 'number' },
      reclaim_rate:    { label: 'Débit reprise (t/h)', unit: 't/h', default: 300, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.05, {}, p(params,'reclaim_rate',300));
    },
  },

  {
    unitType: 'silo', displayName: 'Silo de stockage', category: 'Utilitaires',
    icon: '🗄', color: '#92400E', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      capacity_t:    { label: 'Capacité (t)',        unit: 't',   default: 500,  type: 'number' },
      discharge_rate:{ label: 'Débit sortie (t/h)',  unit: 't/h', default: 300,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.02, {}, p(params,'discharge_rate',300));
    },
  },

  {
    unitType: 'apron_feeder', displayName: 'Alimentateur tablier', category: 'Utilitaires',
    icon: '🔗', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      width_m:       { label: 'Largeur (m)',      unit: 'm',   default: 1.8,  type: 'number' },
      speed_m_min:   { label: 'Vitesse (m/min)',  unit: 'm/min', default: 8,  type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',   unit: 't/h', default: 400,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.03, {}, p(params,'design_tph',400));
    },
  },

  {
    unitType: 'belt_conveyor', displayName: 'Convoyeur à bande', category: 'Utilitaires',
    icon: '➡', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      length_m:      { label: 'Longueur (m)',      unit: 'm',   default: 200,  type: 'number' },
      width_mm:      { label: 'Largeur bande (mm)', unit: 'mm', default: 1200, type: 'number' },
      speed_m_s:     { label: 'Vitesse (m/s)',      unit: 'm/s', default: 2.5,  type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',      unit: 't/h', default: 500, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.15, {}, p(params,'design_tph',500));
    },
  },

  {
    unitType: 'vibrating_feeder', displayName: 'Alimentateur vibrant', category: 'Utilitaires',
    icon: '📳', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      width_mm:    { label: 'Largeur (mm)',     unit: 'mm',  default: 1200, type: 'number' },
      length_mm:   { label: 'Longueur (mm)',    unit: 'mm',  default: 4000, type: 'number' },
      design_tph:  { label: 'Capacité (t/h)',   unit: 't/h', default: 300,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.04, {}, p(params,'design_tph',300));
    },
  },

  {
    unitType: 'stream_splitter', displayName: 'Diviseur de flux', category: 'Utilitaires',
    icon: '⋈', color: '#6B7280', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      split_pct: { label: 'Sortie 1 (%)', unit: '%', default: 50, type: 'number', min: 5, max: 95 },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      const split = p(params,'split_pct', 50) / 100;
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * split,       volume_flow: feed.volume_flow * split,       gold_flow: feed.gold_flow * split },
          { ...feed, mass_flow: feed.mass_flow * (1-split),   volume_flow: feed.volume_flow * (1-split),   gold_flow: feed.gold_flow * (1-split) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0, reagent_consumptions: {}, utilization_rate: 0.5, is_bottleneck: false, kpis: { split_pct: split*100 } },
      };
    },
  },

  {
    unitType: 'stream_mixer', displayName: 'Mélangeur de flux', category: 'Utilitaires',
    icon: '⤧', color: '#6B7280', maxInputs: 4, maxOutputs: 1,
    defaultParameters: {},
    calculate(inputs) {
      const mixed = blendInputs(inputs);
      return { outStreams: [mixed], nodeResult: { feed_rate: mixed.mass_flow, product_rate: mixed.mass_flow, recovery: 100, energy_consumption: 0, reagent_consumptions: {}, utilization_rate: 0.5, is_bottleneck: false, kpis: {} } };
    },
  },

  {
    unitType: 'reagent_addition', displayName: 'Ajout de réactif', category: 'Utilitaires',
    icon: '🧪', color: '#A78BFA', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      reagent_name: { label: 'Réactif',          unit: '',      default: 'NaCN',  type: 'text' },
      dosage_kg_t:  { label: 'Dosage (kg/t)',    unit: 'kg/t',  default: 0.5,     type: 'number', min: 0 },
      solution_pct: { label: 'Concentration (%)', unit: '%',    default: 10,      type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const dosage = p(params,'dosage_kg_t', 0.5);
      const name   = String(params['reagent_name'] || 'NaCN');
      return { ...passThrough(feed, 0.01), nodeResult: { ...passThrough(feed,0.01).nodeResult, reagent_consumptions: { [name + '_kg_t']: dosage }, kpis: { dosage_kg_t: dosage } } };
    },
  },

  {
    unitType: 'sampling_station', displayName: 'Station d\'échantillonnage', category: 'Utilitaires',
    icon: '🔬', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      sample_cut_pct: { label: 'Coupure échantillon (%)', unit: '%', default: 2, type: 'number' },
    },
    calculate(inputs, _params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed);
    },
  },

  {
    unitType: 'pump', displayName: 'Pompe process', category: 'Utilitaires',
    icon: '🔄', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      flow_m3_h:    { label: 'Débit (m³/h)',    unit: 'm³/h', default: 500,  type: 'number' },
      head_m:       { label: 'Hauteur (m)',      unit: 'm',    default: 30,   type: 'number' },
      efficiency:   { label: 'Rendement (%)',    unit: '%',    default: 75,   type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const Q = p(params,'flow_m3_h', 500);
      const H = p(params,'head_m', 30);
      const n = p(params,'efficiency', 75) / 100;
      const kw = (Q * H * 1.05) / (367 * n);
      const energy = feed.mass_flow > 0 ? kw / feed.mass_flow : 0;
      return passThrough(feed, energy);
    },
  },

  {
    unitType: 'agitator', displayName: 'Agitateur / Cuve agitée', category: 'Utilitaires',
    icon: '🌀', color: '#6B7280', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      volume_m3:      { label: 'Volume (m³)',          unit: 'm³',  default: 500,  type: 'number' },
      power_kw:       { label: 'Puissance (kW)',        unit: 'kW',  default: 110,  type: 'number' },
      design_tph:     { label: 'Capacité (t/h)',        unit: 't/h', default: 250,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const kw = p(params,'power_kw', 110);
      const energy = feed.mass_flow > 0 ? kw / feed.mass_flow : 0;
      return passThrough(feed, energy, {}, p(params,'design_tph',250));
    },
  },

  {
    unitType: 'product_sink', displayName: 'Sortie / Résidus', category: 'Utilitaires',
    icon: '✓', color: '#10B981', maxInputs: 4, maxOutputs: 0,
    defaultParameters: {},
    calculate(inputs) {
      const all = blendInputs(inputs);
      return {
        outStreams: [],
        nodeResult: {
          feed_rate: all.mass_flow, product_rate: all.mass_flow,
          recovery: 100, energy_consumption: 0, reagent_consumptions: {}, utilization_rate: 1, is_bottleneck: false,
          kpis: { total_gold_flow_kg_h: all.gold_flow, mass_flow_t_h: all.mass_flow },
        },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // COMMINUTION
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'primary_gyratory', displayName: 'Concasseur giratoire primaire', category: 'Comminution',
    icon: '🔷', color: '#F59E0B', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      gap_mm:          { label: 'Ouverture CSS (mm)',      unit: 'mm',  default: 165,  type: 'number', min: 80, max: 250 },
      throughput_tph:  { label: 'Capacité nominale (t/h)', unit: 't/h', default: 3000, type: 'number' },
      css_p80_factor:  { label: 'Facteur P80/CSS',          unit: '',    default: 3.5,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const css      = p(params,'gap_mm', 165);
      const _p80_out  = css * p(params,'css_p80_factor', 3.5) * 1000; // µm
      const cap      = design_capacity ?? p(params,'throughput_tph', 3000);
      const util     = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.5, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product_mm: css * 3.5, css_mm: css } },
      };
    },
  },

  {
    unitType: 'jaw_crusher', displayName: 'Concasseur à mâchoires', category: 'Comminution',
    icon: '🦷', color: '#F59E0B', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      gap_mm:         { label: 'Ouverture CSS (mm)',      unit: 'mm',  default: 100,  type: 'number', min: 50, max: 200 },
      feed_size_mm:   { label: 'Taille alimentation (mm)', unit: 'mm', default: 600,  type: 'number' },
      design_tph:     { label: 'Capacité (t/h)',           unit: 't/h', default: 500,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const css = p(params,'gap_mm', 100);
      const cap = design_capacity ?? p(params,'design_tph', 500);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.8, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { css_mm: css, p80_product_mm: css * 2.5 } },
      };
    },
  },

  {
    unitType: 'cone_crusher', displayName: 'Concasseur à cône', category: 'Comminution',
    icon: '🔻', color: '#F59E0B', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      gap_mm:       { label: 'Ouverture CSS (mm)',        unit: 'mm',  default: 16,   type: 'number', min: 6, max: 38 },
      speed_rpm:    { label: 'Vitesse (RPM)',              unit: 'RPM', default: 300,  type: 'number' },
      design_tph:   { label: 'Capacité nominale (t/h)',   unit: 't/h', default: 400,  type: 'number' },
      cavity_type:  { label: 'Type cavité',               unit: '',    default: 'Standard', type: 'select', options: ['Standard', 'Medium', 'Short Head'] },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const css = p(params,'gap_mm', 16);
      const cap = design_capacity ?? p(params,'design_tph', 400);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 1.2, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { css_mm: css, p80_product_mm: css * 2.8 } },
      };
    },
  },

  {
    unitType: 'impact_crusher', displayName: 'Concasseur à impact (VSI)', category: 'Comminution',
    icon: '💥', color: '#F59E0B', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      rotor_speed_rpm: { label: 'Vitesse rotor (RPM)',    unit: 'RPM', default: 1500, type: 'number' },
      feed_size_mm:    { label: 'Taille max alimentation (mm)', unit: 'mm', default: 50, type: 'number' },
      design_tph:      { label: 'Capacité (t/h)',          unit: 't/h', default: 200, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 200);
      const util = feed.mass_flow / Math.max(1, cap);
      return { outStreams: [{ ...feed }], nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 2.5, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product_mm: 5 } } };
    },
  },

  {
    unitType: 'double_deck_screen', displayName: 'Crible double deck', category: 'Comminution',
    icon: '📊', color: '#D97706', maxInputs: 1, maxOutputs: 3,
    defaultParameters: {
      aperture_top_mm:  { label: 'Maille supérieure (mm)',  unit: 'mm', default: 40, type: 'number' },
      aperture_bot_mm:  { label: 'Maille inférieure (mm)',  unit: 'mm', default: 10, type: 'number' },
      area_m2:          { label: 'Surface (m²)',             unit: 'm²', default: 18, type: 'number' },
      design_tph:       { label: 'Capacité (t/h)',           unit: 't/h', default: 600, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 600);
      const oversize = 0.25;   // fraction oversize top deck
      const midsize  = 0.35;   // fraction mid fraction
      const fines    = 1 - oversize - midsize;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * oversize, volume_flow: feed.volume_flow * oversize, gold_flow: feed.gold_flow * oversize },
          { ...feed, mass_flow: feed.mass_flow * midsize,  volume_flow: feed.volume_flow * midsize,  gold_flow: feed.gold_flow * midsize },
          { ...feed, mass_flow: feed.mass_flow * fines,    volume_flow: feed.volume_flow * fines,    gold_flow: feed.gold_flow * fines },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.15, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { oversize_pct: oversize*100, fines_pct: fines*100 } },
      };
    },
  },

  {
    unitType: 'single_deck_screen', displayName: 'Crible simple deck', category: 'Comminution',
    icon: '📋', color: '#D97706', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      aperture_mm:  { label: 'Maille (mm)',      unit: 'mm',  default: 12, type: 'number' },
      area_m2:      { label: 'Surface (m²)',     unit: 'm²',  default: 12, type: 'number' },
      design_tph:   { label: 'Capacité (t/h)',   unit: 't/h', default: 400, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 400);
      const fines_frac = 0.70;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * (1-fines_frac), volume_flow: feed.volume_flow*(1-fines_frac), gold_flow: feed.gold_flow*(1-fines_frac) },
          { ...feed, mass_flow: feed.mass_flow * fines_frac,     volume_flow: feed.volume_flow*fines_frac,     gold_flow: feed.gold_flow*fines_frac },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.1, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { aperture_mm: p(params,'aperture_mm',12) } },
      };
    },
  },

  {
    unitType: 'banana_screen', displayName: 'Crible banane (polyurethane)', category: 'Comminution',
    icon: '🍌', color: '#D97706', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      aperture_mm:   { label: 'Maille (mm)',      unit: 'mm',  default: 6,   type: 'number' },
      n_decks:       { label: 'Nb de panneaux',   unit: '',    default: 4,   type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',   unit: 't/h', default: 700, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 700);
      const fines_frac = 0.75;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * (1-fines_frac), gold_flow: feed.gold_flow*(1-fines_frac) },
          { ...feed, mass_flow: feed.mass_flow * fines_frac,     gold_flow: feed.gold_flow*fines_frac },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.2, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} },
      };
    },
  },

  {
    unitType: 'wet_deck_screen', displayName: 'Crible humide (wet screen)', category: 'Comminution',
    icon: '💧', color: '#0EA5E9', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      aperture_mm:   { label: 'Maille (mm)',       unit: 'mm',  default: 0.5, type: 'number' },
      water_m3_h:    { label: 'Eau lavage (m³/h)', unit: 'm³/h', default: 80, type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',    unit: 't/h', default: 250, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 250);
      const fines_frac = 0.80;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*(1-fines_frac), solids_content: 85, gold_flow: feed.gold_flow*(1-fines_frac) },
          { ...feed, mass_flow: feed.mass_flow*fines_frac,     solids_content: 25, gold_flow: feed.gold_flow*fines_frac },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.12, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} },
      };
    },
  },

  {
    unitType: 'trommel', displayName: 'Trommel (crible rotatif)', category: 'Comminution',
    icon: '🔘', color: '#D97706', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_m:    { label: 'Diamètre (m)',      unit: 'm',   default: 2.4, type: 'number' },
      length_m:      { label: 'Longueur (m)',      unit: 'm',   default: 5.0, type: 'number' },
      aperture_mm:   { label: 'Maille (mm)',       unit: 'mm',  default: 8,   type: 'number' },
      speed_rpm:     { label: 'Vitesse (RPM)',      unit: 'RPM', default: 10,  type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',    unit: 't/h', default: 200, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 200);
      const pass_frac = 0.65;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*(1-pass_frac), gold_flow: feed.gold_flow*(1-pass_frac) },
          { ...feed, mass_flow: feed.mass_flow*pass_frac,     gold_flow: feed.gold_flow*pass_frac },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.3, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} },
      };
    },
  },

  {
    unitType: 'scrubber', displayName: 'Broyeur laveur (scrubber)', category: 'Comminution',
    icon: '🌊', color: '#0EA5E9', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      diameter_m:   { label: 'Diamètre (m)',      unit: 'm',   default: 4.5,  type: 'number' },
      length_m:     { label: 'Longueur (m)',      unit: 'm',   default: 10,   type: 'number' },
      water_ratio:  { label: 'Ratio eau (m³/t)',  unit: 'm³/t', default: 0.5, type: 'number' },
      design_tph:   { label: 'Capacité (t/h)',    unit: 't/h', default: 500,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 500);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed, solids_content: 35, volume_flow: feed.mass_flow / 1.4 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.8, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} },
      };
    },
  },

  {
    unitType: 'hpgr', displayName: 'HPGR (rouleaux haute pression)', category: 'Comminution',
    icon: '🔩', color: '#B45309', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      roll_diameter_m: { label: 'Diamètre rouleaux (m)',   unit: 'm',    default: 2.0,  type: 'number' },
      roll_width_m:    { label: 'Largeur rouleaux (m)',    unit: 'm',    default: 1.5,  type: 'number' },
      pressure_n_mm2:  { label: 'Pression spécifique (N/mm²)', unit: 'N/mm²', default: 3.5, type: 'number' },
      p80_target:      { label: 'P80 produit (µm)',        unit: 'µm',   default: 4000, type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 14, type: 'number' },
      design_tph:      { label: 'Capacité (t/h)',          unit: 't/h',  default: 2000, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 2000);
      const util = feed.mass_flow / Math.max(1, cap);
      const bwi = p(params,'bwi', 14);
      const p80f = 40000; const p80p = p(params,'p80_target', 4000);
      const energy = bwi * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f));
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: Math.max(1, energy), reagent_consumptions: { wear_studs_kg_t: 0.15 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p, specific_energy: energy } },
      };
    },
  },

  {
    unitType: 'sag_mill', displayName: 'Broyeur SAG', category: 'Comminution',
    icon: '⚙', color: '#3B82F6', maxInputs: 2, maxOutputs: 1,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',            unit: 'm',    default: 10.4, type: 'number' },
      length_m:        { label: 'Longueur (m)',            unit: 'm',    default: 5.2,  type: 'number' },
      speed_pct:       { label: 'Vitesse (% Vc)',          unit: '%',    default: 75,   type: 'number', min: 60, max: 90 },
      ball_load_pct:   { label: 'Charge billes (%)',       unit: '%',    default: 12,   type: 'number', min: 5, max: 25 },
      p80_target:      { label: 'P80 produit (µm)',        unit: 'µm',   default: 300,  type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 14, type: 'number' },
      design_capacity: { label: 'Capacité nominale (t/h)', unit: 't/h',  default: 280,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const bwi = p(params,'bwi', 14); const p80f = 150000; const p80p = p(params,'p80_target', 300);
      const energy = Math.max(3, bwi * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f)));
      const cap = design_capacity ?? p(params,'design_capacity', 280);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: energy, reagent_consumptions: { grinding_media_kg_t: 0.35, liner_kg_t: 0.08 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p, energy_kwh_t: energy } },
      };
    },
  },

  {
    unitType: 'ag_mill', displayName: 'Broyeur AG (autogène)', category: 'Comminution',
    icon: '⚙', color: '#2563EB', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',    unit: 'm',   default: 11.0, type: 'number' },
      length_m:        { label: 'Longueur (m)',    unit: 'm',   default: 4.5,  type: 'number' },
      p80_target:      { label: 'P80 produit (µm)', unit: 'µm', default: 500,  type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 14, type: 'number' },
      design_capacity: { label: 'Capacité (t/h)', unit: 't/h', default: 350,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const bwi = p(params,'bwi', 14); const p80f = 150000; const p80p = p(params,'p80_target', 500);
      const energy = Math.max(2, bwi * 0.85 * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f)));
      const cap = design_capacity ?? p(params,'design_capacity', 350);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: energy, reagent_consumptions: { liner_kg_t: 0.06 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p } },
      };
    },
  },

  {
    unitType: 'ball_mill', displayName: 'Broyeur à boulets', category: 'Comminution',
    icon: '🔵', color: '#60A5FA', maxInputs: 2, maxOutputs: 1,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',    unit: 'm',   default: 6.7,  type: 'number' },
      length_m:        { label: 'Longueur (m)',    unit: 'm',   default: 9.75, type: 'number' },
      ball_load_pct:   { label: 'Charge billes (%)', unit: '%', default: 35,   type: 'number', min: 20, max: 45 },
      p80_target:      { label: 'P80 produit (µm)', unit: 'µm', default: 75,   type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 14, type: 'number' },
      design_capacity: { label: 'Capacité (t/h)', unit: 't/h', default: 250,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const bwi = p(params,'bwi', 14); const p80f = 300; const p80p = p(params,'p80_target', 75);
      const energy = Math.max(2, bwi * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f)));
      const cap = design_capacity ?? p(params,'design_capacity', 250);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: energy, reagent_consumptions: { grinding_media_kg_t: 0.28, liner_kg_t: 0.05 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p, energy_kwh_t: energy } },
      };
    },
  },

  {
    unitType: 'rod_mill', displayName: 'Broyeur à barres (Rod Mill)', category: 'Comminution',
    icon: '🔧', color: '#60A5FA', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',    unit: 'm',   default: 3.5,  type: 'number' },
      length_m:        { label: 'Longueur (m)',    unit: 'm',   default: 5.5,  type: 'number' },
      rod_load_pct:    { label: 'Charge barres (%)', unit: '%', default: 35,   type: 'number' },
      p80_target:      { label: 'P80 produit (µm)', unit: 'µm', default: 1000, type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 13, type: 'number' },
      design_capacity: { label: 'Capacité (t/h)', unit: 't/h', default: 100,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const bwi = p(params,'bwi', 13); const p80f = 15000; const p80p = p(params,'p80_target', 1000);
      const energy = Math.max(1.5, bwi * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f)));
      const cap = design_capacity ?? p(params,'design_capacity', 100);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: energy, reagent_consumptions: { grinding_media_kg_t: 0.45 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p } },
      };
    },
  },

  {
    unitType: 'vertical_mill', displayName: 'Broyeur vertical (Vertimill)', category: 'Comminution',
    icon: '⬆', color: '#60A5FA', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      power_installed_kw: { label: 'Puissance installée (kW)', unit: 'kW', default: 3000, type: 'number' },
      p80_feed:       { label: 'P80 alimentation (µm)', unit: 'µm', default: 200, type: 'number' },
      p80_target:     { label: 'P80 produit (µm)',      unit: 'µm', default: 40,  type: 'number' },
      bwi:             { label: 'Bond Work Index (kWh/t)', unit: 'kWh/t', default: 14, type: 'number' },
      design_tph:     { label: 'Capacité (t/h)',        unit: 't/h', default: 120, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const bwi = p(params,'bwi', 14); const p80f = p(params,'p80_feed', 200); const p80p = p(params,'p80_target', 40);
      const energy = Math.max(1, bwi * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f)));
      const cap = design_capacity ?? p(params,'design_tph', 120);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: energy, reagent_consumptions: { grinding_media_kg_t: 0.12 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p, energy_kwh_t: energy } },
      };
    },
  },

  {
    unitType: 'pebble_crusher', displayName: 'Concasseur de galets (Pebble)', category: 'Comminution',
    icon: '🪨', color: '#D97706', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      gap_mm:      { label: 'CSS (mm)',         unit: 'mm',  default: 25,  type: 'number' },
      design_tph:  { label: 'Capacité (t/h)',   unit: 't/h', default: 80,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 80);
      const util = feed.mass_flow / Math.max(1, cap);
      return { outStreams: [{ ...feed }], nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 1.5, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} } };
    },
  },

  {
    unitType: 'hydrocyclone', displayName: 'Hydrocyclone', category: 'Comminution',
    icon: '🌀', color: '#06B6D4', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_mm:    { label: 'Diamètre (mm)',    unit: 'mm', default: 650,  type: 'number' },
      n_units:        { label: 'Nb d\'unités',     unit: '',   default: 8,    type: 'number' },
      pressure_kpa:   { label: 'Pression (kPa)',   unit: 'kPa', default: 110, type: 'number' },
      split_overflow: { label: 'Overflow (%)',     unit: '%',  default: 65,   type: 'number', min: 40, max: 80 },
      d50_micron:     { label: 'D50 de coupe (µm)', unit: 'µm', default: 75,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const split = p(params,'split_overflow', 65) / 100;
      return {
        outStreams: [
          splitStream(feed, split, { solids_content: 30 }),
          splitStream(feed, 1 - split, { solids_content: 75 }),
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.5, reagent_consumptions: {}, utilization_rate: feed.mass_flow / (p(params,'n_units',8) * 80), is_bottleneck: false, kpis: { split_overflow_pct: split*100, d50_micron: p(params,'d50_micron',75) } },
      };
    },
  },

  {
    unitType: 'spiral_classifier', displayName: 'Classificateur à spirale', category: 'Comminution',
    icon: '🌀', color: '#06B6D4', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_m:    { label: 'Diamètre (m)',    unit: 'm',   default: 2.4, type: 'number' },
      cut_size_mm:   { label: 'Taille coupure (mm)', unit: 'mm', default: 0.15, type: 'number' },
      design_tph:    { label: 'Capacité (t/h)',  unit: 't/h', default: 150, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 150);
      const coarse = 0.40;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * coarse, gold_flow: feed.gold_flow * coarse },
          { ...feed, mass_flow: feed.mass_flow * (1-coarse), gold_flow: feed.gold_flow*(1-coarse), solids_content: 25 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.3, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: {} },
      };
    },
  },

  {
    unitType: 'gravity_concentrator', displayName: 'Concentrateur Knelson/Falcon', category: 'Comminution',
    icon: '🏅', color: '#F59E0B', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      grg_recovery:   { label: 'Récupération GRG (%)', unit: '%',   default: 35,  type: 'number', min: 5, max: 75 },
      mass_yield_pct: { label: 'Rendement masse (%)',  unit: '%',   default: 0.5, type: 'number', min: 0.1, max: 5 },
      design_tph:     { label: 'Capacité (t/h)',       unit: 't/h', default: 100, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const rec      = p(params,'grg_recovery', 35) / 100;
      const mass_y   = p(params,'mass_yield_pct', 0.5) / 100;
      const cap      = design_capacity ?? p(params,'design_tph', 100);
      const conc_mass = feed.mass_flow * mass_y;
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: conc_mass, gold_flow: feed.gold_flow * rec, gold_grade: (feed.gold_flow * rec) / Math.max(0.001, conc_mass) * 1000 },
          // Tails grade recomputed from flows so gold_flow / mass_flow stays exact
          // (scaling the grade by (1−rec) alone ignored the mass pulled to concentrate).
          { ...feed, gold_flow: feed.gold_flow * (1-rec), mass_flow: feed.mass_flow * (1-mass_y), gold_grade: (feed.gold_flow * (1-rec)) / Math.max(0.001, feed.mass_flow * (1-mass_y)) * 1000 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: rec * 100, energy_consumption: 0.4, reagent_consumptions: {}, utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: false, kpis: { grg_recovery_pct: rec*100, concentrate_grade_g_t: (feed.gold_flow * rec) / Math.max(0.001, conc_mass) * 1000 } },
      };
    },
  },

  {
    unitType: 'jig', displayName: 'Jig (séparateur gravimétrique)', category: 'Comminution',
    icon: '🔃', color: '#F59E0B', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      stroke_mm:    { label: 'Course (mm)',     unit: 'mm',  default: 12,  type: 'number' },
      freq_cpm:     { label: 'Fréquence (cpm)', unit: 'cpm', default: 120, type: 'number' },
      recovery_pct: { label: 'Récupération (%)', unit: '%',  default: 70,  type: 'number' },
      design_tph:   { label: 'Capacité (t/h)',  unit: 't/h', default: 50,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const rec = p(params,'recovery_pct', 70) / 100;
      const cap = design_capacity ?? p(params,'design_tph', 50);
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: feed.mass_flow * 0.02, gold_flow: feed.gold_flow * rec, gold_grade: (feed.gold_flow * rec) / Math.max(0.0001, feed.mass_flow * 0.02) * 1000 },
          { ...feed, mass_flow: feed.mass_flow * 0.98, gold_flow: feed.gold_flow * (1-rec) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: rec*100, energy_consumption: 0.5, reagent_consumptions: {}, utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: false, kpis: { recovery_pct: rec*100 } },
      };
    },
  },

  {
    unitType: 'shaking_table', displayName: 'Table à secousses (Wilfley)', category: 'Comminution',
    icon: '📐', color: '#F59E0B', maxInputs: 1, maxOutputs: 3,
    defaultParameters: {
      recovery_pct: { label: 'Récupération (%)', unit: '%',  default: 80,  type: 'number' },
      design_tph:   { label: 'Capacité (t/h)',   unit: 't/h', default: 1.5, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream(), emptyStream()], nodeResult: {} };
      const rec = Math.min(1, Math.max(0, p(params,'recovery_pct', 80) / 100));
      const cap = design_capacity ?? p(params,'design_tph', 1.5);
      const unrecoveredGold = feed.gold_flow * (1 - rec);
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: feed.mass_flow * 0.005, gold_flow: feed.gold_flow * rec },
          { ...feed, mass_flow: feed.mass_flow * 0.1,   gold_flow: unrecoveredGold * 0.1 },
          { ...feed, mass_flow: feed.mass_flow * 0.895, gold_flow: unrecoveredGold * 0.9 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: rec*100, energy_consumption: 0.1, reagent_consumptions: {}, utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: false, kpis: {} },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FLOTTATION — séparation concentré / rejets (voir flotationSplit)
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'flotation_rougher', displayName: 'Flottation rougher', category: 'Flottation',
    icon: '🫧', color: '#0ea5e9', maxInputs: 2, maxOutputs: 2,
    defaultParameters: {
      mass_pull_pct:   { label: 'Rendement masse concentré (%)', unit: '%',    default: 12, type: 'number', min: 1, max: 40 },
      au_recovery_pct: { label: 'Or vers concentré (%)',         unit: '%',    default: 90, type: 'number', min: 20, max: 99 },
      collector_g_t:   { label: 'Collecteur PAX (g/t)',          unit: 'g/t',  default: 60, type: 'number', min: 0, max: 400 },
      frother_g_t:     { label: 'Moussant MIBC (g/t)',           unit: 'g/t',  default: 30, type: 'number', min: 0, max: 200 },
      design_tph:      { label: 'Capacité (t/h)',                unit: 't/h',  default: 500, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      return flotationSplit(feed, p(params,'mass_pull_pct',12), p(params,'au_recovery_pct',90), {
        energyKwht: 1.5, collectorKgT: p(params,'collector_g_t',60)/1000, frotherKgT: p(params,'frother_g_t',30)/1000,
        cap: design_capacity ?? p(params,'design_tph',500),
      });
    },
  },

  {
    unitType: 'flotation_scavenger', displayName: 'Flottation scavenger', category: 'Flottation',
    icon: '🫧', color: '#0284c7', maxInputs: 2, maxOutputs: 2,
    defaultParameters: {
      mass_pull_pct:   { label: 'Rendement masse concentré (%)', unit: '%',   default: 8,  type: 'number', min: 1, max: 30 },
      au_recovery_pct: { label: 'Or récupéré des rejets (%)',    unit: '%',   default: 55, type: 'number', min: 10, max: 90 },
      collector_g_t:   { label: 'Collecteur PAX (g/t)',          unit: 'g/t', default: 40, type: 'number', min: 0, max: 400 },
      frother_g_t:     { label: 'Moussant MIBC (g/t)',           unit: 'g/t', default: 20, type: 'number', min: 0, max: 200 },
      design_tph:      { label: 'Capacité (t/h)',                unit: 't/h', default: 500, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      return flotationSplit(feed, p(params,'mass_pull_pct',8), p(params,'au_recovery_pct',55), {
        energyKwht: 1.2, collectorKgT: p(params,'collector_g_t',40)/1000, frotherKgT: p(params,'frother_g_t',20)/1000,
        cap: design_capacity ?? p(params,'design_tph',500),
      });
    },
  },

  {
    unitType: 'flotation_cleaner', displayName: 'Flottation cleaner', category: 'Flottation',
    icon: '🫧', color: '#0369a1', maxInputs: 2, maxOutputs: 2,
    defaultParameters: {
      // Le cleaner ÉPURE le concentré rougher : faible rendement masse, l'or reste
      // au concentré nettoyé, la gangue part aux rejets cleaner (souvent recyclés).
      mass_pull_pct:   { label: 'Rendement masse concentré (%)', unit: '%',   default: 40, type: 'number', min: 5, max: 90 },
      au_recovery_pct: { label: 'Or conservé au concentré (%)',  unit: '%',   default: 97, type: 'number', min: 50, max: 99.5 },
      design_tph:      { label: 'Capacité (t/h)',                unit: 't/h', default: 120, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      return flotationSplit(feed, p(params,'mass_pull_pct',40), p(params,'au_recovery_pct',97), {
        energyKwht: 0.8, collectorKgT: 0, frotherKgT: 0,
        cap: design_capacity ?? p(params,'design_tph',120),
      });
    },
  },

  {
    unitType: 'concentrate_regrind', displayName: 'Rebroyage de concentré', category: 'Flottation',
    icon: '🌀', color: '#0ea5e9', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      // Le rebroyage n'a PAS de récupération propre : il abaisse le P80 du
      // concentré (meilleure libération) → la lixiviation aval en profite. On ne
      // fait que passer la masse en réduisant le P80 et en consommant de l'énergie.
      target_p80_um: { label: 'P80 cible (µm)', unit: 'µm',    default: 25, type: 'number', min: 5, max: 75 },
      energy_kwht:   { label: 'Énergie (kWh/t)', unit: 'kWh/t', default: 12, type: 'number', min: 2, max: 40 },
      design_tph:    { label: 'Capacité (t/h)',  unit: 't/h',  default: 120, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph',120);
      const energy = p(params,'energy_kwht',12);
      return {
        outStreams: [{ ...feed }],
        nodeResult: {
          feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100,
          energy_consumption: energy, reagent_consumptions: {},
          utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: false,
          kpis: { target_p80_um: p(params,'target_p80_um',25) },
        },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LIXIVIATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'pre_aeration_tank', displayName: 'Cuve de pré-aération', category: 'Lixiviation',
    icon: '💨', color: '#06B6D4', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      retention_h:  { label: 'Rétention (h)',     unit: 'h',  default: 2,    type: 'number' },
      air_flow_nm3: { label: 'Air (Nm³/h/m³)',    unit: '',   default: 0.5,  type: 'number' },
      design_tph:   { label: 'Capacité (t/h)',    unit: 't/h', default: 250, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return { outStreams: [{ ...feed, pH: 10.5 }], nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.2, reagent_consumptions: { cao_kg_t: 0.5 }, utilization_rate: feed.mass_flow / Math.max(1, p(params,'design_tph',250)), is_bottleneck: false, kpis: {} } };
    },
  },

  {
    unitType: 'cil_reactor', displayName: 'Réacteur CIL', category: 'Lixiviation',
    icon: '🏭', color: '#10B981', maxInputs: 2, maxOutputs: 2,
    defaultParameters: {
      n_tanks:         { label: 'Nb de cuves',            unit: '',      default: 8,    type: 'number', min: 4, max: 12 },
      tank_volume_m3:  { label: 'Volume cuve (m³)',        unit: 'm³',    default: 1500, type: 'number' },
      retention_h:     { label: 'Rétention totale (h)',    unit: 'h',     default: 24,   type: 'number', min: 12, max: 72 },
      nacn_kg_t:       { label: 'NaCN (kg/t)',             unit: 'kg/t',  default: 0.5,  type: 'number' },
      do_mg_l:         { label: 'O₂ dissous (mg/L)',       unit: 'mg/L',  default: 8,    type: 'number' },
      carbon_g_l:      { label: 'Charbon (g/L)',           unit: 'g/L',   default: 15,   type: 'number' },
      design_capacity: { label: 'Capacité nominale (t/h)', unit: 't/h',   default: 250,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const nacn = p(params,'nacn_kg_t', 0.5);
      const do2  = p(params,'do_mg_l', 8) / 1000;
      const tau  = p(params,'retention_h', 24);
      const cn_free = nacn * 0.44;
      // k calibré pour ~95 % de dissolution en 24 h aux conditions par défaut
      // (0,5 kg/t NaCN, 8 mg/L O₂). L'ancien k = 0,12 donnait 11 % de dissolution,
      // masqué par un double ×100 qui saturait la récupération à 98 % quelles que
      // soient les conditions — la cinétique entière était sans effet.
      const k_leach = 3.0;
      const diss_frac = 1 - Math.exp(-k_leach * Math.sqrt(cn_free) * Math.sqrt(do2) * tau);
      const C_sol = feed.gold_grade * diss_frac * 0.1;
      const carbon_g_l = p(params,'carbon_g_l', 15);
      // Efficacité d'adsorption : pertes solubles décroissantes avec la
      // concentration de charbon (≈98 % à 15 g/L, plancher 85 %).
      const adsorption_frac = Math.min(0.995, Math.max(0.85, 1 - 0.3 / Math.max(1, carbon_g_l)));
      const recovery = Math.min(98, diss_frac * adsorption_frac * 100);
      const cap = design_capacity ?? p(params,'design_capacity', 250);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: carbon_g_l * 0.001 * feed.mass_flow, gold_flow: feed.gold_flow * recovery/100, dissolved_gold: C_sol },
          { ...feed, gold_grade: feed.gold_grade*(1-recovery/100), gold_flow: feed.gold_flow*(1-recovery/100), cyanide_concentration: cn_free * 1000 * 0.2, pH: 10.5 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery, energy_consumption: 0.8, reagent_consumptions: { nacn_kg_t: nacn, cao_kg_t: 1.2 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { leach_recovery_pct: diss_frac*100, tails_grade: feed.gold_grade*(1-recovery/100) } },
      };
    },
  },

  {
    unitType: 'ilr_intensive_leach', displayName: 'Lixiviation intensive (ILR)', category: 'Lixiviation',
    icon: '⚗️', color: '#059669', maxInputs: 1, maxOutputs: 2,
    // Lixiviation intensive d'un CONCENTRÉ (gravité ou flottation) à forte
    // concentration de cyanure, dans un réacteur dédié — récupération proche de
    // l'unité (≈98,5 %, cf. PFS Spanish Mountain §13.5.4). Sorties : [0] solution
    // enrichie (or récupéré, part vers l'électro-extraction), [1] résidu lixivié.
    defaultParameters: {
      recovery_pct: { label: 'Récupération (%)',    unit: '%',    default: 98.5, type: 'number', min: 80, max: 99.5 },
      nacn_kg_t:    { label: 'NaCN (kg/t)',         unit: 'kg/t', default: 5,    type: 'number', min: 1, max: 50 },
      retention_h:  { label: 'Rétention (h)',       unit: 'h',    default: 12,   type: 'number', min: 4, max: 48 },
      design_tph:   { label: 'Capacité (t/h)',      unit: 't/h',  default: 30,   type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const rec = Math.min(0.995, Math.max(0, p(params,'recovery_pct', 98.5) / 100));
      const nacn = p(params,'nacn_kg_t', 5);
      const cap = design_capacity ?? p(params,'design_tph', 30);
      // Petite masse porteuse sur la solution enrichie : sans elle, les unités
      // aval (électro-extraction, fusion) et blendInputs abandonnent tout courant
      // à masse solide nulle — l'or récupéré serait perdu du bilan.
      const carrier = Math.max(0.001, feed.mass_flow * 0.01);
      return {
        outStreams: [
          // Solution enrichie : porte l'or récupéré (comptée comme récupérée quand
          // elle atteint un puits via un courant non solide).
          { ...emptyStream(), mass_flow: carrier, volume_flow: feed.volume_flow, gold_flow: feed.gold_flow * rec, dissolved_gold: feed.gold_grade * rec * 0.5 },
          // Résidu lixivié (solide) → part au parc à résidus.
          { ...feed, mass_flow: Math.max(0, feed.mass_flow - carrier), gold_flow: feed.gold_flow * (1 - rec), gold_grade: feed.gold_grade * (1 - rec) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: rec * 100, energy_consumption: 1.0, reagent_consumptions: { nacn_kg_t: nacn, cao_kg_t: 2 }, utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: false, kpis: { intensive_leach_recovery_pct: rec * 100 } },
      };
    },
  },

  {
    unitType: 'cip_reactor', displayName: 'Réacteur CIP', category: 'Lixiviation',
    icon: '🏭', color: '#34D399', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      n_tanks:         { label: 'Nb de cuves',    unit: '',     default: 6,    type: 'number' },
      retention_h:     { label: 'Rétention (h)',  unit: 'h',    default: 20,   type: 'number' },
      nacn_kg_t:       { label: 'NaCN (kg/t)',    unit: 'kg/t', default: 0.45, type: 'number' },
      design_capacity: { label: 'Capacité (t/h)', unit: 't/h',  default: 250,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const nacn = p(params,'nacn_kg_t', 0.45);
      const tau  = p(params,'retention_h', 20);
      const cn_free = nacn * 0.44;
      // Même cinétique que le CIL (k = 3,0) — l'ancien k = 0,10 donnait ~7 % de
      // récupération en 20 h, un ordre de grandeur sous tout circuit CIP réel.
      const diss_frac = 1 - Math.exp(-3.0 * Math.sqrt(cn_free) * Math.sqrt(0.008) * tau);
      const recovery = Math.min(97, diss_frac * 98);
      const cap = design_capacity ?? p(params,'design_capacity', 250);
      return {
        outStreams: [{ ...feed, gold_grade: feed.gold_grade*(1-recovery/100), gold_flow: feed.gold_flow*(1-recovery/100), pH: 10.5 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery, energy_consumption: 0.75, reagent_consumptions: { nacn_kg_t: nacn, cao_kg_t: 1.0 }, utilization_rate: feed.mass_flow / Math.max(1, cap), is_bottleneck: feed.mass_flow / Math.max(1, cap) > 0.85, kpis: { tails_grade: feed.gold_grade*(1-recovery/100) } },
      };
    },
  },

  {
    unitType: 'heap_leach_pad', displayName: 'Lixiviation en tas (heap leach)', category: 'Lixiviation',
    icon: '⛰', color: '#F59E0B', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      heap_height_m:    { label: 'Hauteur tas (m)',            unit: 'm',     default: 8,    type: 'number' },
      application_rate: { label: 'Arrosage (L/h/m²)',         unit: 'L/h/m²', default: 12,  type: 'number' },
      nacn_g_l:         { label: 'NaCN solution (g/L)',        unit: 'g/L',   default: 0.8,  type: 'number' },
      leach_days:       { label: 'Durée lixiviation (j)',      unit: 'j',     default: 90,   type: 'number' },
      ore_type:         { label: 'Type de minerai',            unit: '',      default: 'Oxyde', type: 'select', options: ['Oxyde', 'Transition', 'Primaire'] },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const days = p(params,'leach_days', 90);
      const oreType = String(params['ore_type'] || 'Oxyde');
      const baseRec = oreType === 'Oxyde' ? 70 : oreType === 'Transition' ? 60 : 50;
      const recovery = Math.min(baseRec + 5, baseRec + days * 0.1);
      return {
        // gold_flow must shrink with the grade — leaving it untouched double-counted
        // the leached gold in every stream downstream of the pad.
        outStreams: [{ ...feed, gold_grade: feed.gold_grade*(1-recovery/100), gold_flow: feed.gold_flow*(1-recovery/100), dissolved_gold: feed.gold_grade * recovery/100 * 0.5 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery, energy_consumption: 0.3, reagent_consumptions: { nacn_kg_t: 0.3, lime_kg_t: 1.5 }, utilization_rate: 0.7, is_bottleneck: false, kpis: { leach_days: days, recovery_pct: recovery } },
      };
    },
  },

  {
    unitType: 'column_leach', displayName: 'Lixiviation en colonne (test)', category: 'Lixiviation',
    icon: '🧫', color: '#06B6D4', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      column_height_m:  { label: 'Hauteur colonne (m)', unit: 'm',  default: 6,   type: 'number' },
      leach_days:       { label: 'Durée (j)',            unit: 'j',  default: 120, type: 'number' },
      nacn_g_l:         { label: 'NaCN (g/L)',           unit: 'g/L', default: 0.5, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const days = p(params,'leach_days', 120);
      const recovery = Math.min(80, 50 + days * 0.25);
      return {
        outStreams: [{ ...feed, gold_grade: feed.gold_grade*(1-recovery/100), dissolved_gold: feed.gold_grade*recovery/100*0.4 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery, energy_consumption: 0.1, reagent_consumptions: { nacn_kg_t: 0.25 }, utilization_rate: 0.5, is_bottleneck: false, kpis: { leach_days: days, recovery_pct: recovery } },
      };
    },
  },

  {
    unitType: 'pressure_oxidation', displayName: 'Oxydation sous pression (POX)', category: 'Lixiviation',
    icon: '🔥', color: '#EF4444', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      temperature_c:   { label: 'Température (°C)',          unit: '°C',  default: 225,  type: 'number', min: 180, max: 240 },
      pressure_kpa:    { label: 'Pression (kPa)',            unit: 'kPa', default: 3500, type: 'number' },
      sulphide_conv:   { label: 'Conversion sulfures (%)',   unit: '%',   default: 95,   type: 'number' },
      design_capacity: { label: 'Capacité nominale (t/h)',   unit: 't/h', default: 150,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const conv = p(params,'sulphide_conv', 95) / 100;
      const cap  = design_capacity ?? p(params,'design_capacity', 150);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed, temperature: 25, pH: 1.5 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: conv * 98, energy_consumption: 120, reagent_consumptions: { limestone_kg_t: 45, oxygen_kg_t: 25 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { sulphide_conversion_pct: conv*100 } },
      };
    },
  },

  {
    unitType: 'bioleach', displayName: 'Biolixiviation (BIOX)', category: 'Lixiviation',
    icon: '🦠', color: '#84CC16', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      temperature_c:   { label: 'Température (°C)',        unit: '°C',  default: 40,   type: 'number', min: 35, max: 50 },
      retention_h:     { label: 'Rétention (h)',           unit: 'h',   default: 120,  type: 'number' },
      sulphide_conv:   { label: 'Conversion sulfures (%)', unit: '%',   default: 92,   type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',          unit: 't/h', default: 50,   type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const conv = p(params,'sulphide_conv', 92) / 100;
      const cap  = design_capacity ?? p(params,'design_capacity', 50);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed, pH: 1.8, temperature: 35 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: conv * 95, energy_consumption: 15, reagent_consumptions: { nutrients_kg_t: 5, limestone_kg_t: 30 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { sulphide_conversion_pct: conv*100 } },
      };
    },
  },

  {
    unitType: 'roasting', displayName: 'Grillage (Roaster)', category: 'Lixiviation',
    icon: '♨', color: '#DC2626', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      temperature_c:   { label: 'Température (°C)',         unit: '°C',  default: 650,  type: 'number', min: 550, max: 750 },
      retention_s:     { label: 'Rétention (s)',             unit: 's',   default: 3600, type: 'number' },
      sulphide_conv:   { label: 'Conversion S° → SO₂ (%)',  unit: '%',   default: 99,   type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',            unit: 't/h', default: 40,   type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const conv = p(params,'sulphide_conv', 99) / 100;
      const cap  = design_capacity ?? p(params,'design_capacity', 40);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed, temperature: 25, pH: 7 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: conv * 97, energy_consumption: 80, reagent_consumptions: { fuel_kg_t: 15 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { so2_tonne_per_h: feed.mass_flow * 0.03 } },
      };
    },
  },

  {
    unitType: 'ultrafine_grind', displayName: 'Broyage ultrafin (IsaMill)', category: 'Lixiviation',
    icon: '🔬', color: '#8B5CF6', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      p80_target:      { label: 'P80 cible (µm)',         unit: 'µm',   default: 15,   type: 'number', min: 5, max: 50 },
      media_type:      { label: 'Type média',              unit: '',     default: 'Céramique', type: 'select', options: ['Céramique', 'Billes acier', 'Sable silice'] },
      design_tph:      { label: 'Capacité (t/h)',         unit: 't/h',  default: 30,   type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const p80f = 75; const p80p = p(params,'p80_target', 15);
      const energy = 14 * (10/Math.sqrt(p80p) - 10/Math.sqrt(p80f));
      const cap = design_capacity ?? p(params,'design_tph', 30);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [{ ...feed }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: Math.max(10, energy), reagent_consumptions: { grinding_media_kg_t: 0.4 }, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { p80_product: p80p } },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ADR — Adsorption / Désorption / Régénération
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'carbon_adsorption', displayName: 'Adsorption charbon activé', category: 'ADR',
    icon: '⬛', color: '#374151', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      carbon_g_l:  { label: 'Charbon (g/L)',       unit: 'g/L', default: 15, type: 'number' },
      residence_h: { label: 'Résidence (h)',        unit: 'h',   default: 2,  type: 'number' },
      n_stages:    { label: 'Nb de colonnes',       unit: '',    default: 5,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const Kf = 3500; const fn = 0.3;
      const C = Math.max(0.001, feed.dissolved_gold);
      const q = Kf * Math.pow(C, fn);
      const c_g_l = p(params,'carbon_g_l', 15);
      const ads_frac = Math.min(0.98, q * c_g_l / (q * c_g_l + C * 100000));
      const recovery = ads_frac * 100;
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: c_g_l * 0.001, gold_flow: feed.gold_flow * recovery/100, dissolved_gold: q },
          { ...feed, dissolved_gold: feed.dissolved_gold * (1 - ads_frac), gold_flow: feed.gold_flow * (1-recovery/100) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery, energy_consumption: 0.2, reagent_consumptions: {}, utilization_rate: 0.8, is_bottleneck: false, kpis: { carbon_loading_g_t: q, adsorption_pct: recovery } },
      };
    },
  },

  {
    unitType: 'elution_column', displayName: 'Colonne d\'élution AARL', category: 'ADR',
    icon: '🧪', color: '#7C3AED', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      temperature_c: { label: 'Température (°C)',  unit: '°C', default: 120, type: 'number' },
      cycles:        { label: 'Nb cycles',          unit: '',   default: 2,   type: 'number' },
      nacn_pct:      { label: 'NaCN solution (%)',  unit: '%',  default: 2,   type: 'number' },
      naoh_pct:      { label: 'NaOH solution (%)',  unit: '%',  default: 0.5, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const elution_eff = Math.min(98, 90 + p(params,'cycles',2) * 3);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*0.05, dissolved_gold: feed.dissolved_gold*elution_eff/100*20, gold_flow: feed.gold_flow*elution_eff/100 },
          { ...feed, mass_flow: feed.mass_flow*0.95, dissolved_gold: feed.dissolved_gold*(1-elution_eff/100), gold_flow: feed.gold_flow*(1-elution_eff/100) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: elution_eff, energy_consumption: 35, reagent_consumptions: { nacn_kg_batch: 50, naoh_kg_batch: 25 }, utilization_rate: 0.7, is_bottleneck: false, kpis: { elution_efficiency_pct: elution_eff } },
      };
    },
  },

  {
    unitType: 'zadra_elution', displayName: 'Élution Zadra (atmosphérique)', category: 'ADR',
    icon: '🧪', color: '#6D28D9', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      temperature_c: { label: 'Température (°C)',  unit: '°C', default: 95,  type: 'number' },
      cycle_time_h:  { label: 'Durée cycle (h)',   unit: 'h',  default: 48,  type: 'number' },
      nacn_pct:      { label: 'NaCN (%)',           unit: '%',  default: 1,   type: 'number' },
    },
    calculate(inputs, _params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const eff = 92;
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*0.05, gold_flow: feed.gold_flow*eff/100, dissolved_gold: feed.dissolved_gold*eff/100*15 },
          { ...feed, mass_flow: feed.mass_flow*0.95, gold_flow: feed.gold_flow*(1-eff/100) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: eff, energy_consumption: 20, reagent_consumptions: { nacn_kg_batch: 30 }, utilization_rate: 0.65, is_bottleneck: false, kpis: { elution_efficiency_pct: eff } },
      };
    },
  },

  {
    unitType: 'carbon_reactivation', displayName: 'Four de réactivation charbon', category: 'ADR',
    icon: '🔥', color: '#B45309', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      temperature_c:  { label: 'Température (°C)',        unit: '°C',  default: 700,  type: 'number', min: 600, max: 750 },
      throughput_kg_h:{ label: 'Débit charbon (kg/h)',    unit: 'kg/h', default: 500, type: 'number' },
      reactivation_eff:{ label: 'Efficacité réactivation (%)', unit: '%', default: 95, type: 'number' },
    },
    calculate(inputs, _params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return {
        outStreams: [{ ...feed, temperature: 25 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 80, reagent_consumptions: { natural_gas_kg_t: 12 }, utilization_rate: 0.7, is_bottleneck: false, kpis: {} },
      };
    },
  },

  {
    unitType: 'carbon_transfer', displayName: 'Transfert de charbon (airlift)', category: 'ADR',
    icon: '🔗', color: '#374151', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      air_pressure_kpa: { label: 'Pression air (kPa)', unit: 'kPa', default: 200, type: 'number' },
    },
    calculate(inputs, _params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return passThrough(feed, 0.05);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ÉLECTROMÉTALLURGIE
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'electrowinning', displayName: 'Électrodéposition (EW)', category: 'Électrométallurgie',
    icon: '⚡', color: '#F59E0B', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      n_cells:        { label: 'Nb cellules',           unit: '',   default: 4,    type: 'number' },
      current_a:      { label: 'Courant (A)',            unit: 'A',  default: 1200, type: 'number' },
      efficiency_pct: { label: 'Efficacité courant (%)', unit: '%', default: 90,   type: 'number' },
      cathode_area_m2:{ label: 'Surface cathode (m²)',  unit: 'm²', default: 1.0,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const I = p(params,'current_a', 1200) * p(params,'n_cells', 4);
      const eff = p(params,'efficiency_pct', 90) / 100;
      const m_deposited = (M_AU * I * 3600 * eff) / FARADAY / 1000; // kg/h
      const au_available = feed.gold_flow; // kg/h
      const actual_dep = Math.min(au_available * 0.97, m_deposited);
      const recovery = Math.min(97, (actual_dep / Math.max(0.001, au_available)) * 100);
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: actual_dep / 1000, gold_flow: actual_dep },
          { ...feed, dissolved_gold: feed.dissolved_gold*(1-recovery/100), gold_flow: feed.gold_flow*(1-recovery/100) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: actual_dep / 1000, recovery, energy_consumption: 0.3*p(params,'n_cells',4), reagent_consumptions: {}, utilization_rate: 0.8, is_bottleneck: false, kpis: { gold_deposited_kg_h: actual_dep, current_efficiency_pct: eff*100 } },
      };
    },
  },

  {
    unitType: 'smelting_furnace', displayName: 'Four de fusion (doré)', category: 'Électrométallurgie',
    icon: '🔥', color: '#DC2626', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      temperature_c:   { label: 'Température (°C)',       unit: '°C',  default: 1200, type: 'number' },
      flux_kg_t:       { label: 'Fondant (kg/t)',          unit: 'kg/t', default: 150, type: 'number' },
      melt_efficiency: { label: 'Rendement fusion (%)',    unit: '%',   default: 99,   type: 'number' },
      capacity_kg_h:   { label: 'Capacité (kg/h Au)',      unit: 'kg/h', default: 100, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const eff = p(params,'melt_efficiency', 99) / 100;
      const slag_mass = feed.mass_flow * 0.15;
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow * (1 - 0.15 * (1-eff)), gold_flow: feed.gold_flow * eff, temperature: 1200 },
          { ...emptyStream(), mass_flow: slag_mass, gold_flow: feed.gold_flow * (1-eff) },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*0.85, recovery: eff*100, energy_consumption: 60, reagent_consumptions: { flux_kg_t: p(params,'flux_kg_t',150) }, utilization_rate: feed.gold_flow*1000 / Math.max(1, p(params,'capacity_kg_h',100)), is_bottleneck: false, kpis: { dore_purity_pct: 92 } },
      };
    },
  },

  {
    unitType: 'dore_refinery', displayName: 'Raffinerie doré (Miller)', category: 'Électrométallurgie',
    icon: '🏆', color: '#D97706', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      chlorine_kg_t: { label: 'Chlore (kg/t)',        unit: 'kg/t', default: 10,  type: 'number' },
      final_purity:  { label: 'Pureté finale Au (%)', unit: '%',   default: 99.5, type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const eff = p(params,'final_purity', 99.5) / 100;
      return {
        outStreams: [{ ...feed, gold_flow: feed.gold_flow * eff, temperature: 25 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*0.95, recovery: eff*100, energy_consumption: 30, reagent_consumptions: { chlorine_kg_t: p(params,'chlorine_kg_t',10) }, utilization_rate: 0.7, is_bottleneck: false, kpis: { final_purity_pct: eff*100 } },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SÉPARATION S/L
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'thickener', displayName: 'Épaississeur conventionnel', category: 'Séparation S/L',
    icon: '🔵', color: '#0EA5E9', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',            unit: 'm',   default: 30,  type: 'number' },
      underflow_pct:   { label: 'Densité underflow (%)',   unit: '%',   default: 55,  type: 'number', min: 40, max: 70 },
      flocculant_g_t:  { label: 'Floculant (g/t)',         unit: 'g/t', default: 30,  type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',          unit: 't/h', default: 250, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const uf_pct = p(params,'underflow_pct', 55) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 250);
      return {
        outStreams: [
          splitStream(feed, uf_pct, { solids_content: uf_pct * 100 }),
          splitStream(feed, 1 - uf_pct, { solids_content: 2 }),
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*uf_pct, recovery: 99, energy_consumption: 0.05, reagent_consumptions: { flocculant_g_t: p(params,'flocculant_g_t',30) }, utilization_rate: feed.mass_flow/Math.max(1,cap), is_bottleneck: false, kpis: { underflow_density_pct: uf_pct*100 } },
      };
    },
  },

  {
    unitType: 'high_rate_thickener', displayName: 'Épaississeur haute performance', category: 'Séparation S/L',
    icon: '⏬', color: '#0284C7', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',           unit: 'm',    default: 20,  type: 'number' },
      unit_area:       { label: 'Aire unitaire (m²/t/j)', unit: 'm²/t/j', default: 0.5, type: 'number' },
      underflow_pct:   { label: 'Densité underflow (%)',  unit: '%',    default: 60,  type: 'number' },
      flocculant_g_t:  { label: 'Floculant (g/t)',        unit: 'g/t',  default: 60,  type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',         unit: 't/h',  default: 300, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const uf_pct = p(params,'underflow_pct', 60) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 300);
      return {
        outStreams: [
          splitStream(feed, uf_pct, { solids_content: uf_pct * 100 }),
          splitStream(feed, 1 - uf_pct, { solids_content: 1 }),
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*uf_pct, recovery: 99.5, energy_consumption: 0.08, reagent_consumptions: { flocculant_g_t: p(params,'flocculant_g_t',60) }, utilization_rate: feed.mass_flow/Math.max(1,cap), is_bottleneck: false, kpis: {} },
      };
    },
  },

  {
    unitType: 'paste_thickener', displayName: 'Épaississeur à pâte (TSF)', category: 'Séparation S/L',
    icon: '🟦', color: '#1D4ED8', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      diameter_m:      { label: 'Diamètre (m)',            unit: 'm',   default: 15, type: 'number' },
      underflow_pct:   { label: 'Densité underflow (%)',   unit: '%',   default: 72, type: 'number', min: 65, max: 80 },
      flocculant_g_t:  { label: 'Floculant (g/t)',         unit: 'g/t', default: 100, type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',          unit: 't/h', default: 150, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const uf_pct = p(params,'underflow_pct', 72) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 150);
      return {
        outStreams: [
          splitStream(feed, uf_pct, { solids_content: uf_pct * 100 }),
          splitStream(feed, 1 - uf_pct, { solids_content: 1 }),
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*uf_pct, recovery: 99.8, energy_consumption: 0.15, reagent_consumptions: { flocculant_g_t: p(params,'flocculant_g_t',100) }, utilization_rate: feed.mass_flow/Math.max(1,cap), is_bottleneck: false, kpis: { paste_density_pct: uf_pct*100 } },
      };
    },
  },

  {
    unitType: 'ccd_circuit', displayName: 'CCD — Décantation contre-courant', category: 'Séparation S/L',
    icon: '🔄', color: '#0369A1', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      n_stages:        { label: 'Nb étages',               unit: '',    default: 4,   type: 'number', min: 3, max: 8 },
      wash_efficiency: { label: 'Efficacité lavage (%)',   unit: '%',   default: 98,  type: 'number' },
      flocculant_g_t:  { label: 'Floculant (g/t)',         unit: 'g/t', default: 50,  type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',          unit: 't/h', default: 200, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const wash_eff = p(params,'wash_efficiency', 98) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 200);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*0.6,     solids_content: 55, dissolved_gold: feed.dissolved_gold * (1-wash_eff), cyanide_concentration: feed.cyanide_concentration*(1-wash_eff) },
          { ...feed, mass_flow: feed.mass_flow*0.4,     solids_content: 2,  dissolved_gold: feed.dissolved_gold*wash_eff,        gold_flow: feed.gold_flow*wash_eff },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: wash_eff*100, energy_consumption: 0.1, reagent_consumptions: { flocculant_g_t: p(params,'flocculant_g_t',50) }, utilization_rate: feed.mass_flow/Math.max(1,cap), is_bottleneck: false, kpis: { wash_efficiency_pct: wash_eff*100 } },
      };
    },
  },

  {
    unitType: 'belt_filter', displayName: 'Filtre à bande sous vide', category: 'Séparation S/L',
    icon: '🟫', color: '#92400E', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      belt_width_m:    { label: 'Largeur bande (m)',        unit: 'm',   default: 3.0, type: 'number' },
      filter_rate:     { label: 'Taux de filtration (t/m²/h)', unit: 't/m²/h', default: 0.6, type: 'number' },
      cake_moisture:   { label: 'Humidité gâteau (%)',      unit: '%',   default: 18,  type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',           unit: 't/h', default: 100, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const moisture = p(params,'cake_moisture', 18) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 100);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*(1+moisture),     solids_content: 100-moisture*100 },
          { ...feed, mass_flow: feed.mass_flow*0.02,             solids_content: 1, dissolved_gold: feed.dissolved_gold },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 99, energy_consumption: 0.25, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { cake_moisture_pct: moisture*100 } },
      };
    },
  },

  {
    unitType: 'filter_press', displayName: 'Filtre-presse (plaques)', category: 'Séparation S/L',
    icon: '🗜', color: '#7C2D12', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      n_chambers:      { label: 'Nb chambres',              unit: '',    default: 60,  type: 'number' },
      chamber_volume:  { label: 'Volume chambre (L)',       unit: 'L',   default: 50,  type: 'number' },
      cake_moisture:   { label: 'Humidité gâteau (%)',      unit: '%',   default: 15,  type: 'number' },
      cycle_time_h:    { label: 'Durée cycle (h)',          unit: 'h',   default: 4,   type: 'number' },
      design_capacity: { label: 'Capacité (t/h)',           unit: 't/h', default: 30,  type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const moisture = p(params,'cake_moisture', 15) / 100;
      const cap = design_capacity ?? p(params,'design_capacity', 30);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow, solids_content: 100-moisture*100 },
          { ...emptyStream(), mass_flow: feed.volume_flow * 0.01, volume_flow: feed.volume_flow * 0.01, dissolved_gold: feed.dissolved_gold },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 99.5, energy_consumption: 0.4, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { cake_moisture_pct: moisture*100 } },
      };
    },
  },

  {
    unitType: 'centrifuge', displayName: 'Centrifugeuse', category: 'Séparation S/L',
    icon: '🔁', color: '#0369A1', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      g_force:         { label: 'Force centrifuge (g)',     unit: 'g',   default: 500,  type: 'number' },
      cake_moisture:   { label: 'Humidité gâteau (%)',      unit: '%',   default: 12,   type: 'number' },
      design_tph:      { label: 'Capacité (t/h)',           unit: 't/h', default: 20,   type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const moisture = p(params,'cake_moisture', 12) / 100;
      const cap = design_capacity ?? p(params,'design_tph', 20);
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, solids_content: 100-moisture*100 },
          { ...emptyStream(), mass_flow: feed.volume_flow*0.02, volume_flow: feed.volume_flow*0.02, dissolved_gold: feed.dissolved_gold },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 99.5, energy_consumption: 1.5, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { cake_moisture_pct: moisture*100 } },
      };
    },
  },

  {
    unitType: 'hydrosizer', displayName: 'Hydrosizer (classificateur hydraulique)', category: 'Séparation S/L',
    icon: '💧', color: '#0EA5E9', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      cut_size_micron: { label: 'Taille de coupure (µm)', unit: 'µm',  default: 75,  type: 'number' },
      n_chambers:      { label: 'Nb compartiments',       unit: '',    default: 4,   type: 'number' },
      design_tph:      { label: 'Capacité (t/h)',         unit: 't/h', default: 200, type: 'number' },
    },
    calculate(inputs, params, design_capacity) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cap = design_capacity ?? p(params,'design_tph', 200);
      const coarse_frac = 0.35;
      const util = feed.mass_flow / Math.max(1, cap);
      return {
        outStreams: [
          { ...feed, mass_flow: feed.mass_flow*coarse_frac,     gold_flow: feed.gold_flow*coarse_frac,     solids_content: 70 },
          { ...feed, mass_flow: feed.mass_flow*(1-coarse_frac), gold_flow: feed.gold_flow*(1-coarse_frac), solids_content: 20 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.2, reagent_consumptions: {}, utilization_rate: util, is_bottleneck: util > 0.85, kpis: { cut_size_micron: p(params,'cut_size_micron',75) } },
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EFFLUENTS — traitement & environnement
  // ══════════════════════════════════════════════════════════════════════════

  {
    unitType: 'cn_destruction_so2', displayName: 'Détox CN — SO₂/Air (INCO)', category: 'Effluents',
    icon: '🌿', color: '#65A30D', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      so2_ratio:      { label: 'Ratio SO₂/CN (kg/kg)',    unit: 'kg/kg', default: 3.5, type: 'number' },
      cn_target_ppm:  { label: 'CN⁻ cible sortie (ppm)', unit: 'ppm',   default: 5,   type: 'number' },
      cu_catalyst:    { label: 'Catalyseur Cu (mg/L)',    unit: 'mg/L',  default: 50,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cn_target = p(params,'cn_target_ppm', 5);
      const so2_ratio = p(params,'so2_ratio', 3.5);
      const cn_removed = Math.max(0, feed.cyanide_concentration - cn_target);
      return {
        outStreams: [{ ...feed, cyanide_concentration: cn_target, pH: 9 }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.15, reagent_consumptions: { so2_kg_t: so2_ratio*cn_removed/1000, cao_kg_t: 0.5, cuso4_kg_t: 0.1 }, utilization_rate: 0.7, is_bottleneck: false, kpis: { cn_removed_ppm: cn_removed, cn_effluent_ppm: cn_target } },
      };
    },
  },

  {
    unitType: 'cn_destruction_h2o2', displayName: 'Détox CN — H₂O₂ (peroxyde)', category: 'Effluents',
    icon: '🧴', color: '#65A30D', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      h2o2_ratio:     { label: 'Ratio H₂O₂/CN (kg/kg)', unit: 'kg/kg', default: 5.5,  type: 'number' },
      cn_target_ppm:  { label: 'CN⁻ cible sortie (ppm)', unit: 'ppm',   default: 10,   type: 'number' },
      ph_target:      { label: 'pH cible',                unit: '',      default: 8.5,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const cn_target = p(params,'cn_target_ppm', 10);
      const h2o2_ratio = p(params,'h2o2_ratio', 5.5);
      const cn_removed = Math.max(0, feed.cyanide_concentration - cn_target);
      return {
        outStreams: [{ ...feed, cyanide_concentration: cn_target, pH: p(params,'ph_target',8.5) }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.1, reagent_consumptions: { h2o2_kg_t: h2o2_ratio*cn_removed/1000 }, utilization_rate: 0.65, is_bottleneck: false, kpis: { cn_effluent_ppm: cn_target } },
      };
    },
  },

  {
    unitType: 'avr_process', displayName: 'Procédé AVR (recyclage cyanure)', category: 'Effluents',
    icon: '♻', color: '#16A34A', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      cn_recovery_pct: { label: 'Récupération CN (%)',   unit: '%',    default: 90,  type: 'number' },
      h2so4_kg_t:      { label: 'H₂SO₄ (kg/t)',          unit: 'kg/t', default: 8,   type: 'number' },
      lime_kg_t:       { label: 'Chaux (kg/t)',           unit: 'kg/t', default: 6,   type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cn_rec = p(params,'cn_recovery_pct', 90) / 100;
      return {
        outStreams: [
          { ...feed, cyanide_concentration: feed.cyanide_concentration * (1-cn_rec), pH: 8 },
          { ...emptyStream(), mass_flow: 0.001, cyanide_concentration: feed.cyanide_concentration * cn_rec * 1000 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.8, reagent_consumptions: { h2so4_kg_t: p(params,'h2so4_kg_t',8), lime_kg_t: p(params,'lime_kg_t',6) }, utilization_rate: 0.7, is_bottleneck: false, kpis: { cn_recovered_pct: cn_rec*100 } },
      };
    },
  },

  {
    unitType: 'sart_process', displayName: 'Procédé SART (Cu-CN)', category: 'Effluents',
    icon: '⚗', color: '#15803D', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      acid_ph:     { label: 'pH acidification',    unit: '',     default: 4.5,  type: 'number' },
      h2so4_kg_t:  { label: 'H₂SO₄ (kg/t)',        unit: 'kg/t', default: 3.5,  type: 'number' },
      cn_recovery: { label: 'Recyclage CN (%)',     unit: '%',    default: 85,   type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cn_rec = p(params,'cn_recovery', 85) / 100;
      return {
        outStreams: [
          { ...emptyStream(), mass_flow: 0.001, gold_flow: 0 },
          { ...feed, cyanide_concentration: feed.cyanide_concentration * cn_rec },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.5, reagent_consumptions: { h2so4_kg_t: p(params,'h2so4_kg_t',3.5) }, utilization_rate: 0.75, is_bottleneck: false, kpis: { cn_recovered_pct: cn_rec*100 } },
      };
    },
  },

  {
    unitType: 'tailings_pond', displayName: 'Bassin de résidus (TSF/Parc)', category: 'Effluents',
    icon: '🏞', color: '#4B5563', maxInputs: 2, maxOutputs: 1,
    defaultParameters: {
      capacity_m3:      { label: 'Capacité (Mm³)',          unit: 'Mm³', default: 10,   type: 'number' },
      seepage_pct:      { label: 'Perte par infiltration (%)', unit: '%', default: 0.5, type: 'number' },
      reclaim_rate_pct: { label: 'Recyclage eau (%)',        unit: '%',   default: 80,   type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      const reclaim = p(params,'reclaim_rate_pct', 80) / 100;
      return {
        outStreams: [{ ...feed, mass_flow: feed.mass_flow*reclaim*0.01, volume_flow: feed.volume_flow*reclaim, solids_content: 0, dissolved_gold: 0, cyanide_concentration: Math.max(0, feed.cyanide_concentration - 15) }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: 0, recovery: 100, energy_consumption: 0.05, reagent_consumptions: { lime_kg_t: 0.2 }, utilization_rate: 0.5, is_bottleneck: false, kpis: { water_reclaim_pct: reclaim*100 } },
      };
    },
  },

  {
    unitType: 'water_treatment', displayName: 'Traitement des eaux (ETP)', category: 'Effluents',
    icon: '💧', color: '#0284C7', maxInputs: 1, maxOutputs: 2,
    defaultParameters: {
      flow_m3_h:       { label: 'Débit (m³/h)',             unit: 'm³/h', default: 200, type: 'number' },
      cn_removal_pct:  { label: 'Abattement CN (%)',        unit: '%',    default: 99,  type: 'number' },
      tss_target_mg_l: { label: 'Cible TSS (mg/L)',         unit: 'mg/L', default: 25,  type: 'number' },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream(), emptyStream()], nodeResult: {} };
      const cn_rem = p(params,'cn_removal_pct', 99) / 100;
      return {
        outStreams: [
          { ...feed, cyanide_concentration: feed.cyanide_concentration*(1-cn_rem), dissolved_gold: feed.dissolved_gold*0.05, pH: 7.5 },
          { ...emptyStream(), mass_flow: feed.mass_flow*0.02 },
        ],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow*0.98, recovery: 100, energy_consumption: 0.3, reagent_consumptions: { chlorine_kg_t: 0.5, flocculant_g_t: 5 }, utilization_rate: feed.volume_flow / Math.max(1, p(params,'flow_m3_h',200)), is_bottleneck: false, kpis: { cn_effluent_ppm: feed.cyanide_concentration*(1-cn_rem) } },
      };
    },
  },

  {
    unitType: 'lime_dosing', displayName: 'Dosage chaux / Ajustement pH', category: 'Effluents',
    icon: '🥛', color: '#E5E7EB', maxInputs: 1, maxOutputs: 1,
    defaultParameters: {
      lime_kg_t:  { label: 'Chaux CaO (kg/t)', unit: 'kg/t', default: 1.5,  type: 'number' },
      ph_target:  { label: 'pH cible',          unit: '',     default: 10.5, type: 'number', min: 8, max: 12 },
    },
    calculate(inputs, params) {
      const feed = blendInputs(inputs);
      if (!feed.mass_flow) return { outStreams: [emptyStream()], nodeResult: {} };
      return {
        outStreams: [{ ...feed, pH: p(params,'ph_target', 10.5) }],
        nodeResult: { feed_rate: feed.mass_flow, product_rate: feed.mass_flow, recovery: 100, energy_consumption: 0.02, reagent_consumptions: { cao_kg_t: p(params,'lime_kg_t',1.5) }, utilization_rate: 0.7, is_bottleneck: false, kpis: { ph_out: p(params,'ph_target',10.5) } },
      };
    },
  },

];

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, UnitDefinition>(units.map(u => [u.unitType, u]));

export function getUnit(unitType: string): UnitDefinition | undefined {
  return registry.get(unitType);
}

export function getAllUnits(): UnitDefinition[] {
  return units;
}

export function getUnitsByCategory(): Record<string, UnitDefinition[]> {
  const out: Record<string, UnitDefinition[]> = {};
  for (const u of units) {
    if (!out[u.category]) out[u.category] = [];
    out[u.category].push(u);
  }
  return out;
}
