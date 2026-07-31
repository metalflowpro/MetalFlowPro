// ─────────────────────────────────────────────────────────────────────────────
// Gabarits Excel du module COS — même dispositif que le LIMS.
//
// L'opérateur télécharge un .xlsx, le remplit dans Excel, le réimporte. Chaque
// classeur porte deux feuilles :
//   • « Données » — en-têtes + lignes d'exemple à remplacer ;
//   • « Guide »   — description, obligation et valeurs acceptées par colonne.
//
// Le parseur mappe les en-têtes vers les clés canoniques puis délègue TOUTE la
// validation métier à ingestionImport.validateRecords : unités canoniques,
// horodatage UTC, drapeaux qualité et sign-off P754 n'existent qu'à un endroit.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx';
import {
  validateRecords, datasetDef,
  type ImportDatasetId, type ImportResult,
} from './ingestionImport';

export interface CosColumnDef {
  key: string;
  header: string;
  required: boolean;
  numeric: boolean;
  description: string;
  validValues?: string[];
}

export interface CosTemplate {
  dataset: ImportDatasetId;
  label: string;
  section: string;
  color: string;
  columns: CosColumnDef[];
  exampleRows: string[][];
}

// Rappel des 6 drapeaux du contrat d'ingestion, réutilisé dans plusieurs gabarits.
const QUALITY_VALUES = ['good', 'suspect', 'bad', 'missing', 'frozen', 'substitute'];
const QUALITY_COL: CosColumnDef = {
  key: 'quality', header: 'Qualite', required: false, numeric: false,
  description: 'Drapeau qualité de la mesure ; « substitute » impose un sign-off (P754 n°6)',
  validValues: QUALITY_VALUES,
};

