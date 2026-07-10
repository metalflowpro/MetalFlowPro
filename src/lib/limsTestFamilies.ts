// Definitions for all 11 LIMS test families.
// Each family drives: table name, display columns, quick-entry fields.

export interface DisplayCol {
  key: string;
  label: string;
  unit?: string;
  color?: string;
}

export interface QuickField {
  key: string;
  label: string;
  placeholder?: string;
  numeric?: boolean;
  select?: string[]; // for select inputs
}

export interface TestFamilyDef {
  code: string;
  label: string;
  shortLabel: string;
  group: string;
  color: string;
  table: string;
  displayCols: DisplayCol[];      // columns shown in the families tab table
  quickFields: QuickField[];      // fields in the "quick add" modal
}

export const ALL_FAMILIES: TestFamilyDef[] = [
  // ── 1. Analyse chimique ──────────────────────────────────────────────────
  {
    code: 'chem',
    label: 'Analyse chimique élémentaire (Fire Assay / ICP-MS / XRF / LECO)',
    shortLabel: 'Chim. élémentaire',
    group: 'Géochimie',
    color: '#F59E0B',
    table: 'lims_test_chem',
    displayCols: [
      { key: 'au_g_t',       label: 'Au',     unit: 'g/t',  color: '#F59E0B' },
      { key: 'ag_g_t',       label: 'Ag',     unit: 'g/t' },
      { key: 'cu_pct',       label: 'Cu',     unit: '%' },
      { key: 'fe_pct',       label: 'Fe',     unit: '%' },
      { key: 's_total_pct',  label: 'S tot.', unit: '%' },
      { key: 's_sulfide_pct',label: 'S sulf.',unit: '%' },
      { key: 'as_ppm',       label: 'As',     unit: 'ppm' },
      { key: 'loi_950_pct',  label: 'LOI',    unit: '%' },
    ],
    quickFields: [
      { key: 'au_g_t',       label: 'Au (g/t)',       placeholder: 'ex. 3.45', numeric: true },
      { key: 'ag_g_t',       label: 'Ag (g/t)',       placeholder: 'ex. 1.20', numeric: true },
      { key: 's_total_pct',  label: 'S total (%)',    placeholder: 'ex. 2.1',  numeric: true },
      { key: 's_sulfide_pct',label: 'S sulfure (%)',  placeholder: 'ex. 1.8',  numeric: true },
      { key: 'as_ppm',       label: 'As (ppm)',       placeholder: 'ex. 150',  numeric: true },
      { key: 'fe_pct',       label: 'Fe (%)',         placeholder: 'ex. 15.2', numeric: true },
    ],
  },

  // ── 2. Minéralogie quantitative ──────────────────────────────────────────
  {
    code: 'mineralogy',
    label: 'Minéralogie quantitative (QEMSCAN / MLA)',
    shortLabel: 'Minéralogie',
    group: 'Minéralogie',
    color: '#9D78F0',
    table: 'lims_test_mineralogy',
    displayCols: [
      { key: 'k80_um',            label: 'K80',    unit: 'µm' },
      { key: 'pyrite_pct',        label: 'Pyrite', unit: '%', color: '#9D78F0' },
      { key: 'pyrrhotite_pct',    label: 'Pyrrhotite', unit: '%' },
      { key: 'quartz_pct',        label: 'Quartz', unit: '%' },
      { key: 'fe_oxides_pct',     label: 'Oxy. Fe',unit: '%' },
      { key: 'carbonates_pct',    label: 'Carbo.', unit: '%' },
      { key: 'au_free_pct',       label: 'Au libre',unit: '%', color: '#F59E0B' },
    ],
    quickFields: [
      { key: 'k80_um',         label: 'K80 (µm)',     placeholder: 'ex. 150', numeric: true },
      { key: 'pyrite_pct',     label: 'Pyrite (%)',   placeholder: 'ex. 8.5', numeric: true },
      { key: 'quartz_pct',     label: 'Quartz (%)',   placeholder: 'ex. 45',  numeric: true },
      { key: 'au_free_pct',    label: 'Au libre (%)', placeholder: 'ex. 65',  numeric: true },
    ],
  },

  // ── 3. Libération Au ─────────────────────────────────────────────────────
  {
    code: 'liberation',
    label: 'Libération Au — Gold Liberation Analysis (MLA)',
    shortLabel: 'Libération Au',
    group: 'Minéralogie',
    color: '#F59E0B',
    table: 'lims_test_liberation',
    displayCols: [
      { key: 'p80_um',           label: 'P80',         unit: 'µm' },
      { key: 'au_free_pct',      label: 'Au libre',    unit: '%', color: '#F59E0B' },
      { key: 'au_sulphides_pct', label: 'Au/sulf.',    unit: '%' },
      { key: 'au_silicates_pct', label: 'Au/silic.',   unit: '%' },
      { key: 'au_occluded_pct',  label: 'Au occlus',   unit: '%' },
      { key: 'au_preg_rob_pct',  label: 'Au preg-rob.',unit: '%' },
    ],
    quickFields: [
      { key: 'p80_um',           label: 'P80 broyage (µm)',    placeholder: 'ex. 75',  numeric: true },
      { key: 'au_free_pct',      label: 'Au libre (%)',        placeholder: 'ex. 72',  numeric: true },
      { key: 'au_sulphides_pct', label: 'Au assoc. sulfures (%)', placeholder: 'ex. 20', numeric: true },
      { key: 'au_occluded_pct',  label: 'Au occlus (%)',       placeholder: 'ex. 5',   numeric: true },
    ],
  },

  // ── 4. PSD Granulométrique ───────────────────────────────────────────────
  {
    code: 'psd',
    label: 'Analyse granulométrique / densimétrique (PSD + Free Gold Split)',
    shortLabel: 'Granu. / PSD',
    group: 'Granulométrie',
    color: '#56657A',
    table: 'lims_test_psd',
    displayCols: [
      { key: 'p80_um',              label: 'P80',      unit: 'µm' },
      { key: 'd50_um',              label: 'D50',      unit: 'µm' },
      { key: 'minus_38um_pct',      label: '-38µm',    unit: '%' },
      { key: 'au_head_g_t',         label: 'Au tête',  unit: 'g/t', color: '#F59E0B' },
      { key: 'dist_au_minus38_pct', label: 'Dist.Au -38µm', unit: '%', color: '#F59E0B' },
    ],
    quickFields: [
      { key: 'p80_um',         label: 'P80 (µm)',       placeholder: 'ex. 150', numeric: true },
      { key: 'd50_um',         label: 'D50 (µm)',       placeholder: 'ex. 75',  numeric: true },
      { key: 'minus_38um_pct', label: '-38µm (%)',      placeholder: 'ex. 35',  numeric: true },
      { key: 'au_head_g_t',    label: 'Au tête (g/t)', placeholder: 'ex. 3.2', numeric: true },
    ],
  },

  // ── 5. Comminution ───────────────────────────────────────────────────────
  {
    code: 'comminution',
    label: 'Comminution (Bond + SMC/JK Drop Weight + Propriétés physiques)',
    shortLabel: 'Comminution',
    group: 'Comminution',
    color: '#5BA4F5',
    table: 'lims_test_comminution',
    displayCols: [
      { key: 'bwi_kwh_t',  label: 'BBWI',  unit: 'kWh/t', color: '#5BA4F5' },
      { key: 'brwi_kwh_t', label: 'BRWI',  unit: 'kWh/t' },
      { key: 'axb_jk',     label: 'A×b',   unit: '' },
      { key: 'ta_jk',      label: 'ta',    unit: '' },
      { key: 'dwi_kwh_m3', label: 'DWi',   unit: 'kWh/m³' },
      { key: 'sg_t_m3',    label: 'SG',    unit: 't/m³' },
      { key: 'ucs_mpa',    label: 'UCS',   unit: 'MPa' },
    ],
    quickFields: [
      { key: 'bwi_kwh_t',  label: 'BBWI — Bond Ball WI (kWh/t)', placeholder: 'ex. 14.5', numeric: true },
      { key: 'brwi_kwh_t', label: 'BRWI — Bond Rod WI (kWh/t)',  placeholder: 'ex. 12.8', numeric: true },
      { key: 'axb_jk',     label: 'A×b — JK impact param.',      placeholder: 'ex. 48.5', numeric: true },
      { key: 'sg_t_m3',    label: 'SG — Densité réelle (t/m³)',  placeholder: 'ex. 2.75', numeric: true },
      { key: 'ucs_mpa',    label: 'UCS (MPa)',                   placeholder: 'ex. 95',   numeric: true },
    ],
  },

  // ── 6. Knelson / Falcon ──────────────────────────────────────────────────
  {
    code: 'knelson',
    label: 'Knelson / Falcon Concentrator — Gravimetric Recovery Tests',
    shortLabel: 'GRG Knelson/Falcon',
    group: 'Gravimétrie',
    color: '#2ECC8A',
    table: 'lims_test_knelson',
    displayCols: [
      { key: 'p80_feed_um',    label: 'P80 alim.', unit: 'µm' },
      { key: 'au_feed_g_t',    label: 'Au alim.',  unit: 'g/t', color: '#F59E0B' },
      { key: 'au_conc_g_t',    label: 'Au conc.',  unit: 'g/t' },
      { key: 'grg_recovery_pct',label: 'GRG Récup.', unit: '%', color: '#2ECC8A' },
      { key: 'mass_pull_pct',  label: 'Mass pull', unit: '%' },
    ],
    quickFields: [
      { key: 'p80_feed_um',     label: 'P80 alimentation (µm)',  placeholder: 'ex. 150', numeric: true },
      { key: 'au_feed_g_t',     label: 'Au alimentation (g/t)',  placeholder: 'ex. 3.5', numeric: true },
      { key: 'grg_recovery_pct',label: 'GRG Récupération Au (%)',placeholder: 'ex. 45',  numeric: true },
      { key: 'mass_pull_pct',   label: 'Mass pull (%)',          placeholder: 'ex. 8.5', numeric: true },
    ],
  },

  // ── 7. E-GRG ─────────────────────────────────────────────────────────────
  {
    code: 'egrg',
    label: 'E-GRG — Extended Gravity Recoverable Gold (3 stades)',
    shortLabel: 'E-GRG',
    group: 'Gravimétrie',
    color: '#2ECC8A',
    table: 'lims_test_egrg',
    displayCols: [
      { key: 'k80_um',                  label: 'K80',          unit: 'µm' },
      { key: 'measured_grade_g_t',      label: 'Grade mesuré', unit: 'g/t', color: '#F59E0B' },
      { key: 'recovery_pct',            label: 'Récupération', unit: '%', color: '#2ECC8A' },
      { key: 'cumulative_recovery_pct', label: 'Récup. cum.',  unit: '%' },
      { key: 'residue_grade_g_t',       label: 'Grade résidu', unit: 'g/t' },
    ],
    quickFields: [
      { key: 'k80_um',                  label: 'K80 (µm)',           placeholder: 'ex. 800', numeric: true },
      { key: 'recovery_pct',            label: 'Récupération (%)',   placeholder: 'ex. 25',  numeric: true },
      { key: 'cumulative_recovery_pct', label: 'Récup. cumulative (%)', placeholder: 'ex. 60', numeric: true },
      { key: 'measured_grade_g_t',      label: 'Grade mesuré (g/t)', placeholder: 'ex. 3.4', numeric: true },
    ],
  },

  // ── 8. Flottation ────────────────────────────────────────────────────────
  {
    code: 'flotation',
    label: 'Flottation (Batch Flotation Kinetics — Rougher/Scavenger/Cleaner)',
    shortLabel: 'Flottation',
    group: 'Flottation',
    color: '#F88A44',
    table: 'lims_test_flotation',
    displayCols: [
      { key: 'au_feed_g_t',     label: 'Au alim.', unit: 'g/t', color: '#F59E0B' },
      { key: 'feed_p80_um',     label: 'P80',      unit: 'µm' },
      { key: 'au_conc_g_t',     label: 'Au conc.', unit: 'g/t' },
      { key: 'au_recovery_pct', label: 'Récup. Au',unit: '%', color: '#F88A44' },
      { key: 'conc_wt_pct',     label: 'Conc. %',  unit: '%' },
      { key: 's_recovery_pct',  label: 'Récup. S', unit: '%' },
    ],
    quickFields: [
      { key: 'au_feed_g_t',     label: 'Au alimentation (g/t)',  placeholder: 'ex. 3.5', numeric: true },
      { key: 'feed_p80_um',     label: 'P80 alimentation (µm)', placeholder: 'ex. 106', numeric: true },
      { key: 'au_recovery_pct', label: 'Récup. Au (%)',          placeholder: 'ex. 88',  numeric: true },
      { key: 'conc_wt_pct',     label: 'Conc. Wt (%)',          placeholder: 'ex. 4.5', numeric: true },
    ],
  },

  // ── 9. Épaississement ────────────────────────────────────────────────────
  {
    code: 'thickening',
    label: 'Épaississement (Séparation Liquide-Solide)',
    shortLabel: 'Épaississement',
    group: 'Densité',
    color: '#56657A',
    table: 'lims_test_thickening',
    displayCols: [
      { key: 'unit_area_m2_t_d',       label: 'Aire unit.', unit: 'm²/t/j' },
      { key: 'flocculant_g_t',         label: 'Floc.',      unit: 'g/t' },
      { key: 'uf_density_pct',         label: 'Dens. UF',   unit: '%sol' },
      { key: 'overflow_turbidity_ntu', label: 'Turbidité',  unit: 'NTU' },
      { key: 'cn_overflow_ppm',        label: 'CN OF',      unit: 'ppm' },
    ],
    quickFields: [
      { key: 'unit_area_m2_t_d',     label: 'Aire unitaire (m²/t/j)', placeholder: 'ex. 0.25', numeric: true },
      { key: 'flocculant_g_t',       label: 'Floculant (g/t)',        placeholder: 'ex. 15',   numeric: true },
      { key: 'uf_density_pct',       label: 'Densité UF (% sol.)',    placeholder: 'ex. 72',   numeric: true },
      { key: 'cn_overflow_ppm',      label: 'CN overflow (ppm)',      placeholder: 'ex. 5',    numeric: true },
    ],
  },

  // ── 10. Élution ADR ──────────────────────────────────────────────────────
  {
    code: 'elution',
    label: 'Élution ADR (AARL / Zadra — Stripping & Carbon Reactivation)',
    shortLabel: 'Élution ADR',
    group: 'ADR',
    color: '#F06B6B',
    table: 'lims_test_elution',
    displayCols: [
      { key: 'test_type',      label: 'Type',       unit: '' },
      { key: 'elution_temp_c', label: 'Temp.',      unit: '°C' },
      { key: 'elution_time_h', label: 'Temps él.',  unit: 'h' },
      { key: 'au_eluted_mg_l', label: 'Au élué',    unit: 'mg/L', color: '#F59E0B' },
      { key: 'au_recovery_pct',label: 'Récup. Au',  unit: '%',    color: '#F06B6B' },
    ],
    quickFields: [
      { key: 'test_type',       label: 'Type test', select: ['AARL', 'Zadra'] },
      { key: 'elution_temp_c',  label: 'Temp. élution (°C)',  placeholder: 'ex. 110', numeric: true },
      { key: 'elution_time_h',  label: 'Temps élution (h)',   placeholder: 'ex. 6',   numeric: true },
      { key: 'au_recovery_pct', label: 'Récup. Au élution (%)',placeholder: 'ex. 98', numeric: true },
    ],
  },

  // ── 11. Lixiviation au cyanure ───────────────────────────────────────────
  {
    code: 'leaching',
    label: 'Lixiviation au cyanure (CIL/CIP/Heap Leach — Cinétique & Consommation)',
    shortLabel: 'Lixiviation CN',
    group: 'Lixiviation',
    color: '#10B981',
    table: 'lims_test_leaching',
    displayCols: [
      { key: 'au_feed_g_t',         label: 'Au alim.',        unit: 'g/t',  color: '#F59E0B' },
      { key: 'p80_um',              label: 'P80',             unit: 'µm' },
      { key: 'nacn_initial_ppm',    label: '[NaCN] ini.',     unit: 'ppm' },
      { key: 'leach_rec_24h_pct',   label: 'Récup. 24h',     unit: '%',    color: '#10B981' },
      { key: 'leach_rec_48h_pct',   label: 'Récup. 48h',     unit: '%' },
      { key: 'au_tail_g_t',         label: 'Au résidu',       unit: 'g/t',  color: '#F06B6B' },
      { key: 'nacn_consumption_kg_t', label: 'NaCN cons.',    unit: 'kg/t' },
      { key: 'cao_consumption_kg_t',  label: 'CaO cons.',     unit: 'kg/t' },
    ],
    quickFields: [
      { key: 'au_feed_g_t',           label: 'Au alimentation (g/t)',    placeholder: 'ex. 3.45', numeric: true },
      { key: 'p80_um',                label: 'P80 alimentation (µm)',    placeholder: 'ex. 75',   numeric: true },
      { key: 'solids_pct',            label: '% Solides pulpe',          placeholder: 'ex. 40',   numeric: true },
      { key: 'nacn_initial_ppm',      label: '[NaCN] initiale (ppm)',    placeholder: 'ex. 500',  numeric: true },
      { key: 'leach_rec_24h_pct',     label: 'Récupération 24h (%)',     placeholder: 'ex. 88',   numeric: true },
      { key: 'leach_rec_48h_pct',     label: 'Récupération 48h (%)',     placeholder: 'ex. 91',   numeric: true },
      { key: 'nacn_consumption_kg_t', label: 'Cons. NaCN (kg/t)',        placeholder: 'ex. 0.8',  numeric: true },
      { key: 'au_tail_g_t',           label: 'Au résidu final (g/t)',    placeholder: 'ex. 0.10', numeric: true },
    ],
  },

  // ── 12. Détoxification CN ────────────────────────────────────────────────
  {
    code: 'cyanide_detox',
    label: 'Détoxification Cyanure (SO₂/Air · H₂O₂ · AVR · SART)',
    shortLabel: 'Détox CN',
    group: 'Environnement',
    color: '#14B8A6',
    table: 'lims_test_cyanide_detox',
    displayCols: [
      { key: 'cn_wad_mg_l',              label: 'CN WAD ini.', unit: 'mg/L', color: '#F59E0B' },
      { key: 'cn_total_mg_l',            label: 'CN total',    unit: 'mg/L' },
      { key: 'ph_final',                 label: 'pH final',    unit: '' },
      { key: 'cn_wad_rebound_24h_mg_l',  label: 'Rebound 24h', unit: 'mg/L', color: '#F06B6B' },
      { key: 'cn_wad_rebound_7j_mg_l',   label: 'Rebound 7j',  unit: 'mg/L' },
      { key: 'so2_kg_t',                 label: 'SO₂',         unit: 'kg/t' },
    ],
    quickFields: [
      { key: 'cn_wad_mg_l',             label: 'CN WAD initial (mg/L)', placeholder: 'ex. 150', numeric: true },
      { key: 'cn_total_mg_l',           label: 'CN total (mg/L)',       placeholder: 'ex. 200', numeric: true },
      { key: 'ph_final',                label: 'pH final',              placeholder: 'ex. 8.5', numeric: true },
      { key: 'cn_wad_rebound_24h_mg_l', label: 'CN WAD rebound 24h (mg/L)', placeholder: 'ex. 2', numeric: true },
    ],
  },
];

// All DB table names for bulk-delete operations
export const ALL_TEST_TABLES = ALL_FAMILIES.map(f => f.table);
