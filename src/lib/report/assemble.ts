// ─────────────────────────────────────────────────────────────────────────────
// Assemblage du rapport — structure Form 43-101F1 (25 items).
//
// Le NI 43-101 impose l'ordre et le contenu des sections via le Form 43-101F1.
// Ce module fournit la liste canonique des items, évalue l'état de complétude de
// chaque section (contenu présent, QP assigné, date) et calcule l'avancement.
// C'est le squelette que la page NI 43-101 remplit et que l'export ordonne.
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

/** Un item du Form 43-101F1. */
export interface ReportItem {
  number: number;
  key: string;
  title: string;
}

/** Liste canonique et ordonnée des 25 items (+ références). */
export const FORM_43101F1_ITEMS: ReportItem[] = [
  { number: 1, key: 'title', title: 'Page de titre' },
  { number: 2, key: 'reliance', title: 'Appui sur d\'autres experts' },
  { number: 3, key: 'property', title: 'Description et localisation de la propriété' },
  { number: 4, key: 'access', title: 'Accès, climat, ressources locales, infrastructure' },
  { number: 5, key: 'history', title: 'Historique' },
  { number: 6, key: 'geology', title: 'Contexte géologique et minéralisation' },
  { number: 7, key: 'deposit', title: 'Types de gisement' },
  { number: 8, key: 'exploration', title: 'Exploration' },
  { number: 9, key: 'drilling', title: 'Forages' },
  { number: 10, key: 'sampling', title: 'Préparation, analyses et sécurité des échantillons' },
  { number: 11, key: 'dataverif', title: 'Vérification des données' },
  { number: 12, key: 'metallurgy', title: 'Traitement minéralurgique et essais métallurgiques' },
  { number: 13, key: 'resource', title: 'Estimation des ressources minérales' },
  { number: 14, key: 'reserve', title: 'Estimation des réserves minérales' },
  { number: 15, key: 'mining', title: 'Méthodes minières' },
  { number: 16, key: 'recovery', title: 'Méthodes de récupération' },
  { number: 17, key: 'infrastructure', title: 'Infrastructure du projet' },
  { number: 18, key: 'market', title: 'Études de marché et contrats' },
  { number: 19, key: 'environmental', title: 'Environnement, permis, impact social' },
  { number: 20, key: 'capexopex', title: 'Coûts d\'investissement et d\'exploitation' },
  { number: 21, key: 'economics', title: 'Analyse économique' },
  { number: 22, key: 'adjacent', title: 'Propriétés adjacentes' },
  { number: 23, key: 'otherdata', title: 'Autres données et informations pertinentes' },
  { number: 24, key: 'interpretation', title: 'Interprétation et conclusions' },
  { number: 25, key: 'recommendations', title: 'Recommandations' },
];

/** État d'une section tel que renseigné dans l'app. */
export interface SectionState {
  hasContent: boolean;
  qpId: string | null;
  date: string | null;
}

/** Item enrichi de son état et de sa complétude. */
export interface AssembledSection extends ReportItem {
  hasContent: boolean;
  qpId: string | null;
  date: string | null;
  /** Complet = contenu + QP + date. */
  complete: boolean;
}

/** Une section est complète si elle a du contenu, un QP et une date. */
export function assembleReport(states: Record<string, SectionState>): AssembledSection[] {
  return FORM_43101F1_ITEMS.map(item => {
    const s = states[item.key] ?? { hasContent: false, qpId: null, date: null };
    return {
      ...item,
      hasContent: s.hasContent,
      qpId: s.qpId,
      date: s.date,
      complete: s.hasContent && !!s.qpId && !!s.date,
    };
  });
}

/** Synthèse d'avancement du rapport. */
export interface ReportReadiness {
  total: number;
  complete: number;
  /** Fraction 0–1. */
  pct: number;
  /** Titres des items incomplets. */
  missing: string[];
  /** Tous les items renseignés (contenu) ont-ils QP + date ? */
  allSignedOff: boolean;
}

/** Calcule l'avancement du rapport à partir des sections assemblées. */
export function reportReadiness(sections: AssembledSection[]): ReportReadiness {
  const total = sections.length;
  const complete = sections.filter(s => s.complete).length;
  const missing = sections.filter(s => !s.complete).map(s => `${s.number}. ${s.title}`);
  const withContent = sections.filter(s => s.hasContent);
  const allSignedOff = withContent.length > 0 && withContent.every(s => !!s.qpId && !!s.date);
  return { total, complete, pct: total > 0 ? complete / total : 0, missing, allSignedOff };
}
