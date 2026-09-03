import * as XLSX from '@e965/xlsx';

export interface ColumnDef {
  key: string;
  header: string;
  required: boolean;
  numeric: boolean;
  description: string;
  validValues?: string[];
  dbSkip?: boolean; // present in template for context but not inserted to DB
}

export interface LimsTemplate {
  code: string;
  label: string;
  color: string;
  table: string;
  needsSampleLookup: boolean;
  columns: ColumnDef[];
  exampleRows: string[][];
}

export const LIMS_TEMPLATES: LimsTemplate[] = [
  // ── 0. Échantillons ────────────────────────────────────────────────────
  {
    code: 'samples',
    label: 'Échantillons',
    color: '#F59E0B',
    table: 'lims_samples',
    needsSampleLookup: false,
    columns: [
      { key: 'sample_id',    header: 'ID_Echantillon',  required: true,  numeric: false, description: 'Identifiant unique (ex. KMG-001)' },
      { key: 'campaign',     header: 'Campagne',         required: false, numeric: false, description: 'Nom de la campagne (ex. Camp-2026-A)' },
      { key: 'domain',       header: 'Domaine',          required: false, numeric: false, description: 'Domaine géologique' },
      { key: 'ore_type',     header: 'Type_minerai',     required: false, numeric: false, description: 'Type de minerai' },
      { key: 'zone',         header: 'Zone',             required: false, numeric: false, description: 'Zone ou secteur' },
      { key: 'status',       header: 'Statut',           required: false, numeric: false, description: 'pending | passed | failed | flagged', validValues: ['pending', 'passed', 'failed', 'flagged'] },
      { key: 'notes',        header: 'Notes',            required: false, numeric: false, description: 'Observations libres' },
      // ── Spatial / collar data ──────────────────────────────────────────
      { key: 'hole_id',      header: 'ID_Sondage',       required: false, numeric: false, description: 'Identifiant du sondage (ex. BH-001)' },
      { key: 'x_coord',      header: 'X_coord_m',        required: false, numeric: true,  description: 'Coordonnée X (Easting m)' },
      { key: 'y_coord',      header: 'Y_coord_m',        required: false, numeric: true,  description: 'Coordonnée Y (Northing m)' },
      { key: 'elevation',    header: 'Elevation_m',      required: false, numeric: true,  description: 'Elevation / RL du collar (m)' },
      { key: 'depth_from',   header: 'Prof_Debut_m',     required: false, numeric: true,  description: 'Profondeur début intervalle (m)' },
      { key: 'depth_to',     header: 'Prof_Fin_m',       required: false, numeric: true,  description: 'Profondeur fin intervalle (m)' },
      { key: 'dip_deg',      header: 'Pendage_deg',      required: false, numeric: true,  description: 'Pendage / dip (°, négatif = plongeant)' },
      { key: 'azimuth_deg',  header: 'Azimuth_deg',      required: false, numeric: true,  description: 'Azimut (°, 0–360)' },
      { key: 'length_m',     header: 'Longueur_m',       required: false, numeric: true,  description: 'Longueur totale du sondage (m)' },
      { key: 'drill_type',   header: 'Type_forage',      required: false, numeric: false, description: 'Type de forage (ex. DDH, RC, AC, RAB)' },
    ],
    exampleRows: [
      ['KMG-001', 'Camp-2026-A', 'Oxyde HG',   'Oxyde',      'Zone Nord', 'pending', 'Composite référence', 'BH-001', '567842.5', '1234567.8', '485.2', '0',   '12.5', '-55', '045', '120', 'DDH'],
      ['KMG-002', 'Camp-2026-A', 'Sulfure LG', 'Sulfure',    'Zone Sud',  'pending', '',                    'BH-001', '567842.5', '1234567.8', '485.2', '12.5','25.0', '-55', '045', '120', 'DDH'],
      ['KMG-003', 'Camp-2026-B', 'Transition', 'Transition', 'Zone Est',  'pending', 'Variabilité haute',   'BH-002', '567920.0', '1234610.0', '490.0', '0',   '18.0', '-60', '090', '150', 'RC'],
    ],
  },

  // ── 1. Analyse chimique élémentaire ───────────────────────────────────
  {
    code: 'chem',
    label: 'Analyse chimique élémentaire (Fire Assay / ICP-MS / XRF / LECO)',
    color: '#F59E0B',
    table: 'lims_test_chem',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',     header: 'ID_Echantillon', required: true,  numeric: false, description: 'ID existant dans la table Échantillons' },
      { key: 'domain',        header: 'Domaine',        required: false, numeric: false, description: 'Domaine géologique (informatif)', dbSkip: true },
      { key: 'au_g_t',        header: 'Au_g_t',         required: false, numeric: true,  description: 'Teneur en or (g/t) — Fire Assay' },
      { key: 'ag_g_t',        header: 'Ag_g_t',         required: false, numeric: true,  description: 'Teneur en argent (g/t) — ICP-MS' },
      { key: 'cu_pct',        header: 'Cu_pct',         required: false, numeric: true,  description: 'Cuivre (%)' },
      { key: 'fe_pct',        header: 'Fe_pct',         required: false, numeric: true,  description: 'Fer total (%)' },
      { key: 's_total_pct',   header: 'S_total_pct',    required: false, numeric: true,  description: 'Soufre total (%) — LECO' },
      { key: 's_sulfide_pct', header: 'S_sulfure_pct',  required: false, numeric: true,  description: 'Soufre sulfure (%)' },
      { key: 'as_ppm',        header: 'As_ppm',         required: false, numeric: true,  description: 'Arsenic (ppm)' },
      { key: 'c_organic_pct', header: 'C_organique_pct',required: false, numeric: true,  description: 'Carbone organique (%) — LECO' },
      { key: 'sb_ppm',        header: 'Sb_ppm',         required: false, numeric: true,  description: 'Antimoine (ppm)' },
      { key: 'hg_ppm',        header: 'Hg_ppm',         required: false, numeric: true,  description: 'Mercure (ppm)' },
      { key: 'sio2_pct',      header: 'SiO2_pct',       required: false, numeric: true,  description: 'Silice SiO₂ (%) — XRF' },
      { key: 'al2o3_pct',     header: 'Al2O3_pct',      required: false, numeric: true,  description: 'Alumine Al₂O₃ (%)' },
      { key: 'cao_pct',       header: 'CaO_pct',        required: false, numeric: true,  description: 'Chaux CaO (%)' },
      { key: 'mgo_pct',       header: 'MgO_pct',        required: false, numeric: true,  description: 'Magnésie MgO (%)' },
      { key: 'na2o_pct',      header: 'Na2O_pct',       required: false, numeric: true,  description: 'Na₂O (%)' },
      { key: 'k2o_pct',       header: 'K2O_pct',        required: false, numeric: true,  description: 'K₂O (%)' },
      { key: 'tio2_pct',      header: 'TiO2_pct',       required: false, numeric: true,  description: 'TiO₂ (%)' },
      { key: 'mno_pct',       header: 'MnO_pct',        required: false, numeric: true,  description: 'MnO (%)' },
      { key: 'loi_950_pct',   header: 'LOI_950_pct',    required: false, numeric: true,  description: 'Perte au feu 950°C (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG',   '3.45', '1.20', '0.05', '15.2', '2.1', '1.8', '150', '0.30', '8',  '0.001', '60.1', '8.2', '2.1', '1.5', '2.8', '1.2', '0.35', '0.08', '4.2'],
      ['KMG-002', 'Sulfure LG', '1.20', '0.80', '0.02', '12.5', '0.8', '0.6', '80',  '0.10', '4',  '0.002', '55.3', '9.1', '3.2', '2.0', '3.1', '1.8', '0.28', '0.06', '2.8'],
    ],
  },

  // ── 2. Minéralogie quantitative ────────────────────────────────────────
  {
    code: 'mineralogy',
    label: 'Minéralogie quantitative (QEMSCAN / MLA)',
    color: '#9D78F0',
    table: 'lims_test_mineralogy',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',           header: 'ID_Echantillon',  required: true,  numeric: false, description: 'ID existant dans la table Échantillons' },
      { key: 'domain',              header: 'Domaine',         required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'k80_um',              header: 'K80_um',          required: false, numeric: true,  description: 'Taille broyage analyse K80 (µm)' },
      { key: 'pyrite_pct',          header: 'Pyrite_pct',      required: false, numeric: true,  description: 'Pyrite (%)' },
      { key: 'pyrrhotite_pct',      header: 'Pyrrhotite_pct',  required: false, numeric: true,  description: 'Pyrrhotite (%)' },
      { key: 'other_sulphides_pct', header: 'AutresSulfures_pct', required: false, numeric: true, description: 'Autres sulfures (%)' },
      { key: 'quartz_pct',          header: 'Quartz_pct',      required: false, numeric: true,  description: 'Quartz (%)' },
      { key: 'plagioclase_pct',     header: 'Plagioclase_pct', required: false, numeric: true,  description: 'Plagioclase (%)' },
      { key: 'k_feldspar_pct',      header: 'Kfeldspar_pct',   required: false, numeric: true,  description: 'K-Feldspar (%)' },
      { key: 'argilite_pct',        header: 'Argilite_pct',    required: false, numeric: true,  description: 'Argilite/Kaolinite (%)' },
      { key: 'other_silicates_pct', header: 'AutresSilicates_pct', required: false, numeric: true, description: 'Autres silicates (%)' },
      { key: 'muscovite_pct',       header: 'Muscovite_pct',   required: false, numeric: true,  description: 'Muscovite/Illite (%)' },
      { key: 'ca_minerals_pct',     header: 'CaMineraux_pct',  required: false, numeric: true,  description: 'Minéraux Ca-O (%)' },
      { key: 'fe_oxides_pct',       header: 'FeOxydes_pct',    required: false, numeric: true,  description: 'Oxydes/Hydroxydes de Fe (%)' },
      { key: 'ilmenite_pct',        header: 'Ilmenite_pct',    required: false, numeric: true,  description: 'Ilménite (%)' },
      { key: 'ti_oxides_pct',       header: 'TiOxydes_pct',    required: false, numeric: true,  description: 'Oxydes de Ti (%)' },
      { key: 'other_oxides_pct',    header: 'AutresOxydes_pct',required: false, numeric: true,  description: 'Autres oxydes (%)' },
      { key: 'carbonates_pct',      header: 'Carbonates_pct',  required: false, numeric: true,  description: 'Carbonates (%)' },
      { key: 'apatite_pct',         header: 'Apatite_pct',     required: false, numeric: true,  description: 'Apatite (%)' },
      { key: 'other_pct',           header: 'Autre_pct',       required: false, numeric: true,  description: 'Autre (%)' },
      { key: 'au_free_pct',         header: 'Au_libre_pct',    required: false, numeric: true,  description: 'Au Free Gold (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '150', '8.5', '1.2', '0.3', '45.2', '12.0', '6.5', '3.2', '8.1', '5.5', '2.1', '2.8', '0.5', '0.3', '0.8', '1.2', '0.4', '1.4', '72.0'],
    ],
  },

  // ── 3. Libération Au ──────────────────────────────────────────────────
  {
    code: 'liberation',
    label: 'Libération Au — Gold Liberation Analysis (MLA)',
    color: '#F59E0B',
    table: 'lims_test_liberation',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',        header: 'ID_Echantillon',  required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',           header: 'Domaine',         required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'p80_um',           header: 'P80_broyage_um',  required: false, numeric: true,  description: 'P80 broyage (µm)' },
      { key: 'au_free_pct',      header: 'Au_libre_pct',    required: false, numeric: true,  description: 'Au libre (%)' },
      { key: 'au_sulphides_pct', header: 'Au_sulfures_pct', required: false, numeric: true,  description: 'Au associé sulfures (%)' },
      { key: 'au_silicates_pct', header: 'Au_silicates_pct',required: false, numeric: true,  description: 'Au associé silicates (%)' },
      { key: 'au_oxides_pct',    header: 'Au_oxydes_pct',   required: false, numeric: true,  description: 'Au associé oxydes (%)' },
      { key: 'au_occluded_pct',  header: 'Au_occlus_pct',   required: false, numeric: true,  description: 'Au occlus (%)' },
      { key: 'au_preg_rob_pct',  header: 'Au_pregrob_pct',  required: false, numeric: true,  description: 'Au preg-robbing (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '75', '72.0', '18.5', '5.2', '2.1', '2.2', '0.0'],
      ['KMG-002', 'Sulfure LG', '75', '35.0', '55.0', '6.0', '1.5', '2.5', '0.0'],
    ],
  },

  // ── 4. PSD ─────────────────────────────────────────────────────────────
  {
    code: 'psd',
    label: 'Analyse granulométrique / densimétrique (PSD + Free Gold Split)',
    color: '#56657A',
    table: 'lims_test_psd',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',           header: 'ID_Echantillon',   required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',              header: 'Domaine',          required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'p80_um',              header: 'P80_um',           required: false, numeric: true,  description: 'P80 (µm)' },
      { key: 'd50_um',              header: 'D50_um',           required: false, numeric: true,  description: 'D50 (µm)' },
      { key: 'plus_500um_pct',      header: '+500um_pct',       required: false, numeric: true,  description: 'Fraction +500µm (%)' },
      { key: 'plus_212um_pct',      header: '+212um_pct',       required: false, numeric: true,  description: 'Fraction +212µm (%)' },
      { key: 'plus_150um_pct',      header: '+150um_pct',       required: false, numeric: true,  description: 'Fraction +150µm (%)' },
      { key: 'plus_106um_pct',      header: '+106um_pct',       required: false, numeric: true,  description: 'Fraction +106µm (%)' },
      { key: 'plus_75um_pct',       header: '+75um_pct',        required: false, numeric: true,  description: 'Fraction +75µm (%)' },
      { key: 'plus_53um_pct',       header: '+53um_pct',        required: false, numeric: true,  description: 'Fraction +53µm (%)' },
      { key: 'plus_38um_pct',       header: '+38um_pct',        required: false, numeric: true,  description: 'Fraction +38µm (%)' },
      { key: 'minus_38um_pct',      header: '-38um_pct',        required: false, numeric: true,  description: 'Passant -38µm (%)' },
      { key: 'au_head_g_t',         header: 'Au_tete_g_t',      required: false, numeric: true,  description: 'Au tête (g/t)' },
      { key: 'au_plus212_g_t',      header: 'Au_plus212_g_t',   required: false, numeric: true,  description: 'Au +212µm (g/t)' },
      { key: 'au_plus75_g_t',       header: 'Au_plus75_g_t',    required: false, numeric: true,  description: 'Au +75µm (g/t)' },
      { key: 'au_minus38_g_t',      header: 'Au_moins38_g_t',   required: false, numeric: true,  description: 'Au -38µm (g/t)' },
      { key: 'dist_au_plus212_pct', header: 'Dist_Au_plus212_pct', required: false, numeric: true, description: 'Distribution Au +212µm (%)' },
      { key: 'dist_au_plus75_pct',  header: 'Dist_Au_plus75_pct',  required: false, numeric: true, description: 'Distribution Au +75µm (%)' },
      { key: 'dist_au_minus38_pct', header: 'Dist_Au_moins38_pct', required: false, numeric: true, description: 'Distribution Au -38µm (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '150', '75', '2.1', '18.5', '12.3', '15.2', '18.4', '8.5', '6.0', '19.0', '3.45', '0.12', '1.85', '8.20', '1.0', '15.5', '69.2'],
    ],
  },

  // ── 5. Comminution ────────────────────────────────────────────────────
  {
    code: 'comminution',
    label: 'Comminution (Bond + SMC/JK Drop Weight + Propriétés physiques)',
    color: '#5BA4F5',
    table: 'lims_test_comminution',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',    header: 'ID_Echantillon', required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',       header: 'Domaine',        required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'bwi_kwh_t',   header: 'BBWI_kWh_t',    required: false, numeric: true,  description: 'Bond Ball Work Index (kWh/t)' },
      { key: 'brwi_kwh_t',  header: 'BRWI_kWh_t',    required: false, numeric: true,  description: 'Bond Rod Mill Work Index (kWh/t)' },
      { key: 'cwi_kwh_t',   header: 'CWi_kWh_t',     required: false, numeric: true,  description: 'Bond Crushability Index (kWh/t)' },
      { key: 'axb_jk',      header: 'Axb_JK',         required: false, numeric: true,  description: 'A×b — JK impact parameter' },
      { key: 'ta_jk',       header: 'ta_JK',          required: false, numeric: true,  description: 'ta — JK tumble abrasion' },
      { key: 'dwi_kwh_m3',  header: 'DWi_kWh_m3',    required: false, numeric: true,  description: 'Drop Weight Index (kWh/m³)' },
      { key: 'mia_kwh_t',   header: 'Mia_kWh_t',     required: false, numeric: true,  description: 'Mia — SAG circuit specific energy (kWh/t)' },
      { key: 'mib_kwh_t',   header: 'Mib_kWh_t',     required: false, numeric: true,  description: 'Mib — Ball mill specific energy (kWh/t)' },
      { key: 'mic_kwh_t',   header: 'Mic_kWh_t',     required: false, numeric: true,  description: 'Mic — Crushing specific energy (kWh/t)' },
      { key: 'mih_kwh_t',   header: 'Mih_kWh_t',     required: false, numeric: true,  description: 'Mih — HPGR specific energy (kWh/t)' },
      { key: 'scse_kwh_t',  header: 'SCSE_kWh_t',    required: false, numeric: true,  description: 'SAG Circuit Specific Energy (kWh/t)' },
      { key: 'ai_index',    header: 'Ai_abrasion',    required: false, numeric: true,  description: 'Ai — Bond Abrasion Index' },
      { key: 'ucs_mpa',     header: 'UCS_MPa',        required: false, numeric: true,  description: 'Unconfined Compressive Strength (MPa)' },
      { key: 'f80_um',      header: 'F80_um',         required: false, numeric: true,  description: 'F80 — Feed size (µm)' },
      { key: 'p80_um',      header: 'P80_um',         required: false, numeric: true,  description: 'P80 — Product size (µm)' },
      { key: 'sg_t_m3',     header: 'SG_t_m3',       required: false, numeric: true,  description: 'SG — Densité réelle solide (t/m³)' },
      { key: 'rho_bulk_t_m3',header:'RhoBulk_t_m3',  required: false, numeric: true,  description: 'ρb — Densité apparente bulk (t/m³)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG',   '14.5', '12.8', '8.2', '48.5', '0.42', '4.8', '10.2', '7.5', '2.8', '5.5', '12.0', '0.25', '95',  '12000', '75', '2.75', '1.55'],
      ['KMG-002', 'Sulfure LG', '18.2', '16.5', '10.1','38.0', '0.38', '5.2', '12.5', '9.0', '3.2', '6.0', '14.5', '0.40', '125', '15000', '75', '2.82', '1.60'],
    ],
  },

  // ── 6. Knelson / Falcon ────────────────────────────────────────────────
  {
    code: 'knelson',
    label: 'Knelson / Falcon Concentrator — Gravimetric Recovery Tests',
    color: '#2ECC8A',
    table: 'lims_test_knelson',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',        header: 'ID_Echantillon',    required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',           header: 'Domaine',           required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'p80_feed_um',      header: 'P80_alim_um',       required: false, numeric: true,  description: 'P80 alimentation (µm)' },
      { key: 'solids_pct',       header: 'Solides_pct',       required: false, numeric: true,  description: '% Solides alimentation' },
      { key: 'mass_feed_kg',     header: 'Masse_alim_kg',     required: false, numeric: true,  description: 'Masse alimentation (kg)' },
      { key: 'au_feed_g_t',      header: 'Au_alim_g_t',       required: false, numeric: true,  description: 'Au alimentation (g/t)' },
      { key: 'rotation_rpm',     header: 'Rotation_RPM',      required: false, numeric: true,  description: 'Vitesse rotation Knelson (RPM)' },
      { key: 'water_psi',        header: 'Pression_eau_psi',  required: false, numeric: true,  description: 'Pression eau fluidisation (psi)' },
      { key: 'duration_min',     header: 'Duree_min',         required: false, numeric: true,  description: 'Durée concentration (min)' },
      { key: 'conc_mass_g',      header: 'Masse_conc_g',      required: false, numeric: true,  description: 'Masse concentré (g)' },
      { key: 'au_conc_g_t',      header: 'Au_conc_g_t',       required: false, numeric: true,  description: 'Au concentré (g/t)' },
      { key: 'au_tail_g_t',      header: 'Au_rejet_g_t',      required: false, numeric: true,  description: 'Au rejet tail (g/t)' },
      { key: 'grg_recovery_pct', header: 'GRG_Recup_Au_pct',  required: false, numeric: true,  description: 'GRG Récupération Au (%)' },
      { key: 'mass_pull_pct',    header: 'Mass_pull_pct',     required: false, numeric: true,  description: 'Mass pull (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '150', '30', '2.0', '3.45', '1800', '12', '30', '85.5', '485.2', '0.18', '45.2', '8.5'],
    ],
  },

  // ── 7. E-GRG ──────────────────────────────────────────────────────────
  {
    code: 'egrg',
    label: 'E-GRG — Extended Gravity Recoverable Gold (3 stades)',
    color: '#2ECC8A',
    table: 'lims_test_egrg',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',                header: 'ID_Echantillon',    required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',                   header: 'Domaine',           required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'k80_um',                   header: 'K80_um',            required: false, numeric: true,  description: 'K80 granulométrie (µm) — ex. 800, 215, 75' },
      { key: 'au_conc_grade_g_t',        header: 'Grade_Conc_Au_g_t', required: false, numeric: true,  description: 'Grade concentré Au (g/t)' },
      { key: 'recovery_pct',             header: 'Recuperation_pct',  required: false, numeric: true,  description: 'Récupération par stade (%)' },
      { key: 'cumulative_recovery_pct',  header: 'Recup_Cumul_pct',   required: false, numeric: true,  description: 'Récupération cumulative (%)' },
      { key: 'recalc_grade_g_t',         header: 'Grade_Recalc_g_t',  required: false, numeric: true,  description: 'Grade recalculé Au (g/t)' },
      { key: 'measured_grade_g_t',       header: 'Grade_Mesure_g_t',  required: false, numeric: true,  description: 'Grade mesuré Au (g/t)' },
      { key: 'residue_grade_g_t',        header: 'Grade_Residu_g_t',  required: false, numeric: true,  description: 'Grade résidu Au (g/t)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '800', '285.0', '22.5', '22.5', '3.42', '3.45', '2.68'],
      ['KMG-001', 'Oxyde HG', '215', '125.0', '28.5', '51.0', '3.40', '3.43', '1.70'],
      ['KMG-001', 'Oxyde HG', '75',  '68.0',  '18.0', '69.0', '3.38', '3.42', '1.07'],
    ],
  },

  // ── 8. Flottation ─────────────────────────────────────────────────────
  {
    code: 'flotation',
    label: 'Flottation (Batch Flotation Kinetics — Rougher/Scavenger/Cleaner)',
    color: '#F88A44',
    table: 'lims_test_flotation',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',       header: 'ID_Echantillon',  required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',          header: 'Domaine',         required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'au_feed_g_t',     header: 'Au_alim_g_t',     required: false, numeric: true,  description: 'Au alimentation (g/t)' },
      { key: 'feed_p80_um',     header: 'P80_alim_um',     required: false, numeric: true,  description: 'P80 alimentation (µm)' },
      { key: 'conc_wt_pct',     header: 'Conc_Wt_pct',    required: false, numeric: true,  description: 'Concentrate Wt (%)' },
      { key: 'au_conc_g_t',     header: 'Au_Conc_g_t',    required: false, numeric: true,  description: 'Au concentré (g/t)' },
      { key: 'au_recovery_pct', header: 'Au_Recovery_pct', required: false, numeric: true,  description: 'Récupération Au (%)' },
      { key: 'au_tail_g_t',     header: 'Au_Tail_g_t',    required: false, numeric: true,  description: 'Au queue (g/t)' },
      { key: 'total_time_min',  header: 'Temps_total_min', required: false, numeric: true,  description: 'Temps total flottation (min)' },
      { key: 'collector_g_t',   header: 'Collecteur_g_t',  required: false, numeric: true,  description: 'Collecteur (g/t)' },
      { key: 'frother_g_t',     header: 'Moussant_g_t',   required: false, numeric: true,  description: 'Moussant (g/t)' },
      { key: 'depressant_g_t',  header: 'Depressant_g_t', required: false, numeric: true,  description: 'Dépressant (g/t)' },
      { key: 's_recovery_pct',  header: 'Recup_S_pct',    required: false, numeric: true,  description: 'Récupération S (%)' },
    ],
    exampleRows: [
      ['KMG-001', 'Sulfure LG', '3.45', '106', '4.5', '52.8', '88.5', '0.30', '30', '40', '25', '0', '92.0'],
    ],
  },

  // ── 9. Épaississement ─────────────────────────────────────────────────
  {
    code: 'thickening',
    label: 'Épaississement (Séparation Liquide-Solide)',
    color: '#56657A',
    table: 'lims_test_thickening',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',              header: 'ID_Echantillon',     required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',                 header: 'Domaine',            required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'unit_area_m2_t_d',       header: 'Aire_unit_m2_t_j',  required: false, numeric: true,  description: 'Aire unitaire (m²/t/j)' },
      { key: 'flocculant_g_t',         header: 'Floculant_g_t',     required: false, numeric: true,  description: 'Dosage floculant (g/t)' },
      { key: 'underflow_density_pct',  header: 'Dens_SV_pct',       required: false, numeric: true,  description: 'Densité sous-verse (% sol.)' },
      { key: 'isr_m_h',               header: 'ISR_m_h',           required: false, numeric: true,  description: 'ISR vitesse initiale (m/h)' },
      { key: 'fsr_m_h',               header: 'FSR_m_h',           required: false, numeric: true,  description: 'FSR vitesse finale (m/h)' },
      { key: 'uf_density_pct',         header: 'Dens_UF_pct',       required: false, numeric: true,  description: 'Densité UF (% sol.)' },
      { key: 'uf_density_t_m3',        header: 'Dens_UF_t_m3',      required: false, numeric: true,  description: 'Densité UF (t/m³)' },
      { key: 'overflow_turbidity_ntu', header: 'Turbidite_NTU',     required: false, numeric: true,  description: 'Turbidité overflow (NTU)' },
      { key: 'mass_flux_t_m2_d',       header: 'Flux_t_m2_j',       required: false, numeric: true,  description: 'Flux massique (t/m²/j)' },
      { key: 'cn_overflow_ppm',        header: 'CN_overflow_ppm',   required: false, numeric: true,  description: 'CN overflow (ppm)' },
      { key: 'au_overflow_ppb',        header: 'Au_overflow_ppb',   required: false, numeric: true,  description: 'Au overflow (ppb)' },
      { key: 'uf_viscosity_mpas',      header: 'Viscosite_UF_mPas', required: false, numeric: true,  description: 'Viscosité UF (mPa·s)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '0.25', '15', '68', '8.5', '0.8', '72', '1.65', '5', '1.8', '4.5', '12', '350'],
    ],
  },

  // ── 10. Élution ADR ───────────────────────────────────────────────────
  {
    code: 'elution',
    label: 'Élution ADR (AARL / Zadra — Stripping & Carbon Reactivation)',
    color: '#F06B6B',
    table: 'lims_test_elution',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',           header: 'ID_Echantillon',   required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',              header: 'Domaine',          required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'test_type',           header: 'Type_test',        required: false, numeric: false, description: 'AARL | Zadra', validValues: ['AARL', 'Zadra'] },
      { key: 'carbon_type',         header: 'Charbon_type',     required: false, numeric: false, description: 'Type/lot de charbon actif' },
      { key: 'carbon_load_g_l',     header: 'Charge_charbon_g_L', required: false, numeric: true, description: 'Charge charbon (g/L)' },
      { key: 'au_solution_ini_mg_l',header: 'Au_sol_ini_mg_L',  required: false, numeric: true, description: 'Au solution initiale (mg/L)' },
      { key: 'au_solution_fin_mg_l',header: 'Au_sol_fin_mg_L',  required: false, numeric: true, description: 'Au solution finale (mg/L)' },
      { key: 'kinetics_freundlich', header: 'Cin_Freundlich',   required: false, numeric: true, description: 'Cinétique adsorption (Freundlich K)' },
      { key: 'elution_temp_c',      header: 'Temp_elution_C',   required: false, numeric: true, description: 'Température élution (°C)' },
      { key: 'eluant_cn_g_l',       header: 'Eluant_CN_g_L',   required: false, numeric: true, description: 'CN dans éluant (g/L)' },
      { key: 'eluant_naoh_g_l',     header: 'Eluant_NaOH_g_L', required: false, numeric: true, description: 'NaOH dans éluant (g/L)' },
      { key: 'flow_rate_bv_h',      header: 'Debit_BV_h',      required: false, numeric: true, description: 'Débit (volumes de lit/h)' },
      { key: 'elution_time_h',      header: 'Temps_elution_h', required: false, numeric: true, description: 'Temps élution (h)' },
      { key: 'au_eluted_mg_l',      header: 'Au_elue_mg_L',    required: false, numeric: true, description: 'Au élué (mg/L)' },
      { key: 'au_recovery_pct',     header: 'Recup_Au_pct',    required: false, numeric: true, description: 'Récupération Au élution (%)' },
      { key: 'carbon_fines_pct',    header: 'Fines_charbon_pct',required: false, numeric: true, description: 'Fines charbon (%)' },
      { key: 'observations',        header: 'Observations',     required: false, numeric: false, description: 'Observations libres' },
    ],
    exampleRows: [
      ['KMG-001', 'Sulfure LG', 'AARL', 'Norit GCN1240', '10', '8.5', '0.12', '0.025', '110', '2.5', '5', '3', '6', '8.2', '98.5', '1.2', 'Standard AARL 6h'],
    ],
  },

  // ── 11. Lixiviation au cyanure ────────────────────────────────────────────
  {
    code: 'leaching',
    label: 'Lixiviation au cyanure (CIL/CIP/Heap Leach — Cinétique & Consommation)',
    color: '#10B981',
    table: 'lims_test_leaching',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',               header: 'ID_Echantillon',         required: true,  numeric: false, description: 'ID existant dans la table Échantillons' },
      { key: 'domain',                  header: 'Domaine',                required: false, numeric: false, description: 'Domaine géologique (informatif)', dbSkip: true },
      { key: 'composite_type',          header: 'Type_Composite',         required: false, numeric: false, description: 'Composite | Variabilité | Head' },
      { key: 'au_feed_g_t',             header: 'Au_Leach_Feed_g_t',      required: false, numeric: true,  description: 'Au alimentation lixiviation (g/t)' },
      { key: 'p80_um',                  header: 'P80_alim_um',            required: false, numeric: true,  description: 'P80 alimentation (µm)' },
      { key: 'solids_pct',              header: 'Solides_pulpe_pct',      required: false, numeric: true,  description: '% Solides pulpe' },
      { key: 'nacn_initial_ppm',        header: 'NaCN_initiale_ppm',      required: false, numeric: true,  description: '[NaCN] initiale (ppm)' },
      { key: 'nacn_residual_24h_ppm',   header: 'ICN_residuelle_24h_ppm', required: false, numeric: true,  description: 'ICN résiduelle 24h (ppm)' },
      { key: 'nacn_consumption_kg_t',   header: 'Cons_NaCN_kg_t',        required: false, numeric: true,  description: 'Consommation NaCN (kg/t)' },
      { key: 'ph_initial',              header: 'pH_initial',             required: false, numeric: true,  description: 'pH initial' },
      { key: 'ph_final',                header: 'pH_final',               required: false, numeric: true,  description: 'pH final' },
      { key: 'cao_consumption_kg_t',    header: 'Cons_CaO_kg_t',         required: false, numeric: true,  description: 'Consommation CaO (kg/t)' },
      { key: 'o2_dissolved_mg_l',       header: 'O2_dissous_mg_L',       required: false, numeric: true,  description: 'O₂ dissous (mg/L)' },
      { key: 'o2_consumption_kg_t',     header: 'Cons_O2_kg_t',          required: false, numeric: true,  description: 'Consommation O₂ (kg/t)' },
      { key: 'temperature_c',           header: 'Temperature_C',          required: false, numeric: true,  description: 'Température (°C)' },
      { key: 'leach_duration_h',        header: 'Duree_lixiviation_h',   required: false, numeric: true,  description: 'Durée lixiviation (h)' },
      { key: 'carbon_load_g_l',         header: 'Carbon_actif_leach_g_L', required: false, numeric: true,  description: 'Charge carbone actif leach (g/L)' },
      { key: 'sg_t_m3',                 header: 'Densite_SG_t_m3',       required: false, numeric: true,  description: 'Densité solide SG (t/m³)' },
      { key: 'leach_rec_2h_pct',        header: 'Leach_Rec_2h_pct',      required: false, numeric: true,  description: 'Récupération 2h (%)' },
      { key: 'leach_rec_4h_pct',        header: 'Leach_Rec_4h_pct',      required: false, numeric: true,  description: 'Récupération 4h (%)' },
      { key: 'leach_rec_8h_pct',        header: 'Leach_Rec_8h_pct',      required: false, numeric: true,  description: 'Récupération 8h (%)' },
      { key: 'leach_rec_12h_pct',       header: 'Leach_Rec_12h_pct',     required: false, numeric: true,  description: 'Récupération 12h (%)' },
      { key: 'leach_rec_24h_pct',       header: 'Leach_Rec_24h_pct',     required: false, numeric: true,  description: 'Récupération 24h (%)' },
      { key: 'leach_rec_48h_pct',       header: 'Leach_Rec_48h_pct',     required: false, numeric: true,  description: 'Récupération 48h (%)' },
      { key: 'au_tail_g_t',             header: 'Au_Final_tail_g_t',     required: false, numeric: true,  description: 'Au résidu final tail (g/t)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG',   'Composite',    '3.45', '75',  '40', '500', '45',  '0.82', '10.2', '10.8', '0.45', '6.5', '0.65', '20', '48', '15', '2.75', '65.0', '75.0', '82.5', '86.0', '88.5', '91.2', '0.30'],
      ['KMG-002', 'Sulfure LG', 'Variabilité',  '1.20', '75',  '40', '600', '85',  '1.20', '10.5', '11.0', '0.60', '5.8', '0.80', '20', '48', '12', '2.82', '45.0', '58.0', '68.5', '72.0', '75.5', '78.0', '0.28'],
    ],
  },

  // ── 12. Détoxification CN ─────────────────────────────────────────────
  {
    code: 'cyanide_detox',
    label: 'Détoxification Cyanure (SO₂/Air · H₂O₂ · AVR · SART)',
    color: '#14B8A6',
    table: 'lims_test_cyanide_detox',
    needsSampleLookup: true,
    columns: [
      { key: 'sample_id',               header: 'ID_Echantillon',       required: true,  numeric: false, description: 'ID existant' },
      { key: 'domain',                  header: 'Domaine',              required: false, numeric: false, description: 'Informatif', dbSkip: true },
      { key: 'cn_wad_mg_l',             header: 'CN_WAD_mg_L',          required: false, numeric: true,  description: 'CN WAD initial (mg/L)' },
      { key: 'cn_total_mg_l',           header: 'CN_total_mg_L',        required: false, numeric: true,  description: 'CN total (mg/L)' },
      { key: 'cn_free_mg_l',            header: 'CN_libre_mg_L',        required: false, numeric: true,  description: 'CN libre (mg/L)' },
      { key: 'scn_mg_l',               header: 'SCN_mg_L',             required: false, numeric: true,  description: 'SCN⁻ (mg/L)' },
      { key: 'ph_final',               header: 'pH_final',             required: false, numeric: true,  description: 'pH final traitement' },
      { key: 'cu_mg_l',               header: 'Cu_mg_L',              required: false, numeric: true,  description: 'Cu dissous (mg/L)' },
      { key: 'fe_mg_l',               header: 'Fe_mg_L',              required: false, numeric: true,  description: 'Fe dissous (mg/L)' },
      { key: 'ni_mg_l',               header: 'Ni_mg_L',              required: false, numeric: true,  description: 'Ni dissous (mg/L)' },
      { key: 'zn_mg_l',               header: 'Zn_mg_L',              required: false, numeric: true,  description: 'Zn dissous (mg/L)' },
      { key: 'as_mg_l',               header: 'As_mg_L',              required: false, numeric: true,  description: 'As dissous (mg/L)' },
      { key: 'hg_ug_l',               header: 'Hg_ug_L',              required: false, numeric: true,  description: 'Hg dissous (µg/L)' },
      { key: 'pb_mg_l',               header: 'Pb_mg_L',              required: false, numeric: true,  description: 'Pb dissous (mg/L)' },
      { key: 'so2_kg_t',              header: 'SO2_kg_t',             required: false, numeric: true,  description: 'Consommation SO₂ (kg/t)' },
      { key: 'h2o2_kg_t',             header: 'H2O2_kg_t',            required: false, numeric: true,  description: 'Consommation H₂O₂ (kg/t)' },
      { key: 'cuso4_kg_t',            header: 'CuSO4_kg_t',           required: false, numeric: true,  description: 'Consommation CuSO₄ (kg/t)' },
      { key: 'cao_kg_t',              header: 'CaO_kg_t',             required: false, numeric: true,  description: 'Consommation CaO (kg/t)' },
      { key: 'treatment_duration_min',header: 'Duree_traitement_min', required: false, numeric: true,  description: 'Durée traitement (min)' },
      { key: 'cn_wad_rebound_24h_mg_l',header: 'CN_WAD_rebound_24h', required: false, numeric: true,  description: 'CN WAD rebound 24h (mg/L)' },
      { key: 'cn_wad_rebound_7j_mg_l', header: 'CN_WAD_rebound_7j',  required: false, numeric: true,  description: 'CN WAD rebound 7j (mg/L)' },
    ],
    exampleRows: [
      ['KMG-001', 'Oxyde HG', '150', '210', '80', '45', '9.5', '12', '8', '0.5', '3.2', '0.8', '0.5', '0.2', '2.8', '1.5', '0.3', '0.8', '120', '3.2', '4.1'],
    ],
  },
];