export const COS_TEMPLATES: CosTemplate[] = [
  // ── §1 Tags temps réel ──────────────────────────────────────────────────
  {
    dataset: 'tags',
    label: 'Tags temps réel (OPC-UA / SCADA / Historian)',
    section: '§1',
    color: '#38BDF8',
    columns: [
      { key: 'source',     header: 'Source',        required: false, numeric: false, description: 'Serveur d\'origine (ex. opcua:opc-server-01)' },
      { key: 'asset_path', header: 'Chemin_Actif',  required: false, numeric: false, description: 'Chemin de l\'équipement (ex. plant/grinding/sag-mill-01)' },
      { key: 'tag',        header: 'Tag',           required: true,  numeric: false, description: 'Nom du tag historian (ex. SAG01.PWR)' },
      { key: 'unit',       header: 'Unite',         required: false, numeric: false, description: 'Unité canonique : kW, t/h, %solids, um, mg/L, degC, pH…' },
      { key: 'ts',         header: 'Horodatage_UTC', required: true, numeric: false, description: 'Horodatage UTC ISO-8601, ex. 2026-07-22T14:00:10Z' },
      { key: 'value',      header: 'Valeur',        required: false, numeric: true,  description: 'Valeur mesurée ; laisser vide si qualité = missing' },
      QUALITY_COL,
      { key: 'confidence', header: 'Confiance',     required: false, numeric: true,  description: 'Score de confiance entre 0 et 1 (ex. 0.98)' },
      { key: 'lineage',    header: 'Lignage',       required: false, numeric: false, description: 'Origine d\'une valeur dérivée (ex. soft-sensor:model-p80-v3)' },
      { key: 'note',       header: 'Note',          required: false, numeric: false, description: 'Commentaire libre' },
    ],
    exampleRows: [
      ['opcua:opc-server-01', 'plant/grinding/sag-mill-01', 'SAG01.PWR',      'kW',      '2026-07-22T14:00:10Z', '4820.5', 'good',       '0.99', '',                             ''],
      ['opcua:opc-server-01', 'plant/grinding/sag-mill-01', 'SAG01.FEED_DRY', 't/h',     '2026-07-22T14:00:10Z', '412',    'good',       '0.98', '',                             ''],
      ['opcua:opc-server-01', 'plant/grinding/sag-mill-01', 'SAG01.P80',      'um',      '2026-07-22T14:00:10Z', '150',    'substitute', '0.82', 'soft-sensor:model-p80-v3',     'PSA en maintenance'],
      ['opcua:opc-server-01', 'plant/grinding/sag-mill-01', 'SAG01.BALL_LVL', '%',       '2026-07-22T14:00:10Z', '',       'missing',    '0',    '',                             ''],
    ],
  },

  // ── §3.1 Lots de minerai ────────────────────────────────────────────────
  {
    dataset: 'ore_lots',
    label: 'Lots de minerai (caractérisation géo-métallurgique)',
    section: '§3.1',
    color: '#F59E0B',
    columns: [
      { key: 'lot_id',             header: 'ID_Lot',            required: true,  numeric: false, description: 'Identifiant unique du lot (ex. ORELOT-2026-0722-VN-014)' },
      { key: 'source_name',        header: 'Source',            required: false, numeric: false, description: 'Origine du lot (mine, stockpile)' },
      { key: 'au_g_t',             header: 'Au_g_t',            required: true,  numeric: true,  description: 'Teneur en or (g/t)' },
      { key: 'tonnage_t',          header: 'Tonnage_sec_t',     required: true,  numeric: true,  description: 'Tonnage sec (t)' },
      { key: 'bwi',                header: 'BWi_kWh_t',         required: false, numeric: true,  description: 'Bond Work Index (kWh/t)' },
      { key: 'spi',                header: 'SPI_min',           required: false, numeric: true,  description: 'SAG Power Index (min)' },
      { key: 'sulfides_pct',       header: 'Sulfures_pct',      required: false, numeric: true,  description: 'Soufre sulfure (%)' },
      { key: 'arsenic_ppm',        header: 'Arsenic_ppm',       required: false, numeric: true,  description: 'Arsenic (ppm)' },
      { key: 'organic_carbon_pct', header: 'Corg_PRC_pct',      required: false, numeric: true,  description: 'Carbone organique — risque preg-robbing (%)' },
      { key: 'clay_pct',           header: 'Argiles_pct',       required: false, numeric: true,  description: 'Teneur en argiles (%)' },
      { key: 'stockpile_id',       header: 'ID_Stockpile',      required: false, numeric: false, description: 'Stockpile de destination' },
    ],
    exampleRows: [
      ['ORELOT-2026-0722-VN-014', 'vein-norte', '4.1', '5200', '14.8', '95',  '2.2', '1800', '0.45', '3.1', 'SP-ROM-01'],
      ['ORELOT-2026-0721-OX-009', 'oxide-sur',  '2.8', '15200', '11.4', '62', '0.2', '300',  '0.05', '1.4', 'SP-OXIDE-03'],
    ],
  },

  // ── §3.2 Mouvements de minerai ──────────────────────────────────────────
  {
    dataset: 'ore_movements',
    label: 'Mouvements de minerai (ponts-bascules)',
    section: '§3.2',
    color: '#A78BFA',
    columns: [
      { key: 'movement_id',   header: 'ID_Mouvement',    required: true,  numeric: false, description: 'Identifiant unique du mouvement' },
      { key: 'ts',            header: 'Horodatage_UTC',  required: true,  numeric: false, description: 'Horodatage UTC ISO-8601 du pesage' },
      { key: 'from_location', header: 'Origine',         required: false, numeric: false, description: 'Provenance (ex. mine/vein-norte/B-1140)' },
      { key: 'to_location',   header: 'Destination',     required: false, numeric: false, description: 'Destination (ex. SP-ROM-01)' },
      { key: 'lot_id',        header: 'ID_Lot',          required: false, numeric: false, description: 'Lot rattaché' },
      { key: 'tonnage_wet_t', header: 'Tonnage_humide_t', required: false, numeric: true, description: 'Tonnage humide pesé (t)' },
      { key: 'moisture_pct',  header: 'Humidite_pct',    required: false, numeric: true,  description: 'Humidité (%)' },
      { key: 'tonnage_dry_t', header: 'Tonnage_sec_t',   required: false, numeric: true,  description: 'Tonnage sec (t) — calculé si laissé vide' },
      { key: 'truck_id',      header: 'ID_Camion',       required: false, numeric: false, description: 'Identifiant du camion' },
      { key: 'operator',      header: 'Operateur',       required: false, numeric: false, description: 'Opérateur' },
      QUALITY_COL,
    ],
    exampleRows: [
      ['MV-2026072210001', '2026-07-22T14:20:00Z', 'mine/vein-norte/B-1140', 'SP-ROM-01', 'ORELOT-2026-0722-VN-014', '82.0', '7.5', '75.85', 'TR-2041', 'operator:mah', 'good'],
      ['MV-2026072210002', '2026-07-22T14:24:00Z', 'mine/vein-norte/B-1140', 'SP-ROM-01', 'ORELOT-2026-0722-VN-014', '80.5', '7.5', '',      'TR-2038', 'operator:mah', 'good'],
    ],
  },

  // ── §4 Stockpiles ───────────────────────────────────────────────────────
  {
    dataset: 'stockpiles',
    label: 'Stockpiles (inventaire et composition)',
    section: '§4',
    color: '#F97316',
    columns: [
      { key: 'name',                 header: 'ID_Stockpile',    required: true,  numeric: false, description: 'Identifiant du tas (ex. SP-ROM-01)' },
      { key: 'current_tonnage_t',    header: 'Inventaire_sec_t', required: true, numeric: true,  description: 'Inventaire sec courant (t)' },
      { key: 'blended_au_g_t',       header: 'Au_melange_g_t',  required: false, numeric: true,  description: 'Teneur or du mélange (g/t)' },
      { key: 'blended_bwi',          header: 'BWi_melange',     required: false, numeric: true,  description: 'BWi du mélange (kWh/t)' },
      { key: 'blended_sulfides_pct', header: 'Sulfures_melange_pct', required: false, numeric: true, description: 'Sulfures du mélange (%)' },
      { key: 'blended_prc_pct',      header: 'Corg_PRC_melange_pct', required: false, numeric: true, description: 'Carbone organique du mélange (%)' },
      { key: 'reclaim_rate_tph',     header: 'Debit_reprise_t_h', required: false, numeric: true, description: 'Débit de reprise (t/h)' },
    ],
    exampleRows: [
      ['SP-ROM-01',   '18400', '3.02', '14.2', '1.10', '0.62', '450'],
      ['SP-OXIDE-03', '9500',  '2.10', '11.4', '0.20', '0.05', '300'],
    ],
  },

  // ── §5 Réactifs & utilités ──────────────────────────────────────────────
  {
    dataset: 'reagents',
    label: 'Réactifs & utilités (consommation par période)',
    section: '§5',
    color: '#34D399',
    columns: [
      { key: 'name',          header: 'Produit',         required: true,  numeric: false, description: 'Réactif ou utilité (NaCN, CaO_lime, electricity…)' },
      { key: 'kind',          header: 'Nature',          required: false, numeric: false, description: 'reagent (réactif) ou utility (utilité)', validValues: ['reagent', 'utility'] },
      { key: 'asset_path',    header: 'Chemin_Actif',    required: false, numeric: false, description: 'Poste concerné (ex. plant/leaching/cil-train-A/dosing)' },
      { key: 'period_from',   header: 'Periode_debut_UTC', required: false, numeric: false, description: 'Début de période, UTC ISO-8601' },
      { key: 'period_to',     header: 'Periode_fin_UTC', required: false, numeric: false, description: 'Fin de période, UTC ISO-8601' },
      { key: 'consumed_qty',  header: 'Quantite',        required: false, numeric: true,  description: 'Quantité consommée sur la période' },
      { key: 'consumed_unit', header: 'Unite',           required: true,  numeric: false, description: 'Unité canonique de la quantité', validValues: ['kg', 'Nm3', 'kWh', 'm3'] },
      { key: 'dose_kg_t',     header: 'Dose_kg_t',       required: false, numeric: true,  description: 'Dosage spécifique (kg/t)' },
      { key: 'stock_t',       header: 'Stock_t',         required: false, numeric: true,  description: 'Stock restant (t)' },
      { key: 'source',        header: 'Source',          required: false, numeric: false, description: 'Système d\'origine' },
      QUALITY_COL,
    ],
    exampleRows: [
      ['NaCN',        'reagent', 'plant/leaching/cil-train-A/dosing', '2026-07-22T14:00:00Z', '2026-07-22T15:00:00Z', '142.5', 'kg',  '0.34', '12.4', 'opcua:opc-server-03', 'good'],
      ['CaO_lime',    'reagent', 'plant/leaching/cil-train-A/dosing', '2026-07-22T14:00:00Z', '2026-07-22T15:00:00Z', '318',   'kg',  '0.76', '48.2', 'opcua:opc-server-03', 'good'],
      ['O2',          'reagent', 'plant/leaching/cil-train-A/oxygen', '2026-07-22T14:00:00Z', '2026-07-22T15:00:00Z', '240',   'Nm3', '',     '',     'opcua:opc-server-03', 'good'],
      ['electricity', 'utility', 'plant',                             '2026-07-22T14:00:00Z', '2026-07-22T15:00:00Z', '6420',  'kWh', '',     '',     'opcua:opc-server-03', 'good'],
    ],
  },

  // ── §6 Événements & arrêts ──────────────────────────────────────────────
  {
    dataset: 'cmms_events',
    label: 'Événements & arrêts équipements (CMMS)',
    section: '§6',
    color: '#F87171',
    columns: [
      { key: 'event_id',      header: 'ID_Evenement',    required: true,  numeric: false, description: 'Identifiant unique de l\'événement' },
      { key: 'asset_path',    header: 'Chemin_Actif',    required: false, numeric: false, description: 'Équipement concerné (ex. plant/grinding/sag-mill-01)' },
      { key: 'event_type',    header: 'Type',            required: false, numeric: false, description: 'Nature de l\'événement', validValues: ['downtime', 'performance_loss', 'other'] },
      { key: 'severity',      header: 'Severite',        required: false, numeric: false, description: 'Gravité', validValues: ['urgent', 'high', 'medium', 'low'] },
      { key: 'reason_code',   header: 'Code_Cause',      required: false, numeric: false, description: 'Code de cause (ex. MECH_BRAKE_BLOCKAGE)' },
      { key: 'started_at',    header: 'Debut_UTC',       required: true,  numeric: false, description: 'Début de l\'événement, UTC ISO-8601' },
      { key: 'ended_at',      header: 'Fin_UTC',         required: false, numeric: false, description: 'Fin, UTC ISO-8601 ; vide si en cours' },
      { key: 'duration_min',  header: 'Duree_min',       required: false, numeric: true,  description: 'Durée (min) — calculée si début et fin sont fournis' },
      { key: 'description',   header: 'Description',     required: false, numeric: false, description: 'Description libre' },
      { key: 'work_order_id', header: 'ID_Ordre_Travail', required: false, numeric: false, description: 'Ordre de travail rattaché' },
      { key: 'operator',      header: 'Operateur',       required: false, numeric: false, description: 'Opérateur ayant constaté' },
      { key: 'source',        header: 'Source',          required: false, numeric: false, description: 'GMAO d\'origine (ex. cmms:gmao-prod)' },
    ],
    exampleRows: [
      ['EVT-20260722145000', 'plant/grinding/sag-mill-01',      'downtime',         'medium', 'MECH_BRAKE_BLOCKAGE', '2026-07-22T14:50:00Z', '2026-07-22T15:08:00Z', '18', 'Blocage tampon de frein, dégagement manuel', 'WO-55120', 'operator:mah', 'cmms:gmao-prod'],
      ['EVT-20260722151000', 'plant/grinding/cyclone-cluster-01', 'performance_loss', 'low',   'CYCLONE_ROPING',      '2026-07-22T15:10:00Z', '',                     '',   'Cyclone C3 en roping, bypass ouvert',       '',          'operator:mah', 'cmms:gmao-prod'],
    ],
  },

  // ── §6.1 Ordres de travail ──────────────────────────────────────────────
  {
    dataset: 'work_orders',
    label: 'Ordres de travail (GMAO)',
    section: '§6.1',
    color: '#FBBF24',
    columns: [
      { key: 'wo_id',          header: 'ID_Ordre',       required: true,  numeric: false, description: 'Identifiant unique de l\'ordre de travail' },
      { key: 'asset_path',     header: 'Chemin_Actif',   required: false, numeric: false, description: 'Équipement concerné' },
      { key: 'wo_type',        header: 'Type',           required: false, numeric: false, description: 'Nature de l\'intervention', validValues: ['corrective', 'preventive', 'predictive'] },
      { key: 'priority',       header: 'Priorite',       required: false, numeric: true,  description: 'Priorité (1 = la plus haute)' },
      { key: 'created_at_src', header: 'Cree_le_UTC',    required: false, numeric: false, description: 'Date de création dans la GMAO, UTC ISO-8601' },
      { key: 'scheduled_at',   header: 'Planifie_le_UTC', required: false, numeric: false, description: 'Date planifiée, UTC ISO-8601' },
      { key: 'status',         header: 'Statut',         required: false, numeric: false, description: 'État de l\'ordre', validValues: ['planned', 'in_progress', 'closed', 'cancelled'] },
      { key: 'assignee',       header: 'Assigne_a',      required: false, numeric: false, description: 'Intervenant (ex. mech:jrios)' },
      { key: 'description',    header: 'Description',    required: false, numeric: false, description: 'Description de l\'intervention' },
      { key: 'source',         header: 'Source',         required: false, numeric: false, description: 'GMAO d\'origine' },
    ],
    exampleRows: [
      ['WO-55120', 'plant/grinding/sag-mill-01',        'corrective', '3', '2026-07-22T15:08:00Z', '2026-07-22T15:30:00Z', 'closed',  'mech:jrios',   'Blocage tampon de frein dégagé', 'cmms:gmao-prod'],
      ['WO-55124', 'plant/leaching/cil-train-A/oxygen', 'preventive', '2', '2026-07-22T13:00:00Z', '2026-07-23T08:00:00Z', 'planned', 'inst:lcastro', 'Calibrage débitmètre O2',        'cmms:gmao-prod'],
    ],
  },

  // ── §7 Quarts & campagnes ───────────────────────────────────────────────
  {
    dataset: 'shifts',
    label: 'Quarts & campagnes (contexte opérationnel)',
    section: '§7',
    color: '#22D3EE',
    columns: [
      { key: 'shift_id',              header: 'ID_Quart',        required: true,  numeric: false, description: 'Identifiant du quart (ex. SHIFT-2026-07-22-D)' },
      { key: 'shift_type',            header: 'Type',            required: false, numeric: false, description: 'Quart de jour ou de nuit', validValues: ['day', 'night'] },
      { key: 'tz',                    header: 'Timezone',        required: false, numeric: false, description: 'Fuseau horaire du site (ex. America/Toronto)' },
      { key: 'start_time',            header: 'Debut_UTC',       required: true,  numeric: false, description: 'Début du quart, UTC ISO-8601' },
      { key: 'end_time',              header: 'Fin_UTC',         required: false, numeric: false, description: 'Fin du quart, UTC ISO-8601' },
      { key: 'supervisor',            header: 'Superviseur',     required: false, numeric: false, description: 'Chef de quart' },
      { key: 'crew',                  header: 'Equipe',          required: false, numeric: false, description: 'Membres séparés par un point-virgule' },
      { key: 'target_throughput_t_h', header: 'Cible_debit_t_h', required: false, numeric: true,  description: 'Débit cible (t/h)' },
      { key: 'target_recovery_pct',   header: 'Cible_recup_pct', required: false, numeric: true,  description: 'Récupération cible (%)' },
      { key: 'target_au_oz',          header: 'Cible_Au_oz',     required: false, numeric: true,  description: 'Production or cible (oz)' },
      { key: 'campaign_id',           header: 'ID_Campagne',     required: false, numeric: false, description: 'Campagne rattachée' },
      { key: 'campaign_strategy',     header: 'Strategie_minerai', required: false, numeric: false, description: 'Stratégie minerai de la campagne' },
      { key: 'notes',                 header: 'Notes',           required: false, numeric: false, description: 'Observations' },
    ],
    exampleRows: [
      ['SHIFT-2026-07-22-D', 'day',   'America/Toronto', '2026-07-22T12:00:00Z', '2026-07-22T20:00:00Z', 'shift-lead:rgomez', 'operator:mah; operator:lduarte; metallurgist:jperez', '415', '93.0', '320', 'CAMP-2026-H2', 'stabilize_feed_blend_PRC_diluted', 'Minéralogie mixte'],
      ['SHIFT-2026-07-22-N', 'night', 'America/Toronto', '2026-07-22T20:00:00Z', '2026-07-23T04:00:00Z', 'shift-lead:msilva', 'operator:tdiallo; operator:kbrown',                    '410', '92.5', '310', 'CAMP-2026-H2', 'stabilize_feed_blend_PRC_diluted', ''],
    ],
  },
];

