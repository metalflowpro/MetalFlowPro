import {
  Settings, Layers, Zap, Droplets,
  FlaskConical, Wind, Gauge, RefreshCw,
} from 'lucide-react';
import { r } from './model';

// ─── Guided design assistant (deterministic — no external AI/key) ──────────────
// A step-by-step wizard that walks the engineer through the metallurgical circuit
// stage by stage, recommends equipment from the project data (throughput, hardness,
// GRG, sulphides, preg-robbing carbon, leach recovery) and — once applied — rebuilds
// the design-criteria table & flow order from the choices made here.

export interface MetSignals {
  tph: number; bwi: number; f80RomMm: number;
  grg: number; flotRec: number; leachRec: number;
  sulfide: number; cOrg: number; auFree: number;
  refractory: boolean; pregRobbing: boolean; hard: boolean; highTonnage: boolean;
}

interface WizardOption {
  key: string;
  ids: string[];                 // SECTION ids activated by this choice
  label: string;
  hint: string;
  recommend?: (s: MetSignals, chosen: Set<string>) => boolean;
  why?: (s: MetSignals) => string;
}

export interface WizardStep {
  id: string;
  title: string;
  stage: string;
  icon: React.ReactNode;
  intro: (s: MetSignals) => string;
  multi: boolean;
  optional?: boolean;
  options: WizardOption[];
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'feed', title: 'Manutention du minerai', stage: 'Alimentation', icon: <Layers size={15} />,
    multi: true,
    intro: s => `Le minerai ROM arrive à ${r(s.tph, 0)} t/h (F80 ≈ ${r(s.f80RomMm, 0)} mm). On prépare l'alimentation avant concassage.`,
    options: [
      { key: 'grizzly', ids: ['grizzly'], label: 'Grizzly / Scalpeur ROM', hint: 'Écarte les fines et les blocs hors-taille avant le concasseur', recommend: () => true, why: () => 'Standard sur tout circuit à concassage primaire' },
      { key: 'apron', ids: ['apron'], label: 'Alimentateur à tablier', hint: 'Alimente le concasseur à débit régulé', recommend: () => true },
      { key: 'stockpile', ids: ['stockpile', 'reclaim'], label: 'Stockpile + reprise', hint: 'Tampon entre concassage et broyage', recommend: () => true },
      { key: 'sampling', ids: ['sampling'], label: 'Échantillonnage & pesée', hint: 'Contrôle métallurgique et comptabilité minerai', recommend: () => true },
    ],
  },
  {
    id: 'primary', title: 'Concassage primaire', stage: 'Concassage', icon: <Zap size={15} />,
    multi: false,
    intro: s => `Réduire le ROM (F80 ${r(s.f80RomMm, 0)} mm) à une taille transportable vers le broyage.`,
    options: [
      { key: 'gyratory', ids: ['gyratory'], label: 'Concasseur giratoire', hint: 'Très gros débits, minerai dur', recommend: s => s.highTonnage, why: s => `Débit élevé (${r(s.tph, 0)} t/h ≥ 800) → giratoire` },
      { key: 'jaw', ids: ['jaw'], label: 'Concasseur à mâchoires', hint: 'Débits modérés, plus simple', recommend: s => !s.highTonnage, why: s => `Débit modéré (${r(s.tph, 0)} t/h < 800) → mâchoires` },
    ],
  },
  {
    id: 'secondary', title: 'Criblage & concassage secondaire', stage: 'Concassage', icon: <Wind size={15} />,
    multi: true, optional: true,
    intro: () => `Cribler le produit primaire et recirculer l'oversize vers un concasseur à cône (circuit fermé).`,
    options: [
      { key: 'scalp', ids: ['scalp_screen'], label: 'Scalping screen (post-primaire)', hint: 'Sépare le passant avant concassage secondaire', recommend: () => true },
      { key: 'banana', ids: ['banana_screen'], label: 'Banana deck (haute capacité)', hint: 'Grand débit, criblage efficace', recommend: s => s.highTonnage, why: () => 'Fort tonnage → crible banana haute capacité' },
      { key: 'double', ids: ['double_deck'], label: 'Double deck screen', hint: 'Deux coupures granulométriques', recommend: () => false },
      { key: 'cone', ids: ['cone'], label: 'Concasseur à cône (secondaire)', hint: 'Réduit l\'oversize du crible', recommend: () => true },
      { key: 'cone_tertiary', ids: ['cone_tertiary'], label: 'Concasseur à cône (tertiaire)', hint: 'Tête fine avant broyage à boulets (circuit 3 étages)', recommend: s => s.hard, why: s => `Minerai dur (BWi ${r(s.bwi, 1)}) → étage tertiaire pour alléger le broyage` },
      { key: 'single', ids: ['single_deck'], label: 'Single deck screen', hint: 'Une seule coupure', recommend: () => false },
    ],
  },
  {
    id: 'grinding', title: 'Circuit de broyage', stage: 'Broyage', icon: <RefreshCw size={15} />,
    multi: false,
    intro: s => `Choisir le circuit de broyage selon la dureté (BWi ${r(s.bwi, 1)} kWh/t) et le débit. C'est le poste le plus énergivore.`,
    options: [
      { key: 'hpgr', ids: ['hpgr', 'wet_screen_hpgr', 'ball'], label: 'HPGR + Broyeur à boulets', hint: 'Le plus économe en énergie pour minerai dur', recommend: s => s.hard, why: s => `Minerai dur (BWi ${r(s.bwi, 1)} ≥ 16) → HPGR économe en énergie` },
      { key: 'sab', ids: ['sag', 'trommels', 'ball'], label: 'SAG + Boulets (SAB)', hint: 'Circuit robuste pour gros tonnages', recommend: s => !s.hard && s.highTonnage, why: () => 'Tonnage élevé, dureté modérée → circuit SAG standard' },
      { key: 'rodball', ids: ['rod', 'ball'], label: 'Barres + Boulets', hint: 'Petits débits, produit régulier', recommend: s => !s.hard && !s.highTonnage, why: () => 'Débit modéré → barres + boulets' },
      { key: 'agball', ids: ['ag', 'ball'], label: 'AG + Boulets', hint: 'Minerai compétent, sans média', recommend: () => false },
    ],
  },
  {
    id: 'classification', title: 'Classification', stage: 'Classification', icon: <Wind size={15} />,
    multi: true,
    intro: () => `Fermer le circuit de broyage et viser le P80 de libération issu de la PSD testwork (LIMS).`,
    options: [
      { key: 'cyclone', ids: ['hydrocyclone'], label: 'Hydrocyclones', hint: 'Classification standard en circuit fermé', recommend: () => true },
      { key: 'deslime', ids: ['deslime'], label: 'Déslimage', hint: 'Retire les ultrafines avant récupération', recommend: () => false },
      { key: 'fine_screen', ids: ['screen'], label: 'Cribles vibrants fins', hint: 'Alternative aux cyclones (fine screening)', recommend: () => false },
    ],
  },
  {
    id: 'route', title: 'Route de récupération de l\'or', stage: 'Récupération', icon: <FlaskConical size={15} />,
    multi: false,
    intro: s => `Route métallurgique selon GRG ${r(s.grg, 0)} %, sulfures ${r(s.sulfide, 1)} % S, C.org ${r(s.cOrg, 2)} %, or libre ${r(s.auFree, 0)} %, récup. lixiviation ${r(s.leachRec, 0)} %.${s.refractory ? ' ⚠ Minerai réfractaire détecté.' : ''}`,
    options: [
      { key: 'flot_pox', ids: ['flotation', 'pox', 'cil', 'adr'], label: 'Flottation + POX + CIL', hint: 'Prétraitement oxydant du concentré réfractaire', recommend: s => s.refractory && s.sulfide >= 3, why: () => 'Réfractaire sulfuré → oxydation sous pression avant lixiviation' },
      { key: 'grav_flot_cil', ids: ['gravity', 'intensive_leach', 'flotation', 'cil', 'adr'], label: 'Gravité + Flottation + Lixiviation (CIL)', hint: 'Or grossier récupéré en gravité, or associé aux sulfures en flottation, puis lixiviation CIL du reste — récupération globale maximale', recommend: s => !s.refractory && s.grg >= 20 && s.sulfide > 1.5, why: s => `GRG ${r(s.grg, 0)} % (or grossier) + or sulfuré (${r(s.sulfide, 1)} % S) → gravité + flottation + CIL, récupération maximale` },
      { key: 'grav_cil', ids: ['gravity', 'intensive_leach', 'cil', 'adr'], label: 'Gravimétrie + CIL', hint: 'Récupère l\'or grossier libre puis lixivie le reste (peu de sulfures)', recommend: s => !s.refractory && s.grg >= 20 && s.sulfide <= 1.5, why: s => `GRG élevé (${r(s.grg, 0)} % ≥ 20), peu de sulfures → gravité + CIL` },
      { key: 'flot_regrind', ids: ['flotation', 'cil', 'adr'], label: 'Flottation + Rebroyage + Leach', hint: 'Concentre l\'or associé aux sulfures puis rebroie', recommend: s => !s.refractory && s.sulfide > 1.5 && s.leachRec < 85, why: () => 'Or associé aux sulfures, lixiviation directe faible → flottation' },
      { key: 'direct_cil', ids: ['cil', 'adr'], label: 'Lixiviation directe CIL / CIP', hint: 'Le plus simple quand la lixiviation est bonne', recommend: () => true, why: s => `Bonne récup. lixiviation (${r(s.leachRec, 0)} %) → CIL direct` },
      { key: 'flot_roast', ids: ['flotation', 'roasting', 'cil', 'adr'], label: 'Flottation + Rôtissage + CIL', hint: 'Alternative au POX pour réfractaire', recommend: () => false },
      { key: 'heap', ids: ['heap_leach'], label: 'Lixiviation en tas', hint: 'Basse teneur / oxyde, faible CAPEX', recommend: () => false },
    ],
  },
  {
    id: 'regrind', title: 'Rebroyage', stage: 'Rebroyage', icon: <Gauge size={15} />,
    multi: false, optional: true,
    intro: () => `Rebroyer le concentré (ou l'underflow) pour libérer l'or fin avant lixiviation. Pertinent surtout après flottation.`,
    options: [
      { key: 'vertimill', ids: ['vertimill'], label: 'Vertimill', hint: 'Rebroyage fin efficace (P80 ~30–45 µm)', recommend: (_s, chosen) => chosen.has('flotation'), why: () => 'Concentré de flottation à rebroyer → Vertimill' },
      { key: 'isamill', ids: ['isamill'], label: 'IsaMill', hint: 'Broyage ultrafin (P80 ~10–15 µm)', recommend: () => false },
      { key: 'towermill', ids: ['towermill'], label: 'Tower Mill', hint: 'Rebroyage moyen', recommend: () => false },
      { key: 'none', ids: [], label: 'Aucun rebroyage', hint: 'Circuit sans rebroyage', recommend: () => true },
    ],
  },
  {
    id: 'dewatering', title: 'Séparation solide-liquide', stage: 'Épaississage', icon: <Droplets size={15} />,
    multi: true,
    intro: () => `Épaissir la pulpe avant lixiviation et gérer l'eau des résidus.`,
    options: [
      { key: 'preleach', ids: ['preleach_thickener'], label: 'Épaississeur pré-lixiviation', hint: 'Ajuste la densité avant CIL', recommend: () => true },
      { key: 'tails_thick', ids: ['thickener'], label: 'Épaississeur de résidus', hint: 'Récupère l\'eau de procédé', recommend: () => true },
      { key: 'filter', ids: ['filter', 'dry_stack'], label: 'Filtre presse (dry stack)', hint: 'Résidus filtrés empilés à sec', recommend: () => false },
      { key: 'tsf', ids: ['tailings'], label: 'Gestion résidus (TSF)', hint: 'Parc à résidus conventionnel', recommend: () => true },
    ],
  },
  {
    id: 'adr', title: 'ADR & Raffinage', stage: 'ADR', icon: <Zap size={15} />,
    multi: true,
    intro: () => `Désorption du charbon, électrolyse et fusion pour produire le doré.`,
    options: [
      { key: 'adr', ids: ['adr'], label: 'ADR — Élution & électrolyse', hint: 'Désorption + electrowinning', recommend: () => true },
      { key: 'interstage', ids: ['interstage_screens'], label: 'Tamis interstades', hint: 'Retiennent le charbon dans les cuves', recommend: () => true },
      { key: 'acid', ids: ['acid_wash'], label: 'Lavage acide du charbon', hint: 'Retire les carbonates du charbon', recommend: () => true },
      { key: 'regen', ids: ['carbon_reg'], label: 'Régénération charbon (four)', hint: 'Réactive le charbon usé', recommend: () => true },
      { key: 'smelt', ids: ['smelt'], label: 'Four de fusion', hint: 'Coule les lingots doré', recommend: () => true },
    ],
  },
  {
    id: 'services', title: 'Réactifs, services & environnement', stage: 'Services', icon: <Settings size={15} />,
    multi: true,
    intro: () => `Infrastructures de support et conformité environnementale.`,
    options: [
      { key: 'cn', ids: ['cn_prep'], label: 'Préparation cyanure', hint: 'Dosage NaCN', recommend: () => true },
      { key: 'lime', ids: ['lime_prep'], label: 'Extinction de chaux', hint: 'Contrôle du pH', recommend: () => true },
      { key: 'floc', ids: ['floculant_prep'], label: 'Préparation floculant', hint: 'Aide à l\'épaississage', recommend: () => true },
      { key: 'detox', ids: ['detox'], label: 'Détoxification cyanure', hint: 'Destruction du CN⁻ avant rejet', recommend: () => true },
      { key: 'sart', ids: ['sart'], label: 'SART (Cu cyanicide)', hint: 'Récupère le cuivre et le cyanure', recommend: () => false },
      { key: 'utils', ids: ['water_sys', 'pumps', 'power_supply'], label: 'Eau, pompes & électricité', hint: 'Services généraux d\'usine', recommend: () => true },
    ],
  },
];