// ─── XLSX Template Generation ─────────────────────────────────────────────────

export function downloadXlsxTemplate(templateCode: string) {
  const tmpl = LIMS_TEMPLATES.find(t => t.code === templateCode);
  if (!tmpl) return;

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Données ──
  const headers = tmpl.columns.map(c => c.header);
  const wsDonnees = XLSX.utils.aoa_to_sheet([headers, ...tmpl.exampleRows]);
  wsDonnees['!cols'] = tmpl.columns.map(col => ({
    wch: Math.max(col.header.length + 4, 18),
  }));
  wsDonnees['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsDonnees, 'Données');

  // ── Sheet 2: Guide ──
  const guideRows: string[][] = [
    ['Colonne', 'Description', 'Obligatoire', 'Type / Valeurs acceptées', 'Importé en BD'],
    ...tmpl.columns.map(c => [
      c.header,
      c.description,
      c.required ? 'OUI ✱' : 'Optionnel',
      c.validValues
        ? c.validValues.join(' | ')
        : c.numeric ? 'Nombre décimal (ex. 14.5)' : 'Texte libre',
      c.dbSkip ? 'Non (informatif)' : 'Oui',
    ]),
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 30 }, { wch: 50 }, { wch: 12 }, { wch: 35 }, { wch: 18 }];
  wsGuide['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide');

  XLSX.writeFile(wb, `gabarit_lims_${templateCode}.xlsx`);
}

