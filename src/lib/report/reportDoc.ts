// ─────────────────────────────────────────────────────────────────────────────
// Modèle de document NI 43-101 pour l'export Word/DOCX un-clic.
//
// La page NI 43-101 renseigne, par section, un contenu narratif, une PQ
// signataire (`validated_by`) et une date (`validated_at`). Ce module PUR
// normalise ces sections en un modèle de document ordonné et calcule la RÈGLE
// D'EXPORT réglementaire (V7) : aucun contenu narratif ne peut figurer dans le
// livrable sans être signé par une Personne Qualifiée. Le rendu binaire (.docx)
// est isolé dans `docxRenderer.ts` — ici tout est testable sans navigateur.
// ─────────────────────────────────────────────────────────────────────────────

/** Section telle que renseignée dans l'app (avant normalisation). */
export interface DocSectionInput {
  /** Code de section, ex. « S1 ». */
  number: string;
  title: string;
  content: string;
  /** PQ signataire (`validated_by`), null si non signée. */
  qp: string | null;
  /** Date de signature (`validated_at`), null si non signée. */
  date: string | null;
  /** Section obligatoire au sens du rapport. */
  required?: boolean;
}

export interface ReportDocMeta {
  projectName: string;
  projectCode: string;
  /** Date d'effet du rapport (obligatoire NI 43-101), null si absente. */
  effectiveDate: string | null;
}

export interface DocSection {
  number: string;
  title: string;
  /** Contenu découpé en paragraphes non vides. */
  paragraphs: string[];
  qp: string | null;
  date: string | null;
  required: boolean;
  hasContent: boolean;
  /** Contenu présent ET signé (PQ + date). */
  signed: boolean;
}

export interface ReportDocModel {
  meta: ReportDocMeta;
  sections: DocSection[];
  totalSections: number;
  withContent: number;
  signed: number;
  /** Sections AVEC contenu mais NON signées — bloquent l'export (règle V7). */
  unsignedWithContent: string[];
  /** Sections obligatoires SANS contenu — marquent le document « brouillon ». */
  missingRequired: string[];
  /** Vrai si aucun contenu non signé : l'export réglementaire est autorisé. */
  exportable: boolean;
  /** Vrai si des obligatoires manquent ou date d'effet absente → filigrane BROUILLON. */
  draft: boolean;
}

/** Découpe un contenu en paragraphes (séparateurs = lignes vides ou simples). */
export function splitParagraphs(content: string): string[] {
  return content
    .split(/\n{1,}/)
    .map(p => p.trim())
    .filter(Boolean);
}

/** Construit le modèle de document NI 43-101 à partir des sections renseignées. */
export function buildReportDocModel(meta: ReportDocMeta, input: DocSectionInput[]): ReportDocModel {
  const sections: DocSection[] = input.map(s => {
    const hasContent = !!s.content && s.content.trim().length > 0;
    return {
      number: s.number,
      title: s.title,
      paragraphs: splitParagraphs(s.content ?? ''),
      qp: s.qp,
      date: s.date,
      required: !!s.required,
      hasContent,
      signed: hasContent && !!s.qp && !!s.date,
    };
  });

  const withContent = sections.filter(s => s.hasContent);
  const unsignedWithContent = withContent.filter(s => !s.signed).map(s => `${s.number} — ${s.title}`);
  const missingRequired = sections.filter(s => s.required && !s.hasContent).map(s => `${s.number} — ${s.title}`);

  const exportable = unsignedWithContent.length === 0;
  const draft = missingRequired.length > 0 || !meta.effectiveDate;

  return {
    meta,
    sections,
    totalSections: sections.length,
    withContent: withContent.length,
    signed: withContent.filter(s => s.signed).length,
    unsignedWithContent,
    missingRequired,
    exportable,
    draft,
  };
}