// Recommended selection for every step, accumulating chosen ids so later steps can react
// to earlier choices (e.g. regrind recommended only when flotation was picked upstream).
export function computeWizardDefaults(s: MetSignals): Record<string, string[]> {
  const choices: Record<string, string[]> = {};
  const chosen = new Set<string>();
  for (const step of WIZARD_STEPS) {
    let selKeys: string[] = [];
    if (step.multi) {
      selKeys = step.options.filter(o => o.recommend?.(s, chosen)).map(o => o.key);
    } else {
      const rec = step.options.find(o => o.recommend?.(s, chosen));
      const pick = rec ?? (step.optional ? undefined : step.options[0]);
      if (pick) selKeys = [pick.key];
    }
    choices[step.id] = selKeys;
    for (const k of selKeys) WIZARD_STEPS.find(w => w.id === step.id)?.options.find(o => o.key === k)?.ids.forEach(id => chosen.add(id));
  }
  return choices;
}

// Build the active-equipment set + process-ordered flow from the wizard choices.
export function buildFlowFromChoices(choices: Record<string, string[]>): { order: string[]; activeIds: Set<string> } {
  const order: string[] = [];
  const activeIds = new Set<string>();
  for (const step of WIZARD_STEPS) {
    const sel = choices[step.id] ?? [];
    for (const o of step.options) {
      if (!sel.includes(o.key)) continue;
      for (const id of o.ids) { activeIds.add(id); if (!order.includes(id)) order.push(id); }
    }
  }
  return { order, activeIds };
}