/** Gabarit d'un jeu de données. */
export function cosTemplate(dataset: ImportDatasetId): CosTemplate | undefined {
  return COS_TEMPLATES.find(t => t.dataset === dataset);
}

// ═══ Génération du classeur ══════════════════════════════════════════════════

/**
 * Construit le classeur d'un gabarit : feuille « Données » (en-têtes + exemples)
 * et feuille « Guide » (documentation par colonne). Retourné plutôt qu'écrit
 * directement pour rester testable hors navigateur.
 */
export function buildCosWorkbook(dataset: ImportDatasetId): XLSX.WorkBook | null {
  const tmpl = cosTemplate(dataset);
  if (!tmpl) return null;
  const def = datasetDef(dataset);

  const wb = XLSX.utils.book_new();

  // ── Feuille 1 : Données ──
  const headers = tmpl.columns.map(c => c.header);
  const wsData = XLSX.utils.aoa_to_sheet([headers, ...tmpl.exampleRows]);
  wsData['!cols'] = tmpl.columns.map(c => ({ wch: Math.max(c.header.length + 4, 18) }));
  wsData['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsData, 'Données');

  // ── Feuille 2 : Guide ──
  const guide: string[][] = [
    ['Colonne', 'Description', 'Obligatoire', 'Type / Valeurs acceptées'],
    ...tmpl.columns.map(c => [
      c.header,
      c.description,
      c.required ? 'OUI ✱' : 'Optionnel',
      c.validValues ? c.validValues.join(' | ') : c.numeric ? 'Nombre décimal (ex. 14.5)' : 'Texte libre',
    ]),
    [],
    ['— Règles d\'ingestion —'],
    ['Horodatage', 'UTC ISO-8601 obligatoire, format 2026-07-22T14:00:10Z (le suffixe Z est requis)'],
    ['Unités', 'Une unité hors catalogue canonique fait rejeter la ligne — aucune conversion silencieuse'],
    ['Qualité', 'good | suspect | bad | missing | frozen | substitute'],
    ['Sign-off P754', '« substitute » ou statut provisoire impose une validation avant reporting financier (principe n°6)'],
    ['Ré-import', def.conflictKey ? `Idempotent sur ${def.conflictKey.replace('project_id,', '')} — réimporter met à jour au lieu de dupliquer` : 'Chaque import ajoute de nouvelles lignes'],
    ['Table cible', def.table],
    [],
    ['Les lignes d\'exemple de la feuille « Données » sont à remplacer par vos données.'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide['!cols'] = [{ wch: 26 }, { wch: 70 }, { wch: 14 }, { wch: 38 }];
  wsGuide['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide');

  return wb;
}

/** Télécharge le gabarit .xlsx d'un jeu de données (navigateur). */
export function downloadCosXlsxTemplate(dataset: ImportDatasetId) {
  const wb = buildCosWorkbook(dataset);
  if (!wb) return;
  XLSX.writeFile(wb, `gabarit_cos_${dataset}.xlsx`);
}

// ═══ Lecture d'un gabarit rempli ═════════════════════════════════════════════

/**
 * Transforme une matrice de cellules (feuille « Données ») en enregistrements à
 * clés canoniques, en s'appuyant sur les en-têtes du gabarit.
 *
 * Les en-têtes inconnus sont ignorés et les colonnes absentes traitées comme
 * vides : un opérateur qui réordonne ou supprime une colonne facultative dans
 * Excel ne casse pas l'import.
 */
export function recordsFromSheet(
  dataset: ImportDatasetId,
  matrix: Array<Array<string | number | boolean | null>>,
): { records: Array<Record<string, unknown>>; missingRequired: string[] } {
  const tmpl = cosTemplate(dataset);
  if (!tmpl || matrix.length < 2) return { records: [], missingRequired: [] };

  const headerRow = (matrix[0] ?? []).map(h => String(h ?? '').trim().toLowerCase());
  const colIndex: Record<string, number> = {};
  for (const col of tmpl.columns) {
    colIndex[col.key] = headerRow.findIndex(h => h === col.header.toLowerCase());
  }

  const missingRequired = tmpl.columns
    .filter(c => c.required && colIndex[c.key] < 0)
    .map(c => c.header);

  const records: Array<Record<string, unknown>> = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const rec: Record<string, unknown> = {};
    let hasValue = false;
    for (const col of tmpl.columns) {
      const idx = colIndex[col.key];
      const raw = idx >= 0 ? cells[idx] : undefined;
      const val = raw == null ? '' : String(raw).trim();
      if (val !== '') hasValue = true;
      rec[col.key] = val;
    }
    if (hasValue) records.push(rec); // ignore les lignes entièrement vides
  }

  return { records, missingRequired };
}

/**
 * Lit un gabarit .xlsx rempli et retourne le même `ImportResult` que les autres
 * chemins d'import : la validation métier est celle de `validateRecords`.
 */
export function parseCosXlsx(dataset: ImportDatasetId, arrayBuffer: ArrayBuffer): ImportResult {
  const empty: ImportResult = {
    dataset, format: 'xlsx', rows: [], rejected: [], warnings: [],
    requiresSignoff: false, summary: { total: 0, accepted: 0, rejected: 0 }, fatal: null,
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  } catch (err) {
    return { ...empty, fatal: `Fichier Excel illisible : ${(err as Error).message}` };
  }

  // La feuille « Données » si elle existe, sinon la première du classeur.
  const sheetName = wb.SheetNames.includes('Données') ? 'Données' : wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) return { ...empty, fatal: 'Classeur vide : aucune feuille exploitable.' };

  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(ws, {
    header: 1, defval: '', blankrows: false, raw: false,
  });

  if (matrix.length < 2) {
    return { ...empty, fatal: 'La feuille « Données » ne contient que l\'en-tête — aucune ligne à importer.' };
  }

  const { records, missingRequired } = recordsFromSheet(dataset, matrix);

  if (missingRequired.length > 0) {
    return {
      ...empty,
      fatal: `Colonne(s) obligatoire(s) absente(s) de l'en-tête : ${missingRequired.join(', ')}. Repartez du gabarit téléchargé.`,
    };
  }
  if (records.length === 0) {
    return { ...empty, fatal: 'Aucune ligne remplie dans la feuille « Données ».' };
  }

  return validateRecords(dataset, records, 'xlsx');
}