// ─── XLSX Parsing ─────────────────────────────────────────────────────────────

export interface ImportRow {
  lineNumber: number;
  rawSampleId: string;
  display: Record<string, string>;
  errors: string[];
  warnings: string[];
  dbRow: Record<string, unknown> | null;
}

export interface ImportParseResult {
  template: LimsTemplate;
  rows: ImportRow[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  unknownSamples: string[];
}

export function parseLimsXlsx(
  arrayBuffer: ArrayBuffer,
  templateCode: string,
  knownSamples: Array<{ id: string; sample_id: string }>,
  projectId: string,
): ImportParseResult {
  const tmpl = LIMS_TEMPLATES.find(t => t.code === templateCode)!;
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
    header: 1, defval: '', blankrows: false,
  });

  if (rawData.length < 2) {
    return { template: tmpl, rows: [], totalRows: 0, validRows: 0, errorRows: 0, unknownSamples: [] };
  }

  const headerRow = (rawData[0] as (string | number | null)[]).map(h => String(h ?? '').trim());
  const colIndex: Record<string, number> = {};
  for (const col of tmpl.columns) {
    const idx = headerRow.findIndex(h => h.toLowerCase() === col.header.toLowerCase());
    colIndex[col.key] = idx;
  }

  const rows: ImportRow[] = [];
  const unknownSet = new Set<string>();

  // For a sample import, sample_id must be unique per project (enforced in DB by
  // lims_samples_project_sample_unique). Detect in-file duplicates up front so a
  // clear per-line error is shown instead of the whole batch failing on a 23505.
  const sampleIdCounts = new Map<string, number>();
  if (tmpl.table === 'lims_samples' && colIndex['sample_id'] >= 0) {
    const idx = colIndex['sample_id'];
    for (let i = 1; i < rawData.length; i++) {
      const v = String((rawData[i] as (string | number | boolean | null)[])[idx] ?? '').trim();
      if (v) sampleIdCounts.set(v, (sampleIdCounts.get(v) ?? 0) + 1);
    }
  }

  for (let i = 1; i < rawData.length; i++) {
    const rowData = rawData[i] as (string | number | boolean | null)[];
    const display: Record<string, string> = {};
    for (const col of tmpl.columns) {
      const idx = colIndex[col.key];
      display[col.key] = String(idx >= 0 ? (rowData[idx] ?? '') : '').trim();
    }
    if (Object.values(display).every(v => !v)) continue;

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const col of tmpl.columns) {
      if (col.required && !display[col.key]) errors.push(`"${col.header}" est obligatoire`);
    }
    for (const col of tmpl.columns) {
      if (col.validValues && display[col.key] && !col.validValues.includes(display[col.key])) {
        errors.push(`"${col.header}": valeur "${display[col.key]}" invalide`);
      }
    }
    for (const col of tmpl.columns) {
      if (col.numeric && display[col.key]) {
        if (isNaN(parseFloat(String(display[col.key]).replace(',', '.')))) {
          warnings.push(`"${col.header}": valeur non numérique`);
        }
      }
    }

    const rawSampleId = display['sample_id'] ?? '';
    let sampleUuid: string | undefined;

    if (tmpl.table === 'lims_samples' && rawSampleId && (sampleIdCounts.get(rawSampleId) ?? 0) > 1) {
      errors.push(`"ID_Echantillon" "${rawSampleId}" en double dans le fichier (doit être unique par projet)`);
    }

    if (tmpl.needsSampleLookup) {
      if (!rawSampleId) {
        errors.push('"ID_Echantillon" est obligatoire');
      } else {
        const match = knownSamples.find(s => s.sample_id === rawSampleId);
        if (match) { sampleUuid = match.id; }
        else { errors.push(`Échantillon "${rawSampleId}" introuvable`); unknownSet.add(rawSampleId); }
      }
    }

    let dbRow: Record<string, unknown> | null = null;
    if (errors.length === 0) {
      dbRow = { project_id: projectId };
      if (tmpl.table === 'lims_samples') {
        dbRow.sample_id = rawSampleId;
        dbRow.status = display['status'] || 'pending';
        if (display['campaign'])   dbRow.campaign   = display['campaign'];
        if (display['domain'])     dbRow.domain     = display['domain'];
        if (display['ore_type'])   dbRow.ore_type   = display['ore_type'];
        if (display['zone'])       dbRow.zone       = display['zone'];
        if (display['notes'])      dbRow.notes      = display['notes'];
        if (display['hole_id'])    dbRow.hole_id    = display['hole_id'];
        if (display['drill_type']) dbRow.drill_type = display['drill_type'];
        const numFields: Array<[string, string]> = [
          ['x_coord', 'x_coord'], ['y_coord', 'y_coord'], ['elevation', 'elevation'],
          ['depth_from', 'depth_from'], ['depth_to', 'depth_to'],
          ['dip_deg', 'dip_deg'], ['azimuth_deg', 'azimuth_deg'], ['length_m', 'length_m'],
        ];
        for (const [dispKey, dbKey] of numFields) {
          if (display[dispKey]) {
            const n = parseFloat(String(display[dispKey]).replace(',', '.'));
            if (!isNaN(n)) dbRow[dbKey] = n;
          }
        }
        dbRow.test_type = 'A1';
      } else {
        dbRow.sample_id = sampleUuid!;
        for (const col of tmpl.columns) {
          if (col.key === 'sample_id' || col.dbSkip) continue;
          const val = display[col.key];
          if (!val) continue;
          if (col.numeric) {
            const n = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(n)) dbRow[col.key] = n;
          } else {
            dbRow[col.key] = val;
          }
        }
      }
    }
    rows.push({ lineNumber: i + 1, rawSampleId, display, errors, warnings, dbRow });
  }

  return {
    template: tmpl,
    rows,
    totalRows: rows.length,
    validRows:  rows.filter(r => r.dbRow !== null).length,
    errorRows:  rows.filter(r => r.errors.length > 0).length,
    unknownSamples: [...unknownSet],
  };
}
