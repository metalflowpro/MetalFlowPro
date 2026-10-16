/* eslint-disable react-refresh/only-export-components -- module de DONNÉES (aucun composant React) : le rechargement à chaud n'a pas d'état à préserver ici. */
import { Layers, Zap, Droplets,
  FlaskConical, Wind, Gauge, BarChart3, RefreshCw,
} from 'lucide-react';
import { TROY_OZ_GRAMS, GRAVITY_M_S2 } from '../../lib/config/constants';
import { EQUIPMENT_DESIGN_FACTORS as EDF } from '../../lib/config/equipmentDesign';
import { EquipSection, annualOz, annualT, bond, cr, designRecovery, installedPower, millRpm, phaseSuffix, pulpSG, r, regrindFeed, rowlandEF, slurryQv, slurryVolFlow, uid, vsmaScreen } from './model';

// ─── Section definitions ──────────────────────────────────────────────────────

const SECTIONS_RAW: EquipSection[] = [
  {
    id: 'general', label: 'Paramètres Généraux', code: 'GEN', group: 'general',
    icon: <BarChart3 size={13} />,
    rows: (inp, phase, _ctx, design) => [
      { id: uid(), parameter: 'Débit nominal de traitement',  value: r(inp.tph, 0),                      unit: 't/h',  formula: 'Données projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Disponibilité usine annuelle', value: r(inp.availability, 0),             unit: '%',    formula: 'Données projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Heures opération / an',        value: r(inp.availability/100* inp.hours_per_year, 0),    unit: 'h/an', formula: `Dispo% × ${inp.hours_per_year}`,                     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Teneur or alimentation',       value: r(inp.gold_grade, 2),               unit: 'g/t',  formula: 'Modèle de blocs',                   source: 'Gisement', isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Densité du minerai (SG)',      value: r(inp.ore_sg, 2),                   unit: 't/m³', formula: 'Testwork LIMS',                     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Précision estimée',            value: phaseSuffix(phase),                 unit: '',     formula: `Phase ${phase}`,                    source: 'Phase',    isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Production annuelle (oz Au)',  value: r(annualOz(inp, design), 0), unit: 'oz/an', formula: `TPH×H/an×Grade×Récup. globale ${r(designRecovery(design), 1)} %/31.1${design?.routeLabel ? ` (route ${design.routeLabel})` : ''}`, source: 'Calcul', isCalc: true, comment: '', reference: '' },
    ],
  },
  {
    id: 'grizzly', label: 'Grizzly / Scalpeur ROM', code: '01a', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const F = EDF.grizzly;
      const slot = inp.f80_crush / 1000 * F.slotFromF80Factor;
      const width_m = Math.max(F.minWidthM, inp.tph * F.designMarginFactor / F.capacityPerWidthTphM);
      return [
        cr('Capacité nominale',         r(inp.tph, 0),        't/h', 'Débit projet', 'Projet'),
        cr(`Capacité design (×${F.designMarginFactor})`, r(inp.tph * F.designMarginFactor, 0), 't/h', `TPH × ${F.designMarginFactor}`),
        cr('Débit massique annuel',     r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('Ouverture barreaux grizzly', r(slot, 0),          'mm',  `F80×${F.slotFromF80Factor}/1000`),
        cr('Dimension max ROM (P100)',  r(inp.f80_crush / 1000 * F.topSizeFromF80Factor, 0), 'mm', `F80×${F.topSizeFromF80Factor}/1000`),
        cr('Largeur grizzly (approx)',  r(width_m, 1),        'm',   `≈ Q_design / ${F.capacityPerWidthTphM} t/(m·h)`),
        cr('Passant sous-taille estimé', r(F.typicalUndersizePct, 0), '%', 'Typique ROM primaire'),
        { id: uid(), parameter: 'Angle d\'inclinaison', value: '30–40', unit: '°', formula: 'Grizzly statique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'apron', label: 'Alimentateur Tablier (Apron)', code: '01b', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité nominale',              value: r(inp.tph, 0),     unit: 't/h',  formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: `Capacité de conception (×${EDF.apron.designMarginFactor})`, value: r(inp.tph*EDF.apron.designMarginFactor,0), unit: 't/h', formula: `TPH × ${EDF.apron.designMarginFactor}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Vitesse tablier',                value: '0.05–0.15',       unit: 'm/s',  formula: 'Typique apron feeder',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Largeur tablier',                value: r(Math.max(1200, inp.tph * 5), 0), unit: 'mm', formula: 'TPH×5 min 1200', source: 'Calcul', isCalc: true, comment: '', reference: '' },
    ],
  },
  {
    id: 'conveyor', label: 'Convoyeurs à Bande', code: '01c', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const F = EDF.conveyor;
      const cap = inp.tph * F.designMarginFactor;
      const speed = F.designSpeedMps;
      const load_kg_m = cap * 1000 / 3600 / speed;     // belt loading kg per m
      const lift_m = F.assumedLiftM;
      const power_kw = cap * GRAVITY_M_S2 * lift_m / 3600 / F.driveEfficiency; // lift power / drive eff.
      return [
        cr('Capacité convoyage',        r(cap, 0),        't/h', `TPH × ${F.designMarginFactor}`),
        cr('Débit massique annuel',     r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('Vitesse de conception',     r(speed, 1),      'm/s', 'Typique convoyage'),
        cr('Largeur courroie estimée',  r(Math.max(F.minWidthMm, inp.tph * F.widthPerTphMm), 0), 'mm', `TPH×${F.widthPerTphMm} min ${F.minWidthMm}`),
        cr('Charge linéaire courroie',  r(load_kg_m, 0),  'kg/m', 'Cap / (3.6 × vitesse)'),
        cr(`Puissance entraînement (lift ${lift_m} m)`, r(power_kw, 0), 'kW', `Cap×g×H / 3600 / ${F.driveEfficiency}`),
        { id: uid(), parameter: 'Angle convoyeur (max)', value: '14–18', unit: '°', formula: 'Max inclinaison minerai', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'stockpile', label: 'Stockpile / Dôme de Stockage', code: '01d', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const F = EDF.stockpile;
      const live = inp.tph*F.liveCapacityHours; const total = inp.tph*F.totalCapacityHours;
      const vol = total/inp.ore_sg;
      const diam = Math.pow(vol*3/(Math.PI*F.coneHeightRadiusRatio), 1/3)*2;
      const reclaim_tph = inp.tph * F.reclaimMarginFactor;  // reclaim feeders slightly above nominal
      return [
        cr('Capacité utile (live)',    r(live, 0),   't',  `TPH × ${F.liveCapacityHours}h`),
        cr(`Capacité totale (${r(F.totalCapacityHours / 24, 0)} jours)`, r(total, 0), 't', `TPH × ${F.totalCapacityHours}h`),
        cr('Autonomie utile',          r(F.liveCapacityHours, 0), 'h', 'Capacité live / TPH'),
        cr('Volume total stockage',    r(vol, 0),    'm³', 'Masse totale / SG'),
        cr('Diamètre dôme estimé',     r(diam, 0),   'm',  `(V×3/(π×${F.coneHeightRadiusRatio}))^(1/3)×2`),
        cr('Débit de reprise (reclaim)', r(reclaim_tph, 0), 't/h', `TPH × ${F.reclaimMarginFactor}`),
        { id: uid(), parameter: 'Angle repos minerai', value: '35–40', unit: '°', formula: 'Typique minerai concassé', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Fraction reprise gravitaire', value: '30–40', unit: '%', formula: 'Reste par bulldozer', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'silo', label: 'Silo / Trémie Tampon', code: '01e', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const F = EDF.silo;
      const mass = inp.tph * F.bufferHours;
      const vol = mass / inp.ore_sg;
      const diam = Math.pow(4 * vol / (Math.PI * F.heightDiameterRatio), 1 / 3);
      return [
        cr(`Capacité trémie (${F.bufferHours} h)`, r(mass, 0), 't', `TPH × ${F.bufferHours}h`),
        cr('Volume utile',            r(vol, 0),   'm³', 'Masse / SG'),
        cr('Autonomie',               r(F.bufferHours, 0), 'h', 'Capacité / TPH'),
        cr(`Diamètre estimé (H/D≈${F.heightDiameterRatio})`, r(diam, 1),'m', `D=(4V/(π×${F.heightDiameterRatio}))^(1/3)`),
        cr('Débit d\'extraction',     r(inp.tph * F.drawoffMarginFactor, 0), 't/h', `TPH × ${F.drawoffMarginFactor}`),
        { id: uid(), parameter: 'Angle talus parois', value: '55–65', unit: '°', formula: 'Écoulement massique (mass-flow)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre orifice sortie', value: '≥ 6× top size', unit: 'mm', formula: 'Anti-voûtage', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'sampling', label: 'Échantillonnage & Pesée', code: '01f', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const F = EDF.sampling;
      const sample_kg = Math.max(F.minSampleKg, inp.tph / F.massPerTphDivisor);
      const cuts_per_h = F.cutsPerHour;
      const daily_kg = sample_kg * cuts_per_h * 24;
      return [
        cr('Masse min. représentative', r(sample_kg, 2), 'kg', `TPH/${F.massPerTphDivisor} min ${F.minSampleKg} kg`),
        cr('Fréquence d\'échantillonnage', r(cuts_per_h, 0), '/h', `1 coupe / ${r(60 / cuts_per_h, 0)} min`),
        cr('Masse échantillon / jour',  r(daily_kg, 0),  'kg/j', 'Masse × coupes/h × 24'),
        cr('Balance de pesée (bande)',  r(inp.tph * F.beltScaleMarginFactor, 0), 't/h', `TPH × ${F.beltScaleMarginFactor}`),
        cr('Ouverture coupe échantillonneur', r(inp.f80_crush / 1000 * F.cutterApertureTopSizeFactor, 0), 'mm', `≥ ${F.cutterApertureTopSizeFactor}× top size`),
        { id: uid(), parameter: 'Précision balance', value: '±0.5', unit: '%', formula: 'Standard industrie (MI 002)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Norme échantillonnage', value: 'ISO 13292 / Gy', unit: '', formula: 'Théorie de Gy', source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'dedusting', label: 'Dépoussiérage', code: '01g', group: 'feed',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const F = EDF.dedusting;
      const air_m3min = inp.tph * F.airflowPerTph;
      const air_c_h = F.airToClothRatio;                // ratio air/tissu m³/min/m² (m/min)
      const bag_area = air_m3min / air_c_h;
      const fan_kw = air_m3min / 60 * F.pressureDropPa / 1000 / F.fanEfficiency;
      return [
        cr('Débit air extrait (total)', r(air_m3min, 0), 'm³/min', `TPH × ${F.airflowPerTph}`),
        cr('Ratio air/tissu',           r(air_c_h, 1),   'm/min', 'Typique filtre à manches'),
        cr('Surface filtrante (manches)', r(bag_area, 0),'m²',   'Débit air / ratio air-tissu'),
        cr('Puissance ventilateur',     r(fan_kw, 0),    'kW',   `Q×ΔP / ${F.fanEfficiency} (η ventilateur)`),
        { id: uid(), parameter: 'Points de dépoussiérage', value: 'Concasseurs, SAG, chutes, cribles', unit: '', formula: 'Points de transfert', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Émissions PM10 cible', value: '<10', unit: 'mg/m³', formula: 'Réglementation air', source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'jaw', label: 'Concasseur à Mâchoires', code: '03a', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, phase, ctx) => {
      // Template 03_CRUSHING — primary jaw via Bond CWi + installed power.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1);
      const f80 = ctx?.feedF80 ?? inp.f80_rom_mm * 1000;   // feed from upstream flow step
      const p80 = inp.p80_primary_mm * 1000;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 30);
      return [
        cr('Capacité nominale',            r(inp.tph, 0),      't/h',  'Débit projet', 'Projet'),
        cr('Débit DESIGN concassage',      r(q_design, 0),     't/h',  'Q_broyage × dispo_broy / dispo_conc'),
        cr('F80 alimentation (ROM)',       r(f80, 0),          'µm',   'F80 ROM × 1000'),
        cr('P80 produit primaire',         r(p80, 0),          'µm',   'P80 concassage primaire × 1000'),
        cr('Ratio de réduction R80',       r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('Bond Crushing WI (CWi)',       r(inp.cwi, 1),      'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 3),            'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre (P_shaft)',    r(p_shaft, 0),      'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE moteur',   r(p_install, 0),    'kW',   'P_shaft / η_méca × (1 + 30%)'),
        cr('Ouverture alimentation (gape)', r(inp.f80_rom_mm * EDF.gyratory.gapeFromRomF80Factor, 0), 'mm', `${EDF.gyratory.gapeFromRomF80Factor} × F80 ROM`),
        { id: uid(), parameter: `Précision (${phase})`,               value: phaseSuffix(phase),   unit: '',      formula: `Phase ${phase}`,                 source: 'Phase',    isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'gyratory', label: 'Concasseur Giratoire', code: '03b', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, phase, ctx) => {
      // Template 03_CRUSHING — primary crusher via Bond CWi + installed power.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1); // aligned on crush availability
      const f80 = ctx?.feedF80 ?? inp.f80_rom_mm * 1000;   // feed from upstream flow step
      const p80 = inp.p80_primary_mm * 1000;
      const r80 = p80 > 0 ? f80 / p80 : 0;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 30);
      const gape = inp.f80_rom_mm * EDF.gyratory.gapeFromRomF80Factor;
      return [
        cr('Capacité nominale',            r(inp.tph, 0),      't/h',  'Débit projet', 'Projet'),
        cr('Débit DESIGN concassage',      r(q_design, 0),     't/h',  'Q_broyage × dispo_broy / dispo_conc'),
        cr('Débit massique annuel',        r(inp.tph * inp.avail_crush / 100 * inp.hours_per_year / 1000, 0), 'kt/an', `TPH × dispo_conc% × ${inp.hours_per_year}`),
        cr('F80 alimentation (ROM)',       r(f80, 0),          'µm',   'F80 ROM × 1000'),
        cr('P80 produit primaire',         r(p80, 0),          'µm',   'P80 concassage primaire × 1000'),
        cr('Ratio de réduction R80',       r(r80, 1),          '',     'F80 / P80'),
        cr('Bond Crushing WI (CWi)',       r(inp.cwi, 1),      'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 3),            'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre (P_shaft)',    r(p_shaft, 0),      'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE moteur',   r(p_install, 0),    'kW',   'P_shaft / η_méca × (1 + 30%)'),
        cr('Ouverture alimentation (gape)', r(gape, 0),        'mm',   `${EDF.gyratory.gapeFromRomF80Factor} × F80 ROM`),
        { id: uid(), parameter: 'Vitesse excentrique', value: '85–120', unit: 'rpm', formula: 'Typique giratoire primaire', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Modèle suggéré', value: 'FLS 54-75 / Metso 50-65', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: `Précision (${phase})`, value: phaseSuffix(phase), unit: '', formula: `Phase ${phase}`, source: 'Phase', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cone', label: 'Concasseur à Cône (Secondaire)', code: '03c', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, _phase, ctx) => {
      // Template 03_CRUSHING §3 — secondary cone via Bond CWi on secondary size reduction.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1);
      const f80 = ctx?.feedF80 ?? inp.p80_primary_mm * 1000;   // feed from upstream flow step
      const p80 = inp.p80_secondary_mm * 1000;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 25);
      const css = inp.p80_secondary_mm * EDF.cone.cssFromStageP80Factor;
      return [
        cr('Débit alimentation (design)',  r(q_design, 0),  't/h',  'Débit design concassage'),
        cr('F80 alimentation',             r(f80, 0),       'µm',   'P80 primaire × 1000'),
        cr('P80 produit secondaire',       r(p80, 0),       'µm',   'P80 sec. × 1000'),
        cr('Ratio de réduction',           r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('CSS estimé',                   r(css, 0),       'mm',   `≈${EDF.cone.cssFromStageP80Factor} × P80 sec.`),
        cr('Énergie Bond W (secondaire)',  r(w, 3),         'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre',              r(p_shaft, 0),   'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE',          r(p_install, 0), 'kW',   'P_shaft / η_méca × (1 + 25%)'),
        { id: uid(), parameter: 'Modèle suggéré', value: 'Metso MP1000 / HP500', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'hpgr', label: 'HPGR', code: '04', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, _phase, ctx) => {
      // Template 04_HPGR — m-dot capacity, pressing force, twin-motor installed power.
      const f80_in = ctx?.feedF80 ?? inp.f80_hpgr_mm * 1000;   // µm
      const p80_out = inp.p80_hpgr_mm * 1000;                  // µm
      const r80_hpgr = p80_out > 0 ? f80_in / p80_out : 0;
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const recycle = 25;                              // % edge + screen recycle
      const q_roll = fresh * (1 + recycle / 100);
      const D = 2.4, L = 1.7, N = 18;                  // roll geometry (m, m, rpm)
      const u = Math.PI * D * N / 60;                  // peripheral speed m/s
      const mdot = 250;                                // ts/(h·m³) specific throughput
      const cap_unit = mdot * D * L * u;               // capacity per unit t/h
      const n_units = Math.max(1, Math.ceil(q_roll / cap_unit));
      const f_sp = 4.5;                                // N/mm² specific pressing force
      const force_kn = f_sp * D * 1000 * L;            // kN per roll
      const e_sp = 2.3;                                // kWh/t specific energy
      const p_net = e_sp * cap_unit;                   // kW per unit (net)
      const p_roll = installedPower(p_net / 2, 95, 15);// per roll (twin), η 95%, margin 15%
      const p_total = p_roll * 2 * n_units;
      return [
        cr('F80 alimentation',             r(f80_in, 0),    'µm',   ctx?.feedF80 ? 'Produit étape amont (flux)' : 'Entrée F80 HPGR × 1000'),
        cr('P80 produit',                  r(p80_out, 0),   'µm',   'Entrée P80 HPGR × 1000'),
        { id: uid(), parameter: 'Rapport de réduction R80', value: r(r80_hpgr, 1), unit: '', formula: 'F80 / P80', source: 'Calcul', isCalc: true, comment: '', reference: '', isAlert: r80_hpgr > 0 && (r80_hpgr < 3 || r80_hpgr > 8) },
        cr('Débit fresh feed (design)',    r(fresh, 0),     't/h',  'TPH × (1 + facteur design broyage)'),
        cr('Recycle (edge + crible)',      r(recycle, 0),   '%',    'Edge recycle 15–30 %'),
        cr('Débit total roll',             r(q_roll, 0),    't/h',  'Fresh × (1 + recycle)'),
        cr('Vitesse périphérique u',       r(u, 2),         'm/s',  'π·D·N/60'),
        cr('Capacité unitaire M',          r(cap_unit, 0),  't/h',  'ṁ · D · L · u'),
        cr('Nombre HPGR requis',           r(n_units, 0),   'unités','Q_total / capacité unitaire'),
        cr('Force spécifique F_sp',        r(f_sp, 1),      'N/mm²','3.0–5.5 typique', 'Testwork'),
        cr('Force totale par rouleau',     r(force_kn, 0),  'kN',   'F_sp · D · L'),
        cr('Énergie spécifique E_sp',      r(e_sp, 1),      'kWh/t','1.5–2.8 kWh/t'),
        cr('Puissance installée / rouleau', r(p_roll, 0),   'kW',   '(E·M/2) / η × (1+15%)'),
        cr('PUISSANCE TOTALE HPGR',        r(p_total, 0),   'kW',   '2 rouleaux × N unités'),
        { id: uid(), parameter: 'Diamètre × longueur rouleaux', value: `${D} × ${L}`, unit: 'm', formula: 'Aspect L/D ≈ 0.7', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Crible humide post-HPGR', value: '6', unit: 'mm', formula: 'Coupure circuit fermé', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'pebble_crusher', label: 'Concasseur de Cailloux (Pebble)', code: '03d', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const pebble_tph = inp.tph * EDF.pebble_crusher.pebbleRecycleFraction;
      return [
        { id: uid(), parameter: 'Débit cailloux estimé',     value: r(pebble_tph, 0),   unit: 't/h',  formula: 'TPH × 15% (recirculation)', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'CSS nominal pebble',        value: '12–18',             unit: 'mm',   formula: 'Typique pebble crusher',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Taille d\'alimentation max', value: r(inp.f80_crush/1000*EDF.pebble_crusher.maxFeedFromF80Factor, 0), unit: 'mm', formula: `F80×${EDF.pebble_crusher.maxFeedFromF80Factor} (pebbles)`, source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'sag', label: 'Broyeur SAG', code: '05b', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp, _phase, ctx) => {
      // Le SAG broie jusqu'à son P80 produit (~2 mm, entrée P80 SAG), PAS le P80
      // final de broyage : ce dernier est atteint par le ball mill en aval.
      // Employer p80_grind ici comptait deux fois l'énergie de broyage fin.
      const f80In = ctx?.feedF80 ?? inp.f80_sag_mm * 1000;   // feed from upstream flow step
      const p80Sag = inp.p80_sag_mm * 1000;
      const e_sag = bond(inp.bwi * EDF.sag.bwiCorrectionFactor, p80Sag, f80In) * EDF.sag.bondEnergyFactor;
      const power = e_sag * inp.tph;
      const vol_m3 = inp.tph / inp.ore_sg / EDF.sag.vesselFillFraction;
      const aspect = EDF.sag.lengthDiameterRatio;  // L/D d'un SAG typique
      const diam_m = Math.pow(vol_m3 / (Math.PI / 4 * aspect), 1 / 3);
      const len_m = diam_m * aspect;
      const motor_kw = power * EDF.ball.motorMarginFactor;  // marge de conception moteur
      const rpm = millRpm(diam_m, 75);             // at 75% of critical
      const charge_vol = vol_m3 * EDF.sag.ballChargeVolumeFraction;
      const ball_charge_t = charge_vol * EDF.sag.mediaBulkDensityTM3;
      const media_kg_h = 0.10 * power;             // ≈0.10 kg/kWh SAG media wear
      return [
        cr('Débit de conception',          r(inp.tph, 0),       't/h',   'Débit projet', 'Projet'),
        cr('Débit massique annuel',        r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('F80 alimentation',             r(f80In, 0),         'µm',    ctx?.feedF80 ? 'Produit étape amont (flux)' : 'Entrée F80 SAG × 1000'),
        cr('P80 produit SAG',              r(p80Sag, 0),        'µm',    'Entrée P80 SAG × 1000 (≈ alim. ball)'),
        cr('BWi (Bond Work Index)',        r(inp.bwi, 1),       'kWh/t', 'Testwork LIMS', 'LIMS'),
        cr('Énergie spécifique SAG',       r(e_sag, 2),         'kWh/t', 'Bond: Wi×1.3×(10/√P80−10/√F80)×0.55'),
        cr('Puissance au broyeur',         r(power, 0),         'kW',    'E_sag × TPH'),
        cr('Puissance moteur installée',   r(motor_kw, 0),      'kW',    'Puissance × 1.10 (marge)'),
        cr('Diamètre intérieur (approx)',  r(diam_m, 1),        'm',     'V=TPH/(SG×0.35); D=(V/(π/4×L/D))^(1/3)'),
        cr('Longueur (L/D≈1.5)',           r(len_m, 1),         'm',     'D × 1.5'),
        cr('Vitesse de rotation (75% Vc)', r(rpm, 1),           'rpm',   'Nc=42.3/√D; N=Nc×0.75'),
        cr('Masse charge boulets',         r(ball_charge_t, 0), 't',     'V×11% × 7.8 t/m³'),
        cr('Consommation media (acier)',   r(media_kg_h, 0),    'kg/h',  '≈0.10 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Charge en boulets (%)',        value: '10–12',             unit: '%v',    formula: 'Typique SAG',                    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse critique (%)',         value: '72–78',             unit: '%Vc',   formula: 'Typique SAG',                    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ag', label: 'Broyeur AG', code: '05a', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp, _phase, ctx) => {
      // AG : même logique que le SAG — produit ≈ P80 SAG (~2 mm), pas le P80 final.
      const f80In = ctx?.feedF80 ?? inp.f80_sag_mm * 1000;
      const p80Ag = inp.p80_sag_mm * 1000;
      const e_ag = bond(inp.bwi * EDF.ag.bwiCorrectionFactor, p80Ag, f80In) * EDF.ag.bondEnergyFactor;
      const power = e_ag * inp.tph;
      return [
        { id: uid(), parameter: 'Débit de conception',     value: r(inp.tph, 0),       unit: 't/h',   formula: 'Débit projet',        source: 'Projet', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'F80 alimentation',        value: r(f80In, 0),         unit: 'µm',    formula: ctx?.feedF80 ? 'Produit étape amont (flux)' : 'Entrée F80 SAG × 1000', source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'P80 produit',             value: r(p80Ag, 0),         unit: 'µm',    formula: 'Entrée P80 SAG × 1000', source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique AG',   value: r(e_ag, 2),          unit: 'kWh/t', formula: 'Bond×1.2×0.65',       source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',     value: r(power, 0),         unit: 'kW',    formula: 'E_ag × TPH',          source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse critique (%)',    value: '70–76',             unit: '%Vc',   formula: 'Typique AG',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ball', label: 'Broyeur à Boulets', code: '05c', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp, _phase, ctx) => {
      // Template 05_GRINDING — ball mill with Rowland EF corrections + Bond power & sizing.
      const q_design = inp.tph * (1 + inp.sf_grind / 100);
      const f80 = ctx?.feedF80 ?? inp.f80_ball_um;      // feed = produit SAG/HPGR/tert. (flux) ou entrée explicite
      const p80 = inp.p80_grind;                       // cyclone OF primary target
      const w = bond(inp.bwi, p80, f80);               // uncorrected Bond
      const ef = rowlandEF(inp.bwi, f80, p80);         // EF4 × EF5
      const w_corr = w * ef;
      const p_shaft = w_corr * q_design;
      const p_install = installedPower(p_shaft, inp.eta_motor, inp.sf_grind);
      // Split across parallel grinding lines so a single mill stays within real limits (~22 MW / GMD).
      const n_lines = Math.max(1, Math.ceil(p_install / 22000));
      const p_line = p_install / n_lines;
      // Mill diameter (per line) from Bond/Rowland mill-power formula P = k·D^2.3·L, L=LD·D ⇒ P=k·D^3.3.
      const Jb = 0.30, phi = 0.75, rho = 4.65, LD = 1.5;
      const k = 7.33 * Jb * phi * (1 - 0.937 * Jb) * rho * LD;
      const D = Math.pow(p_line / k, 1 / 3.3);
      const media_kg_h = inp.ball_cons * inp.tph;
      return [
        cr('Débit alimentation (design)',  r(q_design, 0),  't/h',  'TPH × (1 + facteur design broyage)'),
        cr('F80 alimentation',             r(f80, 0),       'µm',   ctx?.feedF80 ? 'Produit étape amont (flux)' : 'Entrée F80 ball mill'),
        cr('P80 cible (cyclone OF)',       r(p80, 0),       'µm',   'P80 PSD testwork (LIMS)', 'LIMS'),
        cr('Ratio de réduction',           r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('Bond BWi',                     r(inp.bwi, 1),   'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 2),         'kWh/t','10·BWi·(1/√P80 − 1/√F80)'),
        cr('Corrections Rowland (EF4·EF5)', r(ef, 3),       '',     'F80,opt=4000√(13/Wi); EF fines'),
        cr('Énergie corrigée W_corr',      r(w_corr, 2),    'kWh/t','W × ∏ EFi'),
        cr('Puissance arbre requise',      r(p_shaft, 0),   'kW',   'W_corr × débit'),
        cr('PUISSANCE INSTALLÉE totale',   r(p_install, 0), 'kW',   'P_shaft / η_moteur × (1 + marge)'),
        cr('Nombre de lignes de broyage',  r(n_lines, 0),   '',     '⌈P / 22 MW par broyeur⌉'),
        cr('Puissance par broyeur',        r(p_line, 0),    'kW',   'P_totale / N_lignes'),
        cr('Diamètre intérieur D (EGL)',   r(D, 1),         'm',    'De P_ligne=k·D^3.3 (Bond/Rowland)'),
        cr('Longueur intérieure L',        r(D * LD, 1),    'm',    'D × L/D (1.5)'),
        cr('Vitesse de rotation (75% Vc)', r(millRpm(D, 75), 1), 'rpm', 'Nc=42.3/√D; N=Nc×0.75'),
        cr('Top size boulet recharge',     r(Math.min(100, Math.max(25, inp.bwi * 3)), 0), 'mm', 'Formule Bond d_b'),
        cr('Consommation boulets acier',   r(media_kg_h, 0),'kg/h', 'Conso spécifique × TPH'),
        { id: uid(), parameter: 'Remplissage boulets J_b', value: '28–35', unit: '%v', formula: 'Std ball mill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Configuration moteur', value: 'Twin pinion / GMD', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'rod', label: 'Broyeur à Barres', code: '05d', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp, _phase, ctx) => {
      const e_rod = bond(inp.brwi, 1000, ctx?.feedF80 ?? inp.f80_crush) * EDF.rod.bondEnergyFactor;
      const power = e_rod * inp.tph;
      const vol = inp.tph / inp.ore_sg / EDF.tailings.thickenedSolidsFraction;
      const aspect = 1.5;
      const diam = Math.pow(vol / (Math.PI / 4 * aspect), 1 / 3);
      const rpm = millRpm(diam, 65);
      return [
        cr('Débit de conception',    r(inp.tph, 0),   't/h',   'Débit projet', 'Projet'),
        cr('BRWi',                   r(inp.brwi, 1),  'kWh/t', 'Testwork LIMS', 'LIMS'),
        cr('Énergie spécifique Rod', r(e_rod, 2),     'kWh/t', 'BRWi(10/√1000−10/√F80)×1.1'),
        cr('Puissance au broyeur',   r(power, 0),     'kW',    'E_rod × TPH'),
        cr('Puissance moteur (marge)', r(power * EDF.ball.motorMarginFactor, 0), 'kW', `Puissance × ${EDF.ball.motorMarginFactor.toFixed(2)}`),
        cr('Diamètre intérieur',     r(diam, 1),      'm',     'V=TPH/(SG×0.40); D=(V/(π/4×1.5))^(1/3)'),
        cr('Longueur (L/D≈1.5)',     r(diam * aspect, 1), 'm', 'D × 1.5'),
        cr('Vitesse de rotation (65% Vc)', r(rpm, 1), 'rpm',   'Nc=42.3/√D; N=Nc×0.65'),
        { id: uid(), parameter: 'P80 produit (typ.)', value: '1000–3000', unit: 'µm', formula: 'Rod mill sortant', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Charge en barres (%)', value: '35–40', unit: '%v', formula: 'Typique rod mill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'vertimill', label: 'Vertimill', code: '05g', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp, _phase, ctx) => {
      const { f80: f80_re, tph: feed_tph, conc } = regrindFeed(inp, ctx);
      const p80_re = inp.p80_regrind_um;          // cible rebroyage (entrée)
      const e_vert = bond(inp.bwi * EDF.vertimill.bwiCorrectionFactor, p80_re, f80_re);
      const power = e_vert * feed_tph;
      const media_kg_h = 0.08 * power;
      return [
        cr('F80 alimentation rebroyage', r(f80_re, 0),   'µm',    conc ? 'P80 concentré flottation' : 'Produit étape amont (flux)'),
        cr('P80 cible rebroyage',    r(p80_re, 0),       'µm',    'Selon circuit aval'),
        cr(conc ? 'Débit concentré traité' : 'Débit alimentation rebroyage', r(feed_tph, 1), 't/h', conc ? 'TPH × Mass_pull%' : 'Débit amont (flux mainstream)'),
        cr('Énergie spécifique',     r(e_vert, 2),       'kWh/t', 'Bond(BWi×0.7)'),
        cr('Puissance broyeur',      r(power, 0),        'kW',    'E × débit traité'),
        cr('Puissance moteur (marge)', r(power * EDF.ball.motorMarginFactor, 0),'kW', `Puissance × ${EDF.ball.motorMarginFactor.toFixed(2)}`),
        cr('Consommation media',     r(media_kg_h, 1),   'kg/h',  '≈0.08 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '12–25', unit: 'mm', formula: 'Boulets acier/céramique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'isamill', label: 'IsaMill', code: '05f', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp, _phase, ctx) => {
      const { f80, tph: feed_tph, conc } = regrindFeed(inp, ctx);
      const p80_isa = inp.p80_regrind_um;         // cible ultra-fine (entrée)
      const e_isa = bond(inp.bwi * EDF.isamill.bwiCorrectionFactor, p80_isa, f80) * EDF.isamill.bondEnergyFactor;
      const power = e_isa * feed_tph;
      return [
        cr('F80 alimentation',    r(f80, 0),           'µm',    conc ? 'P80 concentré flottation' : 'Produit étape amont (flux)'),
        cr('P80 cible ultra-fin', r(p80_isa, 0),       'µm',    'Typique IsaMill'),
        cr(conc ? 'Débit concentré traité' : 'Débit alimentation rebroyage', r(feed_tph, 1), 't/h', conc ? 'TPH × Mass_pull%' : 'Débit amont (flux mainstream)'),
        cr('Énergie spécifique',  r(e_isa, 1),         'kWh/t', 'Bond(BWi×0.6)×1.2'),
        cr('Puissance broyeur',   r(power, 0),         'kW',    'E × débit traité'),
        cr('Consommation media (céramique)', r(0.05 * power, 2), 'kg/h', '≈0.05 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '2–3', unit: 'mm', formula: 'Céramique IsaMill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb passes / disques', value: '8', unit: '', formula: 'Config. IsaMill M-série', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'towermill', label: 'Tower Mill', code: '05h', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp, _phase, ctx) => {
      const { f80, tph: feed_tph, conc } = regrindFeed(inp, ctx);
      const p80t = inp.p80_regrind_um; const e = bond(inp.bwi*EDF.towermill.bwiCorrectionFactor, p80t, f80);
      const power = e * feed_tph;
      const media_kg_h = 0.08 * power;
      return [
        cr('F80 alimentation',       r(f80, 0),           'µm',    conc ? 'P80 concentré flottation' : 'Produit étape amont (flux)'),
        cr('P80 cible',              r(p80t, 0),          'µm',    'Typique Tower Mill'),
        cr(conc ? 'Débit traité (concentré)' : 'Débit alimentation rebroyage', r(feed_tph, 1), 't/h', conc ? 'TPH × Mass_pull%' : 'Débit amont (flux mainstream)'),
        cr('Énergie spécifique',     r(e, 1),             'kWh/t', 'Bond(BWi×0.65)'),
        cr('Puissance broyeur',      r(power, 0),         'kW',    'E × débit traité'),
        cr('Puissance moteur (marge)', r(power * EDF.ball.motorMarginFactor, 0), 'kW', `Puissance × ${EDF.ball.motorMarginFactor.toFixed(2)}`),
        cr('Consommation media',     r(media_kg_h, 1),    'kg/h',  '≈0.08 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '12–25', unit: 'mm', formula: 'Boulets/galets céramique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'hydrocyclone', label: 'Hydrocyclones', code: '06a', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => {
      // Template 06_CLASSIFICATION — cyclone cluster sizing from circulating load + pump power.
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const cs = inp.cyclone_pct_solids;
      const feed_tph = fresh * (1 + inp.cl_ball / 100);
      const qv = feed_tph / inp.ore_sg + feed_tph * (100 - cs) / cs;
      const cap_unit = 600;                            // m³/h per gMAX26/Cavex cyclone at ~90 kPa
      const n_op = Math.max(1, Math.ceil(qv / cap_unit));
      const d50 = inp.p80_grind / EDF.hydrocyclone.plittD50FromP80Divisor;
      const rho = pulpSG(inp.ore_sg, cs);
      const tdh = 25;                                  // m pump head
      const p_hyd = qv * rho * GRAVITY_M_S2 * tdh / 3600;      // hydraulic kW
      const p_pump = installedPower(p_hyd, 65, 25);    // pump η 65%, motor margin 25%
      return [
        cr('Débit fresh feed broyage',     r(fresh, 0),   't/h',  'TPH × (1 + facteur design)'),
        cr('Charge circulante',            r(inp.cl_ball, 0), '%', 'Std 250–350 % ball mill'),
        cr('Débit feed cyclone (solides)', r(feed_tph, 0),'t/h',  'Fresh × (1 + CL)'),
        cr('Débit volumique pulpe',        r(qv, 0),      'm³/h', 'Q_solides + Q_liquide'),
        cr('Cible d50c (cut size)',        r(d50, 0),     'µm',   `Plitt: ≈ P80/${EDF.hydrocyclone.plittD50FromP80Divisor}`),
        cr('Capacité unitaire cyclone',    r(cap_unit, 0),'m³/h', 'À 80–100 kPa'),
        cr('Nb cyclones opérationnels',    r(n_op, 0),    '',     'Q_v / capacité unitaire'),
        cr('Total cluster (N+1)',          r(n_op + 1, 0),'',     'Op + 1 secours'),
        cr('Densité pulpe',                r(rho, 2),     't/m³', '1 + (SG−1)·Cs'),
        cr('Puissance hydraulique pompe',  r(p_hyd, 0),   'kW',   'Q·ρ·g·H / 3600'),
        cr('PUISSANCE pompe alim.',        r(p_pump, 0),  'kW',   'P_hyd / η_pompe × (1 + marge)'),
        { id: uid(), parameter: 'Pression opérationnelle', value: '70–120', unit: 'kPa', formula: 'Std ball mill circuit', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre cyclone', value: '≈660 (gMAX26)', unit: 'mm', formula: 'Selon d50c', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'screen', label: 'Cribles Vibrants', code: '06b', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const rate = 25;                               // t/(m²·h) specific screening rate
      const area = inp.tph / rate;
      const n_decks = 2;
      const width_m = Math.max(1.2, Math.sqrt(area / (2.5 * n_decks))); // area ≈ W × (2.5W) per deck
      const len_m = width_m * EDF.screen.lengthWidthRatio;
      return [
        cr('Débit de conception',      r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('Taux de criblage',         r(rate, 0),     't/(m²·h)', 'Typique crible vibrant'),
        cr('Surface efficace totale',  r(area, 1),     'm²',  'TPH / 25 t/(m²·h)'),
        cr('Largeur × longueur (approx)', `${r(width_m,1)} × ${r(len_m,1)}`, 'm', 'Aire ≈ L×2.5L par pont'),
        cr('Ouverture de maille',      r(inp.p80_grind / 1000 * EDF.screen.apertureFromP80Factor, 1), 'mm', `P80/1000×${EDF.screen.apertureFromP80Factor}`),
        { id: uid(), parameter: 'Nombre de ponts (decks)', value: '1–2',        unit: '',   formula: 'Selon séparation',   source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Efficacité de criblage',  value: '90–95',      unit: '%',  formula: 'Typique',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Accélération (g-force)',  value: '4.5–5.5',    unit: 'g',  formula: 'Typique crible',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Inclinaison',             value: '15–20',      unit: '°',  formula: 'Typique crible',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'xrt', label: 'Tri Optique (Ore Sorting XRT)', code: '02a', group: 'physep',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const reject = 0.25;                             // 25% waste rejection
      const product = inp.tph * (1 - reject);
      const n_machines = Math.max(1, Math.ceil(inp.tph / 120)); // ~120 t/h per module
      return [
        cr('Débit alimentation',       r(inp.tph, 0),     't/h', 'Débit projet', 'Projet'),
        cr('Débit produit (accepté)',  r(product, 0),     't/h', 'Alim × (1 − rejet)'),
        cr('Débit rejet (stérile)',    r(inp.tph * reject, 0), 't/h', 'Alim × rejet 25%'),
        cr('Nb machines de tri',       r(n_machines, 0),  '',    '≈ Alim / 120 t/h par module'),
        cr('Rejet massique cible',     r(reject * 100, 0),'%',   'Selon testwork minéralogie'),
        { id: uid(), parameter: 'Granulométrie traitée', value: '20–150', unit: 'mm', formula: 'Typique XRT sorting', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse courroie tri', value: '2.5–3.5', unit: 'm/s', formula: 'Typique ore sorting', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'dms', label: 'Séparation Milieu Dense (DMS)', code: '02b', group: 'physep',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const medium_flow = inp.tph * 4;                 // medium recirculation ≈ 4× feed
      const vessel_vol = inp.tph / inp.ore_sg / EDF.flash_flot.vesselFillFraction;
      return [
        cr('Débit alimentation',       r(inp.tph, 0),      't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('Débit médium recirculé',   r(medium_flow, 0),  'm³/h','≈ 4 × débit alimentation'),
        cr('Volume cuve/cyclone DMS',  r(vessel_vol, 0),   'm³',  'Alim / SG / 50%'),
        { id: uid(), parameter: 'Densité milieu dense', value: '2.65–3.1', unit: 'SG', formula: 'Selon minéraux gangue', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Efficacité séparation (Ep)', value: '0.03–0.06', unit: 'SG', formula: 'Testwork DMS', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Médium FeSi (conso)', value: '0.1–0.5', unit: 'kg/t', formula: 'Pertes typiques FeSi', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'magsep', label: 'Séparation Magnétique', code: '02c', group: 'physep',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const mag_frac = 0.12;
      return [
        cr('Débit alimentation',       r(inp.tph, 0),         't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', `TPH × Dispo% × ${inp.hours_per_year}`),
        cr('Débit fraction magnétique', r(inp.tph * mag_frac, 0), 't/h', 'Alim × 12%'),
        cr('Débit fraction non-magn.', r(inp.tph * (1 - mag_frac), 0), 't/h', 'Alim × 88%'),
        { id: uid(), parameter: 'Intensité champ', value: '0.5–2.0', unit: 'T', formula: 'Selon minéraux magnétiques', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Type', value: 'LIMS / WHIMS', unit: '', formula: 'Selon susceptibilité', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'flash_flot', label: 'Flash Flotation', code: '08a', group: 'physep',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const vol = slurryVolFlow(inp, inp.slurry_density);
      const ret_min = 2;
      const cell_vol = vol * ret_min / 60;
      const air = cell_vol * EDF.flash_flot.airPerCellVolume;   // m³ air/min par m³ de cellule
      return [
        cr('Débit alimentation',   r(inp.tph, 0),   't/h',  'Débit projet', 'Projet'),
        cr('Volume pulpe',         r(vol, 0),       'm³/h', 'TPH/SG/(%sol)'),
        cr('Temps de rétention',   r(ret_min, 0),   'min',  'Typique flash flotation'),
        cr('Volume cellule flash', r(cell_vol, 0),  'm³',   'Q_pulpe × t_ret/60'),
        cr('Débit d\'air',         r(air, 0),       'm³/min','≈0.8 m³/min par m³ cellule'),
        cr('Récupération Au estimée', r(inp.grg_pct * EDF.flash_flot.recoveryFromGrgFactor, 1), '%', `GRG × ${Math.round(EDF.flash_flot.recoveryFromGrgFactor * 100)}% (approx.)`),
      ];
    },
  },
  {
    id: 'column_flot', label: 'Colonnes de Flottation', code: '08b', group: 'physep',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      const vol = conc_tph / inp.ore_sg / EDF.column_flot.vesselFillFraction;
      const cell_vol = vol * 20 / 60;
      const diam = Math.sqrt(cell_vol / 10 * 4 / Math.PI); // assuming ~10 m height
      const wash_water = vol * EDF.column_flot.washWaterFraction;
      return [
        cr('Débit concentré rougher', r(conc_tph, 1), 't/h', 'TPH × Mass_pull%'),
        cr('Volume pulpe',           r(vol, 0),       'm³/h','Concentré / SG / 35%'),
        cr('Volume colonne (20 min)', r(cell_vol, 0), 'm³',  'Q × 20 min/60'),
        cr('Diamètre colonne (H≈10 m)', r(diam, 1),   'm',   '√(4V/(π×H))'),
        cr('Débit eau de lavage',    r(wash_water, 1),'m³/h','≈15% du débit pulpe'),
        { id: uid(), parameter: 'Hauteur colonne', value: '8–12', unit: 'm', formula: 'Typique flottation colonne', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Biais (bias) positif', value: '0.1–0.3', unit: 'cm/s', formula: 'Eau lavage > entraînement', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'gravity', label: 'Gravimétrie (GRG)', code: '07', group: 'treatment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 07_GRAVITY — GRG circuit on a bleed of cyclone underflow.
      const uf_bleed = 20;                             // % cyclone UF to gravity
      const q_grav = inp.tph * (1 + inp.sf_grind / 100) * uf_bleed / 100;
      const cap_unit = 150;                            // t/h per KC-XD48
      const n_conc = Math.max(1, Math.ceil(q_grav / cap_unit));
      const eta_unit = 60;                             // % per pass
      const eta_ilr = 95;                              // % ILR on concentrate
      const grav_global = inp.grg_pct / 100 * eta_unit / 100 * eta_ilr / 100 * 100;
      const conc_t_d = q_grav * EDF.gravity.concentrateMassFraction * 24 * inp.availability / 100;
      return [
        cr('Débit fresh feed broyage',    r(inp.tph * (1 + inp.sf_grind / 100), 0), 't/h', 'Design broyage'),
        cr('% UF cyclone → gravimétrie',  r(uf_bleed, 0), '%',   'Std 20–40 % UF'),
        cr('Débit feed gravimétrie',      r(q_grav, 0),   't/h', 'UF × % détourné'),
        cr('GRG dans minerai',            r(inp.grg_pct, 1), '%','Test GRG (Knelson lab)', 'LIMS'),
        cr('Récupération unitaire (pass)', r(eta_unit, 0),'%',   'Knelson par passage'),
        cr('Capacité unitaire (KC-XD48)', r(cap_unit, 0), 't/h', 'À 30–40 % solides'),
        cr('Nombre concentrateurs',       r(n_conc, 0),   '',    'Feed / capacité unitaire'),
        cr('Total installé (N+1)',        r(n_conc + 1, 0), '',  'Op + 1 secours'),
        cr('Masse concentré grav. / jour', r(conc_t_d, 2),'t/j', 'Ratio enrichissement ~1000:1'),
        cr('Récup. circuit grav. global', r(grav_global, 1), '%', 'GRG × η_pass × η_ILR'),
        { id: uid(), parameter: '[NaCN] leach intensif (ILR)', value: '30', unit: 'g/L', formula: 'Élevé (Acacia/ILR)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps cycle ILR', value: '24', unit: 'h', formula: 'Batch intensif', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'intensive_leach', label: 'Réacteur de Lixiviation Intensif (ILR)', code: '07b', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph_kg = inp.tph * EDF.intensive_leach.concentrateMassFraction * 1000;
      return [
        { id: uid(), parameter: 'Débit concentré gravitaire', value: r(conc_tph_kg, 1),   unit: 'kg/h',  formula: 'TPH × 0.2%',                    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention ILR',    value: '4–8',                unit: 'h',     formula: 'Typique batch ILR',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN conc. ILR',            value: '20–50',              unit: 'g/L',   formula: 'Haute teneur NaCN',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'DO ILR',                    value: '>20',                unit: 'mg/L',  formula: 'Surpression O₂',                 source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération ILR (cycle)',  value: '90–97',              unit: '%',     formula: 'Typique Acacia/Gekko ILR',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'flotation', label: 'Flottation', code: '08', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      // Template 08_FLOTATION — rougher / scavenger / cleaner. Facteurs de design
      // dans EDF.flotation (configurables), plus aucune valeur en dur ici.
      const F = EDF.flotation;
      const cs = F.rougherFeedPctSolids;
      const qv = slurryQv(inp.tph, inp.ore_sg, cs);
      const froth = F.frothBulkingFactor;
      const t_ro = F.rougherResidenceMin, v_ro = F.rougherCellVolumeM3;
      const n_ro = Math.max(F.rougherMinCells, Math.ceil(qv * t_ro / 60 * froth / v_ro));
      const t_sc = F.scavengerResidenceMin, v_sc = F.scavengerCellVolumeM3;
      const n_sc = Math.max(F.scavengerMinCells, Math.ceil(qv * t_sc / 60 * froth / v_sc));
      const conc_ro = inp.tph * inp.flot_mass_pull / 100;
      // Bilan Au sur le concentré : teneur = teneur alim. × récup. / mass pull.
      const enrichment = inp.flot_mass_pull > 0 ? inp.flot_rec / inp.flot_mass_pull : 0;
      const conc_grade = inp.gold_grade * enrichment;
      return [
        cr('Débit alimentation',          r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('% solides feed rougher',      r(cs, 0),       '%',   'Std rougher feed'),
        cr('Débit volumique pulpe',       r(qv, 0),       'm³/h','Q_solides + Q_liquide'),
        cr('Récupération Au flottation',  r(inp.flot_rec, 1), '%', 'Testwork LIMS', 'LIMS'),
        cr('Mass pull (concentré)',       r(inp.flot_mass_pull, 1), '%', 'Testwork LIMS', 'LIMS'),
        cr('Débit concentré rougher',     r(conc_ro, 1),  't/h', 'Feed × mass pull'),
        cr('Teneur concentré Au',         r(conc_grade, 1), 'g/t', 'Grade × Rec / Mass_pull'),
        cr('Ratio d\'enrichissement',     r(enrichment, 1), '×',  'Rec% / Mass_pull%'),
        cr('Temps rétention rougher',     r(t_ro, 0),     'min', 'Std 10–20 min'),
        cr('Volume rougher (×foisonnement)', r(qv * t_ro / 60 * froth, 0), 'm³', `Q·t/60 × ${froth}`),
        cr(`Nb cellules rougher (${v_ro} m³)`, r(n_ro, 0),    '',    `V / ${v_ro} m³, min ${F.rougherMinCells}`),
        cr('Temps rétention scavenger',   r(t_sc, 0),     'min', 'Std 8–15 min'),
        cr(`Nb cellules scavenger (${v_sc} m³)`, r(n_sc, 0),  '',    `V_scav / ${v_sc} m³`),
        { id: uid(), parameter: 'Étages cleaner', value: `${F.cleanerStages} (cleaner + recleaner)`, unit: '', formula: 'Std', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Collecteur (PAX) / Moussant (MIBC)', value: '30–50 / 10–20', unit: 'g/t', formula: 'Testwork flottation', source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'trash_screen', label: 'Crible Trash (Pré-lixiviation)', code: '06t', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit pulpe',                    value: r(inp.tph/inp.ore_sg/(inp.slurry_density/100), 0), unit: 'm³/h', formula: 'TPH/SG/(%sol)', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',            value: '0.5–1.0',           unit: 'mm',  formula: 'Élimination débris',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Type de tamis',                  value: 'Wedge wire',        unit: '',    formula: 'Résistant abrasion',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'preleach_thickener', label: 'Épaississeur Pré-Lixiviation', code: '11p', group: 'treatment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const ua = inp.thickener_area_factor;
      const td = inp.tph*inp.availability/100*24;
      const area = td*ua/1000;
      return [
        { id: uid(), parameter: 'Débit traitement',             value: r(inp.tph, 0),    unit: 't/h',      formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Aire unitaire',                value: r(ua, 3),         unit: 'm²/(t/j)', formula: 'Testwork décantation',     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface épaississeur',        value: r(area, 0),        unit: 'm²',       formula: 'T/j × Aire/1000',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre estimé',              value: r(Math.sqrt(area*4/Math.PI), 1), unit: 'm', formula: '√(4A/π)',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Densité soutirage cible',     value: '50–55',           unit: '% sol',    formula: 'Testwork décantation',     source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cil', label: 'Lixiviation CIL / CIP', code: '09', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      // Template 09_LEACHING_CIL — kinetics, tank sizing, agitation, carbon circuit.
      const cs = inp.slurry_density;
      const qv = slurryQv(inp.tph, inp.ore_sg, cs);
      const ret_h = 24;
      const rec_theo = (1 - Math.exp(-inp.leach_k * ret_h)) * 100;
      const vol_req = qv * ret_h;
      const vol_design = vol_req * EDF.cil.vesselDesignMarginFactor;
      const n_tanks = 8;
      const vol_tank = vol_design / n_tanks;
      const h_tank = 14;
      const d_tank = Math.sqrt((4 * vol_tank / Math.PI) / h_tank);
      const agit_kw = vol_tank * EDF.cil.agitationKwPerM3;
      const agit_total = agit_kw * n_tanks;
      const carbon_tank = vol_tank * inp.carbon_conc / 1000; // t per tank
      const carbon_total = carbon_tank * (n_tanks - 1);
      const cn_kg_h = inp.cyanide_cons * inp.tph;
      const lime_kg_h = inp.lime_cons * inp.tph;
      const au_out = inp.tph * inp.gold_grade * inp.leach_rec_48h / 100;
      return [
        cr('Débit alimentation (solides)', r(inp.tph, 0),   't/h',  'Cyclone OF secondaire', 'Projet'),
        cr('Densité pulpe CIL (%solides)', r(cs, 0),        '%',    'Std 40–50 % CIL', 'LIMS'),
        cr('Débit volumique pulpe',        r(qv, 0),        'm³/h', 'TPH/SG + eau'),
        cr('Temps de rétention total',     r(ret_h, 0),     'h',    'Testwork cyanuration', 'LIMS'),
        cr('Constante cinétique k',        r(inp.leach_k, 2), '1/h','Testwork (1er ordre)', 'LIMS'),
        cr('Récup. théorique 1−e^(−k·t)',  r(rec_theo, 1),  '%',    '1 − exp(−k·t)'),
        cr('Volume utile requis',          r(vol_req, 0),   'm³',   'Q_v × t_rétention'),
        cr('Volume design (+20%)',         r(vol_design, 0),'m³',   'V_requis × 1.2'),
        cr('Nombre de cuves',              r(n_tanks, 0),   '',     'Std 6–10 en série'),
        cr('Volume unitaire',              r(vol_tank, 0),  'm³',   'V_design / N_cuves'),
        cr('Hauteur cuve H',               r(h_tank, 0),    'm',    'Std 12–16 m'),
        cr('Diamètre cuve D',              r(d_tank, 1),    'm',    '√(4V/πH)'),
        cr('Aspect ratio H/D',             r(h_tank / d_tank, 2), '', 'Std 1.0–1.5'),
        cr('Puissance agitateur / cuve',   r(agit_kw, 0),   'kW',   '0.1 kW/m³ × V_cuve'),
        cr('Puissance agitation totale',   r(agit_total, 0),'kW',   'P_cuve × N'),
        cr('Inventaire charbon / cuve',    r(carbon_tank, 1),'t',   'V_cuve × g/L / 1000'),
        cr('Inventaire charbon total',     r(carbon_total, 1),'t',  '× (N−1) cuves chargées'),
        cr('Or en solution / heure',       r(au_out, 1),    'g/h',  'TPH × Grade × Rec%'),
        cr('NaCN débit',                   r(cn_kg_h, 0),   'kg/h', 'NaCN_cons × TPH'),
        cr('Chaux (CaO) débit',            r(lime_kg_h, 0), 'kg/h', 'Lime_cons × TPH'),
        cr('Charge Au charbon (loaded)',   r(inp.carbon_loading, 0), 'g/t', 'Std 2000–5000 g/t', 'LIMS'),
        { id: uid(), parameter: 'pH lixiviation cible', value: '10.5–11.0', unit: '', formula: 'Stabilité NaCN', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Cribles inter-cuves', value: 'Kemix / MPS', unit: '', formula: 'Rétention charbon', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'adr', label: 'ADR — Élution & Électrolyse', code: '10', group: 'treatment',
    icon: <Zap size={13} />,
    rows: (inp, _phase, _ctx, design) => {
      // Template 10_ADR — elution column, electrowinning (Faraday), carbon regen.
      // L'ADR produit le lingot : sa production annuelle EST celle du projet,
      // donc la récupération globale de la route, pas la seule lixiviation.
      const au_prod_kg_a = annualOz(inp, design) * TROY_OZ_GRAMS / 1000;
      // Elution
      const carbon_batch = 5;                          // t transferred per cycle
      const au_per_cycle = carbon_batch * inp.carbon_loading / 1000; // kg
      const col_vol = carbon_batch / EDF.adr.carbonBulkDensityTM3;
      const col_h = 5;
      const col_d = Math.sqrt((4 * col_vol / Math.PI) / col_h);
      const eluate = carbon_batch * 8;                 // ≈8 bed volumes m³
      // Electrowinning (Faraday)
      const cath_area = 24;                            // m² (12 cathodes × 2 m²)
      const current = inp.ew_current_density * cath_area; // A
      const voltage = 4;
      const ew_kw = voltage * current / 1000;
      const faraday = 0.735;                           // g Au per A·h
      const ew_eff = 92;
      const ew_prod_kg_d = current * (ew_eff / 100) * 0.001 * 24 * faraday;
      return [
        cr('Production or annuelle',       r(au_prod_kg_a, 0), 'kg/an', `TPH × Grade × Récup. globale ${r(designRecovery(design, inp), 1)} % × Dispo × ${inp.hours_per_year}`),
        cr('Méthode élution',              'AARL',          '',     'AARL / Zadra'),
        cr('Charge charbon / cycle',       r(carbon_batch, 1), 't', 'Batch colonne'),
        cr('Charge Au sur charbon',        r(inp.carbon_loading, 0), 'g/t', 'Loaded carbon', 'LIMS'),
        cr('Production Au / cycle',        r(au_per_cycle, 1), 'kg', 'Masse × g/t / 1000'),
        cr('Volume colonne élution',       r(col_vol, 1),   'm³',   `Charbon / ${EDF.adr.carbonBulkDensityTM3} t/m³`),
        cr('Diamètre colonne',             r(col_d, 2),     'm',    '√(4V/πH), H=5 m'),
        cr('Débit éluat (≈8 BV)',          r(eluate, 0),    'm³/cycle', 'Charbon × 8 bed volumes'),
        cr('Température élution',           r(inp.elution_temp, 0), '°C', 'AARL 100–130°C', 'LIMS'),
        cr('Densité courant EW',           r(inp.ew_current_density, 0), 'A/m²', 'Std 150–300', 'LIMS'),
        cr('Surface cathodes',             r(cath_area, 0), 'm²',   '12 cathodes × 2 m²'),
        cr('Courant total EW',             r(current, 0),   'A',    'Densité × surface'),
        cr('Puissance EW',                 r(ew_kw, 1),     'kW',   'V × I / 1000'),
        cr('Production Au EW (Faraday)',   r(ew_prod_kg_d, 2), 'kg/j', 'I·η·0.735 g/A·h × 24'),
        { id: uid(), parameter: 'Rendement Faraday', value: '92', unit: '%', formula: 'Standard', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Four régénération', value: '650–800', unit: '°C', formula: 'Rotary kiln', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'o2_plant', label: 'Usine d\'Oxygène', code: '09o', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      const o2 = vol * inp.dissolved_o2 / 1000;
      return [
        { id: uid(), parameter: 'Débit O₂ requis (CIL)',        value: r(o2, 1),          unit: 'kg/h', formula: 'V_pulpe × DO_mg/L / 1000',  source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Pureté oxygène',               value: '>90',             unit: '%',    formula: 'VPSA / cryogénique',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression injection',           value: '150–300',         unit: 'kPa',  formula: 'Pression hydrostatique+',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'interstage_screens', label: 'Tamis Interstades (CIL/CIP)', code: '09s', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit pulpe par tamis',          value: r(inp.tph/inp.ore_sg/(inp.slurry_density/100)/EDF.cil.tankCount, 0), unit: 'm³/h', formula: `Q_CIL / ${EDF.cil.tankCount} cuves`, source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',            value: '0.8–1.0',          unit: 'mm',  formula: 'Rétention charbon ≥1mm',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Nombre de tamis',                value: `${EDF.cil.tankCount + 1} (${EDF.cil.tankCount} inter + 1)`, unit: '', formula: 'N_cuves + 1',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'acid_wash', label: 'Lavage Acide du Charbon', code: '10a', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (_inp) => [
      { id: uid(), parameter: 'Concentration acide',            value: '3–5',              unit: '% HCl', formula: 'Lavage acide charbon',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Temps de contact',               value: '30–60',            unit: 'min',   formula: 'Dissolution Ca, Mg, carbonates', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Neutralisation effluent',        value: 'NaOH / Chaux',    unit: '',      formula: 'pH > 9 avant rejet',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'carbon_reg', label: 'Régénération Charbon Actif', code: '10b', group: 'adr',
    icon: <Zap size={13} />,
    rows: (inp) => {
      return [
        { id: uid(), parameter: 'Besoin charbon actif',       value: r(inp.tph * inp.carbon_conc / 1000, 1), unit: 'kg/h', formula: 'TPH × C_conc(g/L)/1000', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température régénération',   value: '700–750',       unit: '°C',   formula: 'Four rotatif charbon actif', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Rendement réactivation',     value: '90–95',         unit: '%',    formula: 'Activité vs charbon vierge', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pertes charbon (make-up)',   value: '0.1–0.2',       unit: '%/j',  formula: 'Abrasion + fines perdues',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'merrill_crowe', label: 'Merrill-Crowe (Zn)', code: '10z', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Or en solution (filtrat)',       value: r(inp.tph*inp.gold_grade*inp.leach_rec_48h/100, 1), unit: 'g/h', formula: 'TPH×Grade×Rec48h%', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Consommation zinc (Zn)',         value: '0.05–0.2',         unit: 'kg/t', formula: 'Selon teneur en solution',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Clarification requise',          value: '<1 NTU',           unit: '',     formula: 'Turbidité avant précipitation', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Déaération O₂',                 value: '<0.5',             unit: 'mg/L', formula: 'Pompe à vide / tour déaération', source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'pox', label: 'Oxydation sous Pression (POX / HPOX)', code: '09c', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      const o2_tph = conc_tph * EDF.pox.oxygenMassFraction;
      return [
        { id: uid(), parameter: 'Débit concentré flotation',    value: r(conc_tph, 1),    unit: 't/h',   formula: 'TPH × mass_pull%',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation O₂',              value: r(o2_tph, 2),      unit: 't/h',   formula: 'Conc_tph × 0.12 (typique sulfures)', source: 'Calcul', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température POX',              value: '190–220',         unit: '°C',    formula: 'POX acide (haute T)',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression partielle O₂',       value: '700–1000',        unit: 'kPa',   formula: 'Autoclave POX',                   source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Neutralisation CaCO₃',        value: '80–150',          unit: 'kg/t',  formula: 'Post-POX neutralisation',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb autoclaves (N+1)',          value: `${Math.max(1, Math.ceil(conc_tph / 30))}+1`, unit: '', formula: 'Conc_tph / 30 t/h/autoclave', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'biox', label: 'Bio-Oxydation (BIOX)', code: '09e', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      return [
        { id: uid(), parameter: 'Débit concentré alimenté',   value: r(conc_tph, 1),  unit: 't/h',  formula: 'TPH × mass_pull%',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température bio-réacteurs',  value: '37–42',         unit: '°C',   formula: 'Thermophiles mésophiles',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention',         value: '4–6',           unit: 'jours',formula: 'Testwork BIOX',              source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Air (sparge)',               value: '0.15–0.25',     unit: 'vvm',  formula: 'Volume air / vol. réacteur / min', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Neutralisation post-BIOX',   value: '50–120',        unit: 'kg/t', formula: 'CaCO₃ / Ca(OH)₂',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'roasting', label: 'Grillage (Roasting)', code: '09d', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      return [
        { id: uid(), parameter: 'Débit concentré traité',     value: r(conc_tph, 1),  unit: 't/h',   formula: 'TPH × mass_pull%',         source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température grillage',       value: '550–650',       unit: '°C',    formula: 'Grillage sulfures',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'SO₂ capté (scrubber)',       value: '>98',           unit: '%',     formula: 'Exigence environnementale', source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au post-grillage', value: '92–96',     unit: '%',     formula: 'Testwork grillage',         source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb fours (N+1)',             value: `${Math.max(1, Math.ceil(conc_tph / 20))}+1`, unit: '', formula: 'Conc_tph/20 t/h/four', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'albion', label: 'Procédé Albion', code: '09f', group: 'refractory',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const feed = inp.tph*(inp.flot_mass_pull > 0 ? inp.flot_mass_pull/100 : 0.3);
      return [
        { id: uid(), parameter: 'Débit alimentation',           value: r(feed, 1),       unit: 't/h', formula: 'Concentré flot. ultra-fin',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 alimentation (IsaMill)',   value: '10–15',          unit: 'µm',  formula: 'Ultra-fin avant Albion',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Température oxydation',        value: '85–95',          unit: '°C',  formula: 'Autothermique avec O₂',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Oxydation S cible',           value: '>90',            unit: '%',   formula: 'Testwork Albion',                 source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cn_prep', label: 'Préparation Cyanure', code: 'R01', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const cn_kg_h = inp.cyanide_cons * inp.tph;
      return [
        { id: uid(), parameter: 'Consommation NaCN',            value: r(inp.cyanide_cons, 2), unit: 'kg/t',  formula: 'Testwork LIMS',               source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit NaCN',                   value: r(cn_kg_h, 1),          unit: 'kg/h',  formula: 'NaCN_cons × TPH',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage min. (30 jours)',     value: r(cn_kg_h*24*30/1000, 0), unit: 't',   formula: 'Débit × 720h / 1000',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Concentration stock NaCN',     value: '30–50',                unit: '% m/v', formula: 'Solution stock pour dosage',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'lime_prep', label: 'Extinction de Chaux', code: 'R02', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const lime_kg_h = inp.lime_cons * inp.tph;
      return [
        { id: uid(), parameter: 'Consommation chaux',           value: r(inp.lime_cons, 2),    unit: 'kg/t',  formula: 'Testwork LIMS',               source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit chaux (CaO)',            value: r(lime_kg_h, 1),        unit: 'kg/h',  formula: 'Lime_cons × TPH',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Capacité extincteur',          value: r(lime_kg_h*EDF.lime_prep.slakerMarginFactor, 0), unit: 'kg/h', formula: `Débit × ${EDF.lime_prep.slakerMarginFactor}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage silo (7 jours)',      value: r(lime_kg_h*24*7/1000, 0), unit: 't', formula: 'Débit × 168h / 1000',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'floculant_prep', label: 'Préparation Floculant', code: 'R03', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const floc_kg_h = 20 * inp.tph / 1000;
      return [
        { id: uid(), parameter: 'Consommation floculant',       value: '15–30',                unit: 'g/t',   formula: 'Testwork floculant',           source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Débit floculant',              value: r(floc_kg_h, 2),        unit: 'kg/h',  formula: 'Floc_g/t × TPH / 1000',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume cuve préparation',      value: r(floc_kg_h*4/5, 1),    unit: 'm³',    formula: 'Prépa 0.25% en 4h',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Maturité solution',            value: '45–60',                unit: 'min',   formula: 'Temps hydratation polymère',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'flot_reagents', label: 'Réactifs Flottation', code: 'R04', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Collecteur (PAX / NaAMX)',       value: '30–50',    unit: 'g/t',  formula: 'Testwork flottation',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Moussant (MIBC)',                value: '10–20',    unit: 'g/t',  formula: 'Testwork flottation',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Déprimant (NaCN / Na₂S)',       value: '100–300',  unit: 'g/t',  formula: 'Selon minéralogie',               source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Régulateur pH (CaO)',            value: '500–1500', unit: 'g/t',  formula: 'pH alimentation 8–9',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'water_sys', label: 'Systèmes d\'Eau', code: 'U01', group: 'services',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const w = inp.tph*EDF.water_sys.waterPerTph/inp.ore_sg;
      return [
        { id: uid(), parameter: 'Consommation eau totale',      value: r(w, 0),          unit: 'm³/h', formula: 'TPH × 2.5 / SG',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Eau process (CIL/CIP)',        value: r(w*EDF.water_sys.leachShareFraction, 0), unit: 'm³/h', formula: `${Math.round(EDF.water_sys.leachShareFraction * 100)}% du total`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Recyclage eau clarifiée',      value: '>70',            unit: '%',    formula: 'Objectif récupération eau',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'compressed_air', label: 'Air Comprimé & Soufflantes', code: 'U02', group: 'services',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit air instrument',           value: r(inp.tph*EDF.compressed_air.instrumentAirPerTph, 1), unit: 'm³/min', formula: `TPH × ${EDF.compressed_air.instrumentAirPerTph}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Pression air instrument',        value: '700–800',           unit: 'kPa',    formula: 'Standard instrumentation', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Pression air service',           value: '600–700',           unit: 'kPa',    formula: 'Standard service',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'pumps', label: 'Pompes à Pulpe (Principales)', code: 'U03', group: 'services',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      return [
        { id: uid(), parameter: 'Volume pulpe à pomper',        value: r(vol, 0),          unit: 'm³/h', formula: 'TPH/SG/(%sol)',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: `Capacité pompe design (×${EDF.pumps.designMarginFactor})`, value: r(vol*EDF.pumps.designMarginFactor, 0), unit: 'm³/h', formula: `Q × ${EDF.pumps.designMarginFactor}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Revêtement pompe',             value: 'Gomme / Métal dur', unit: '',    formula: 'Selon %solides et d50',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'power_supply', label: 'Alimentation Électrique', code: '14a', group: 'electrical',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const e_sag = inp.bwi * EDF.sag.bwiCorrectionFactor * (10/Math.sqrt(inp.p80_grind) - 10/Math.sqrt(inp.f80_crush)) * EDF.sag.bondEnergyFactor * inp.tph;
      const e_ball = inp.bwi * (10/Math.sqrt(inp.p80_grind) - 10/Math.sqrt(inp.f80_crush / 5)) * inp.tph;
      const total_kw = Math.max(EDF.power_supply.minPlantKw, e_sag + e_ball) * EDF.power_supply.installedMarginFactor;
      return [
        { id: uid(), parameter: 'Puissance installée estimée',    value: r(total_kw, 0),       unit: 'kW',   formula: '(E_SAG + E_Ball) × 1.3',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: `Puissance connectée (×${EDF.power_supply.connectedMarginFactor})`, value: r(total_kw * EDF.power_supply.connectedMarginFactor, 0), unit: 'kW',  formula: `Puissance installée × ${EDF.power_supply.connectedMarginFactor}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Tension distribution principale', value: '33–66',              unit: 'kV',   formula: 'Selon poste HTB disponible',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Facteur de puissance visé',      value: '>0.92',              unit: '',     formula: 'PFC (correction fp)',               source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Groupe électrogène secours',     value: r(total_kw * EDF.power_supply.standbyFraction, 0), unit: 'kW',  formula: `Puissance × ${Math.round(EDF.power_supply.standbyFraction*100)}% (secours)`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'detox', label: 'Détoxification Résidus (INCO / SO₂/Air)', code: '12b', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const tails_tph = inp.tph;
      const so2_tph = tails_tph * EDF.detox.so2MassFraction;
      return [
        { id: uid(), parameter: 'Débit pulpe à détoxifier',    value: r(tails_tph, 0),  unit: 't/h',  formula: 'Débit résidus post-CIL',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation SO₂',            value: r(so2_tph, 3),    unit: 't/h',  formula: 'TPH × 0.3 kg/t SO₂',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation CuSO₄ (cataly.)', value: '2–5',           unit: 'g/t',  formula: 'Catalyseur INCO',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps rétention détox',       value: '1–2',            unit: 'h',    formula: 'Pratique détoxification',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'pH détox cible',              value: '8.5–9.5',        unit: '',     formula: 'Optimum SO₂/air',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'sart', label: 'SART (Cu Cyanicide)', code: 'E02', group: 'environment',
    icon: <FlaskConical size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Application SART',               value: 'Si Cu >100 ppm', unit: '',     formula: 'Cuivre lixivié > seuil',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'pH ajustement H₂SO₄',          value: '2.5–3.5',         unit: '',     formula: 'Précipitation CuCN',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Recyclage NaCN',                 value: '90–95',           unit: '%',    formula: 'Réduction conso NaCN',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'dry_stack', label: 'Résidus Filtrés (Dry Stack)', code: 'E03', group: 'environment',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const vol = inp.tph/EDF.filtration.slurryDensityTM3;
      const area = vol/EDF.filtration.specificFluxM3M2H;
      return [
        { id: uid(), parameter: 'Débit résidus filtrés',        value: r(inp.tph, 0),    unit: 't/h', formula: 'Débit projet',                  source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface filtrante totale',     value: r(area, 0),       unit: 'm²',  formula: `Vol / ${EDF.filtration.specificFluxM3M2H} m³/(m²·h)`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Humidité gâteau cible',        value: '12–16',          unit: '%',   formula: 'Résidus empilables à sec',      source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'effluent', label: 'Traitement des Effluents', code: 'E04', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Volume effluents à traiter',     value: r(inp.tph*EDF.effluent.effluentPerTph, 0), unit: 'm³/h', formula: `TPH × ${Math.round(EDF.effluent.effluentPerTph * 100)}%`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'As total cible effluent',        value: '<0.1',            unit: 'mg/L', formula: 'Réglementation eau',            source: 'Réglement', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Cu soluble cible',               value: '<0.3',            unit: 'mg/L', formula: 'Réglementation eau',            source: 'Réglement', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'thickener', label: 'Épaississeur', code: '11a', group: 'utilities',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 11_THICKENING — sized on Solids Loading Rate (SLR).
      const slr = 0.8;                                  // t/(m²·h) with flocculant (tailings)
      const area = inp.tph / slr;
      const diam = Math.sqrt(4 * area / Math.PI);
      const floc_dose = 30;                             // g/t
      const floc_kg_d = inp.tph * 24 * floc_dose / 1000;
      const floc_t_a = floc_kg_d * 365 * inp.availability / 100 / 1000;
      return [
        cr('Débit solides',               r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Solids Loading Rate (SLR)',   r(slr, 2),      't/(m²·h)', 'Std 0.8–1.2 avec floculant'),
        cr('Surface requise',             r(area, 0),     'm²',  'Débit / SLR'),
        cr('Diamètre épaississeur',       r(diam, 1),     'm',   '√(4A/π)'),
        cr('Dosage floculant',            r(floc_dose, 0),'g/t', 'PAM anionique 20–40 g/t'),
        cr('Consommation floculant / jour', r(floc_kg_d, 0), 'kg/j', 'TPH × 24 × dose / 1000'),
        cr('Consommation annuelle',       r(floc_t_a, 1), 't/an','× 365 × dispo%'),
        { id: uid(), parameter: '% solides UF cible', value: '55–65', unit: '% sol', formula: 'Pour pompage', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Hauteur paroi', value: '4–6', unit: 'm', formula: 'Std HRT', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Type', value: 'High-Rate Thickener (HRT)', unit: '', formula: 'Compact + floculant', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'filter', label: 'Filtre Presse', code: '11b', group: 'utilities',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const cake_density = 1.5;
      const filter_rate = 0.10;                       // t/(m²·h) dry cake specific rate
      const area_filter = inp.tph / filter_rate;
      const dry_solids_d = inp.tph * inp.availability / 100 * 24;
      return [
        cr('Débit de conception',        r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Solides secs / jour',        r(dry_solids_d, 0), 't/j', 'TPH × Dispo% × 24'),
        cr('Taux de filtration',         r(filter_rate, 2), 't/(m²·h)', 'Testwork filtration', 'Testwork'),
        cr('Surface filtrante totale',   r(area_filter, 0), 'm²', `TPH / ${EDF.thickener.specificFluxTM2H.toFixed(2)} t/(m²·h)`),
        cr('Densité gâteau',             r(cake_density, 2), 't/m³', 'Typique gâteau filtré'),
        { id: uid(), parameter: 'Humidité gâteau résiduel',     value: '15–18',              unit: '%',     formula: 'Testwork filtration',      source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de cycle',               value: '10–20',              unit: 'min',   formula: 'Typique filtre presse',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression filtration',          value: '8–12',               unit: 'bar',   formula: 'Typique filtre presse',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'tailings', label: 'Gestion Résidus (TSF)', code: '11c', group: 'utilities',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const tailings_tph = inp.tph * (1 - 0.001);
      const vol_pulp = tailings_tph / inp.ore_sg / EDF.tailings.thickenedSolidsFraction;
      return [
        { id: uid(), parameter: 'Débit résidus',                  value: r(tailings_tph, 0),  unit: 't/h',  formula: 'TPH − concentré (≈TPH)',     source: 'Calcul',    isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume pulpe résidus',           value: r(vol_pulp, 0),      unit: 'm³/h', formula: 'TPH_tail/SG/40%sol',         source: 'Calcul',    isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN résiduel avant détox',      value: '50–200',            unit: 'mg/L', formula: 'Post-lixiviation typique',   source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN résiduel cible (INCO/SO₂)', value: '<50',              unit: 'mg/L', formula: 'Réglementation ICMC',        source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Conso H₂O₂ (détox)',            value: '0.3–0.5',           unit: 'kg/t', formula: 'Pratique INCO',              source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'SO₂ (si procédé SO₂/air)',       value: '0.2–0.3',           unit: 'kg/t', formula: 'Pratique SO₂/air',           source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'CN− aval résiduel cible',        value: '<1',               unit: 'mg/L', formula: 'ICMC Gold Standard',         source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cone_tertiary', label: 'Concasseur à Cône (Tertiaire)', code: '03e', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, _phase, ctx) => {
      // Concassage tertiaire (tête fine) — Bond CWi sur la réduction secondaire→tertiaire.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1);
      const f80 = ctx?.feedF80 ?? inp.p80_secondary_mm * 1000;   // alimenté par le produit secondaire
      const p80 = inp.p80_tertiary_mm * 1000;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 25);
      const css = inp.p80_tertiary_mm * EDF.cone.cssFromStageP80Factor;
      const r80 = p80 > 0 ? f80 / p80 : 0;
      return [
        cr('Débit alimentation (design)',  r(q_design, 0),  't/h',  'Débit design concassage'),
        cr('F80 alimentation',             r(f80, 0),       'µm',   ctx?.feedF80 ? 'Produit étape amont (flux)' : 'P80 secondaire × 1000'),
        cr('P80 produit tertiaire',        r(p80, 0),       'µm',   'Entrée P80 tertiaire × 1000'),
        { id: uid(), parameter: 'Ratio de réduction R80', value: r(r80, 1), unit: '', formula: 'F80 / P80', source: 'Calcul', isCalc: true, comment: '', reference: '', isAlert: r80 > 0 && (r80 < 2 || r80 > 6) },
        cr('CSS estimé',                   r(css, 0),       'mm',   `≈${EDF.cone.cssFromStageP80Factor} × P80 tert.`),
        cr('Énergie Bond W (tertiaire)',   r(w, 3),         'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre',              r(p_shaft, 0),   'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE',          r(p_install, 0), 'kW',   'P_shaft / η_méca × (1 + 25%)'),
        { id: uid(), parameter: 'Modèle suggéré', value: 'Metso HP400 / HP500 (tête fine)', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'reclaim', label: 'Reprise Minerai (Reclaim)', code: '01a', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const tph_d = inp.tph * EDF.reclaim.designMarginFactor;
      return [
        { id: uid(), parameter: 'Capacité convoyeur reprise',    value: r(tph_d, 0),       unit: 't/h',  formula: 'TPH × 1.25',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage tampon (live)',        value: r(inp.tph * 8, 0), unit: 't',    formula: 'TPH × 8h stockage',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Granulométrie max alimentation',value: r(inp.f80_crush / 1000 * 3, 0), unit: 'mm', formula: 'F80×3',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse courroie convoyeur',    value: '1.5–2.5',         unit: 'm/s',  formula: 'Typique convoyage',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'scalper', label: 'Crible de Précriblage (Scalper)', code: '02', group: 'feed',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité criblage',      value: r(inp.tph * EDF.scalper.designMarginFactor, 0), unit: 't/h', formula: `TPH × ${EDF.scalper.designMarginFactor}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',    value: '50–150',            unit: 'mm',  formula: 'Selon circuit',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Surface efficace',       value: r(inp.tph / 30, 1), unit: 'm²',  formula: 'TPH / 30 t/(m²·h)',     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
    ],
  },
  {
    id: 'scalp_screen', label: 'Scalping Screen (post primaire)', code: 'SC1', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      // Template 03_CRUSHING §2 — scalping screen after the primary crusher (VSMA).
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_primary_mm;
      const pass_pct = 60;
      const undersize = q * pass_pct / 100;
      const oversize = q - undersize;
      const C = 40, M = 0.9, K = 0.8, S = 1;           // dry single-deck banana
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),         't/h', 'Sortie concasseur primaire'),
        cr('Coupure (mesh)',               r(cut, 0),       'mm',  'P80 concassage primaire'),
        cr('% passant à la coupure',       r(pass_pct, 0),  '%',   'Analyse granulo'),
        cr('Débit undersize (fin)',        r(undersize, 0), 't/h', 'Feed × % passant'),
        cr('Débit oversize (→ concasseur 2)', r(oversize, 0),'t/h','Feed − undersize'),
        cr('Capacité base C (VSMA)',       r(C, 0),         't/(m²·h)', 'Coupure sèche'),
        cr('Facteurs M·K·S',               r(M * K * S, 2), '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),      'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),         'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Type', value: 'Banana simple pont', unit: '', formula: 'Haute capacité', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Inclinaison', value: '15–20', unit: '°', formula: 'Crible incliné', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'double_deck', label: 'Double Deck Screen (post primaire/sec.)', code: 'SC2', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const top_cut = inp.p80_primary_mm;              // upper deck
      const bot_cut = inp.p80_secondary_mm;            // lower deck
      const undersize = q * EDF.scalp_screen.undersizeFraction;
      const C = 35, M = 0.9, K = 0.75, S = 0.9;        // double-deck derate on lower deck
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Sortie concassage'),
        cr('Coupure pont supérieur',       r(top_cut, 0),    'mm',  'Séparation grossière'),
        cr('Coupure pont inférieur',       r(bot_cut, 0),    'mm',  'Produit final'),
        cr('Débit produit final (u/size)', r(undersize, 0),  't/h', '≈55 % feed passant les 2 ponts'),
        cr('Débit recyclage (o/size)',     r(q - undersize, 0), 't/h', 'Retour concasseur'),
        cr('Capacité base C (VSMA)',       r(C, 0),          't/(m²·h)', 'Pont inférieur limitant'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),          'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Nombre de ponts', value: '2 (double deck)', unit: '', formula: '2 coupures', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'banana_screen', label: 'Banana Deck Screen (haute capacité)', code: 'SC3', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_hpgr_mm > 0 ? inp.p80_hpgr_mm : inp.p80_secondary_mm;
      const undersize = q * EDF.double_deck.undersizeFraction;
      const C = 55, M = 0.9, K = 0.8, S = 1;           // banana multi-slope: higher base capacity
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 26);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Circuit concassage/HPGR'),
        cr('Coupure',                      r(cut, 0),        'mm',  'Produit circuit fermé'),
        cr('Débit undersize',              r(undersize, 0),  't/h', '≈75 % passant (multi-pente)'),
        cr('Débit oversize (recyclage)',   r(q - undersize, 0), 't/h', 'Retour broyage/concassage'),
        cr('Capacité base C (VSMA banana)', r(C, 0),         't/(m²·h)', 'Multi-pente haute capacité'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3.6×7.3 = 26 m²)', r(n, 0),          'unités', 'Surface / 26 m²'),
        { id: uid(), parameter: 'Nombre de pentes', value: '3–5', unit: '', formula: 'Profil banana', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Accélération', value: '4.5–5.5', unit: 'g', formula: 'Typique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'single_deck', label: 'Single Deck Screen', code: 'SC4', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_secondary_mm;
      const undersize = q * EDF.banana_screen.undersizeFraction;
      const C = 40, M = 0.9, K = 0.8, S = 1;
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Débit design concassage'),
        cr('Coupure (mesh)',               r(cut, 0),        'mm',  'Séparation unique'),
        cr('Débit undersize',              r(undersize, 0),  't/h', '≈70 % passant'),
        cr('Débit oversize',               r(q - undersize, 0), 't/h', 'Refus'),
        cr('Capacité base C (VSMA)',       r(C, 0),          't/(m²·h)', 'Simple pont'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),          'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Type', value: 'Incliné simple pont', unit: '', formula: 'Séparation simple', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'wet_screen_hpgr', label: 'Crible humide (post-HPGR)', code: 'SC5', group: 'screening',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 04_HPGR §6 — wet screen closing the HPGR circuit.
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const q_roll = fresh * EDF.wet_screen_hpgr.recycleMarginFactor;
      const undersize = fresh;                          // steady-state pass = fresh feed
      const oversize = q_roll - undersize;
      const C = 22, M = 0.85, K = 0.75, S = 1;          // wet screening base capacity
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 26);
      return [
        cr('Débit feed crible (roll)',     r(q_roll, 0),     't/h', 'Débit total HPGR (incl. recycle)'),
        cr('Coupure crible humide',        r(inp.p80_hpgr_mm, 1), 'mm', 'P80 cible HPGR'),
        cr('Undersize (→ ball mill)',      r(undersize, 0),  't/h', 'Fresh feed (steady state)'),
        cr('Oversize (→ recyclage HPGR)',  r(oversize, 0),   't/h', 'Retour HPGR'),
        cr('Capacité base C (humide)',     r(C, 0),          't/(m²·h)', 'Wet screening'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3.6×7.3 = 26 m²)', r(n, 0),          'unités', 'Banana wet screen'),
        { id: uid(), parameter: 'Eau de lavage (spray)', value: '0.5–1.0', unit: 'm³/t', formula: 'Wet screening', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'trommels', label: 'Trommel SAG', code: '05i', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const vol_m3h = inp.tph / inp.ore_sg / EDF.sag.vesselFillFraction;
      return [
        { id: uid(), parameter: 'Débit pulpe à cribler',    value: r(vol_m3h, 0),    unit: 'm³/h', formula: `TPH/SG/${EDF.sag.vesselFillFraction}`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Ouverture maille trommel', value: '8–12',           unit: 'mm',   formula: 'Typique circuit SAG',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Angle trommel',            value: '4–6',            unit: '°',    formula: 'Inclinaison standard', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'deslime', label: 'Déslimage / Cyclones de déslamage', code: '06c', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit alimentation',     value: r(inp.tph, 0), unit: 't/h', formula: 'Débit projet',          source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Coupure D50 cible',      value: '20–38',       unit: 'µm',  formula: 'Selon procédé aval',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Dilution de lavage',     value: '3–5',         unit: 'vol', formula: 'Lavage cailloux/sables', source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'heap_leach', label: 'Lixiviation en Tas (Heap Leach)', code: '09b', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const area_ha = inp.tph * inp.availability / 100 * inp.hours_per_year / 1_000_000 * 5;
      return [
        { id: uid(), parameter: 'Débit minerai empilé',          value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface empreinte (estimée)',   value: r(area_ha, 1),        unit: 'ha',    formula: 'Mt_an × 5 m² / t (approx)',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Hauteur empilage max',          value: '6–15',               unit: 'm',     formula: 'Selon géotechnique',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Taux arrosage NaCN',            value: '8–15',               unit: 'L/(m²·h)', formula: 'Application de solution',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN conc. solution',          value: '0.5–2.0',            unit: 'g/L',   formula: 'Lixiviation en tas standard',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au (oxyde typiq.)', value: '65–80',             unit: '%',     formula: 'Minerai oxydé / transiton.',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Durée de lixiviation',          value: '30–90',              unit: 'jours', formula: 'Cinétique testwork',              source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'smelt', label: 'Four de Fusion (Smelting / Induction)', code: '10c', group: 'adr',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const au_g_h = inp.tph * inp.gold_grade * inp.leach_rec_48h / 100;
      const dore_kg_d = au_g_h * 24 / 1000 / EDF.smelt.doreGoldFraction;
      return [
        { id: uid(), parameter: 'Débit doré produit',          value: r(dore_kg_d, 1),  unit: 'kg/j',  formula: `Au/j / ${EDF.smelt.doreGoldFraction} (${Math.round(EDF.smelt.doreGoldFraction*100)}% Au dans doré)`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Fréquence de fusion',         value: '1 × /j',         unit: '',      formula: 'Pratique standard',               source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Température fusion (induction)', value: '1150–1250',   unit: '°C',    formula: 'Four à induction',                source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Flux (borax + salpêtre)',     value: '5–8',            unit: '% wt',  formula: 'Séparation laitier',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pureté lingot doré',          value: '90–98',          unit: '% Au',  formula: 'Avant raffinage (Parting)',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'water_treat', label: 'Traitement Eau (WTP)', code: '12a', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const vol_m3h = inp.tph / inp.ore_sg / EDF.tailings.thickenedSolidsFraction;
      return [
        { id: uid(), parameter: 'Volume eau procédé recyclée',  value: r(vol_m3h * EDF.water_treat.recycleFraction, 0), unit: 'm³/h', formula: `Vol_pulpe × ${Math.round(EDF.water_treat.recycleFraction*100)}% retour eau`, source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Eau fraîche appoint',          value: r(vol_m3h * EDF.water_treat.makeupFraction, 0), unit: 'm³/h', formula: `Vol_pulpe × ${Math.round(EDF.water_treat.makeupFraction*100)}% make-up`,        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'pH rejet eaux usées',          value: '>7.0',              unit: '',     formula: 'Exigence permis eau',             source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'CN− total rejet aqueux',       value: '<0.5',              unit: 'mg/L', formula: 'ICMC / réglementation locale',   source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'As rejet aqueux',              value: '<0.1',              unit: 'mg/L', formula: 'Réglementation locale',           source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'process_control', label: 'Contrôle de Procédé / DCS', code: '13a', group: 'instruments',
    icon: <Gauge size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Nb boucles de contrôle estimé',    value: r(inp.tph / 10 + 50, 0), unit: '',    formula: 'TPH/10 + 50 (approx.)',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Type DCS',                         value: 'DCS / PLC hybride',      unit: '',    formula: 'Standard industrie',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Redondance système critique',      value: '1oo2 / 2oo3',            unit: '',    formula: 'Sécurité SIL-2',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Alarmes de procédé (estimé)',      value: r(inp.tph / 10 + 100, 0), unit: '',    formula: 'Typique usine de traitement', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Disponibilité DCS visée',          value: '>99.9',                  unit: '%',   formula: 'Redondance système',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'online_analyzer', label: 'Analyseurs En Ligne', code: '13b', group: 'instruments',
    icon: <Gauge size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Analyseur élémentaire on-stream',  value: 'Courier / Geoscan',   unit: '',     formula: 'XRF en ligne (Outotec/Panalyt.)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Granulométrie en ligne',           value: 'PSI / Lasentec',      unit: '',     formula: 'Contrôle circuit de broyage',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Densité pulpe (nucléaire)',        value: '1.5–2.0',             unit: 't/m³', formula: 'Capteur gamma densitomètre',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'pH en ligne CIL',                  value: '10.5–11.0',           unit: '',     formula: 'Contrôle pH lixiviation',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'DO en ligne CIL',                  value: '>6',                  unit: 'mg/L', formula: 'Sonde ORP/O₂ en ligne',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Débitmètre magnétique (EMF)',       value: 'Krohne / Endress',    unit: '',     formula: 'Débit pulpe principaux',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'vfd', label: 'Variateurs de Fréquence (VFD/ASD)', code: '14b', group: 'electrical',
    icon: <Zap size={13} />,
    rows: (_inp) => [
      { id: uid(), parameter: 'Moteurs critiques avec VFD',        value: 'SAG, Ball, Pompes CIL', unit: '',   formula: 'Économies énergie / contrôle',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Standard isolation moteurs',        value: 'NEMA MG-1 Partie 31',   unit: '',   formula: 'Moteurs avec VFD',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Économie énergie estimée (VFD)',    value: '10–20',                 unit: '%',  formula: 'vs. démarrage direct',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
];

/**
 * SECTIONS_RAW contenait historiquement 27 équipements définis DEUX fois (un
 * premier jeu puis un jeu affiné). Un dédoublonnage silencieux « le dernier
 * gagne » masquait le problème : les 27 premières définitions étaient du code
 * mort, et les éditer n'avait aucun effet visible — un piège de maintenance.
 *
 * Les doublons ont été supprimés (définition affinée conservée, à la position
 * d'origine pour ne pas changer l'ordre d'affichage). On garde ici un contrôle
 * qui ÉCHOUE BRUYAMMENT si un doublon réapparaît, au lieu de l'absorber.
 */
export const SECTIONS: EquipSection[] = SECTIONS_RAW;

if (import.meta.env.DEV) {
  const seen = new Set<string>();
  const dupes = SECTIONS_RAW.map(s => s.id).filter(id => (seen.has(id) ? true : (seen.add(id), false)));
  if (dupes.length > 0) {
    throw new Error(
      `Critères : id d'équipement dupliqué(s) dans SECTIONS_RAW — ${[...new Set(dupes)].join(', ')}. ` +
      `Chaque équipement doit être défini une seule fois (une définition en double serait ignorée silencieusement).`,
    );
  }
}

// Group registry — matches screenshot order
export const GROUP_META: Record<string, { label: string; icon: React.ReactNode }> = {
  general:        { label: 'Général',                    icon: <BarChart3 size={13}/> },
  feed:           { label: 'Manutention Minerai',        icon: <Layers size={13}/> },
  crushing:       { label: 'Concassage',                 icon: <Zap size={13}/> },
  grinding:       { label: 'Broyage',                    icon: <RefreshCw size={13}/> },
  regrind:        { label: 'Rebroyage',                  icon: <Gauge size={13}/> },
  screening:      { label: 'Tamisage / Criblage',       icon: <Wind size={13}/> },
  classification: { label: 'Classification',             icon: <Wind size={13}/> },
  physep:         { label: 'Séparation Physique',        icon: <Layers size={13}/> },
  treatment:      { label: 'Traitement',                 icon: <FlaskConical size={13}/> },
  refractory:     { label: 'Oxydation Réfractaire',      icon: <RefreshCw size={13}/> },
  reagents:       { label: 'Réactifs',                   icon: <FlaskConical size={13}/> },
  services:       { label: 'Services & Utilités',        icon: <Zap size={13}/> },
  environment:    { label: 'Environnement',              icon: <Droplets size={13}/> },
  slsep:          { label: 'Séparation Solide-Liquide',  icon: <Layers size={13}/> },
};

// ─── Default active equipment ─────────────────────────────────────────────────

export const DEFAULT_ACTIVE: Record<string, boolean> = {
  general: true,
  // Manutention Minerai
  grizzly: true, apron: true, conveyor: true, stockpile: true,
  silo: false, sampling: true, dedusting: true,
  // Concassage
  jaw: false, gyratory: false, cone: true, cone_tertiary: false, hpgr: false, pebble_crusher: false,
  // Broyage
  sag: true, ag: false, ball: true, rod: false,
  // Rebroyage
  vertimill: false, isamill: false, towermill: false,
  // Classification
  hydrocyclone: true, screen: false,
  // Séparation Physique
  xrt: false, dms: false, magsep: false, flash_flot: false, column_flot: false,
  // Traitement
  gravity: true, intensive_leach: true, flotation: false,
  trash_screen: true, preleach_thickener: true, cil: true, adr: true,
  o2_plant: true, interstage_screens: true, acid_wash: true, carbon_reg: true, merrill_crowe: false,
  // Oxydation Réfractaire
  pox: false, biox: false, roasting: false, albion: false,
  // Réactifs
  cn_prep: true, lime_prep: true, floculant_prep: true, flot_reagents: false,
  // Services & Utilités
  water_sys: true, compressed_air: true, pumps: true, power_supply: true,
  // Environnement
  detox: true, sart: false, dry_stack: false, effluent: true,
  // Séparation Solide-Liquide
  thickener: true, filter: false, tailings: true,
};
