// ─────────────────────────────────────────────────────────────────────────────
// Rendu binaire .docx du rapport NI 43-101 — isole la bibliothèque `docx`.
//
// Le modèle (reportDoc.ts) est pur et testé ; ici on ne fait QUE mapper ce modèle
// vers un Document Word et déclencher le téléchargement. Un filigrane BROUILLON
// est ajouté tant que le rapport n'est pas complet ; les sections signées portent
// leur PQ et sa date, conformément au Form 43-101F1.
// ─────────────────────────────────────────────────────────────────────────────

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import type { ReportDocModel } from './reportDoc';

function titleBlock(model: ReportDocModel): Paragraph[] {
  const { meta, draft } = model;
  const blocks: Paragraph[] = [
    new Paragraph({ text: meta.projectName, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Rapport technique NI 43-101', bold: true, size: 28 })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Projet : ${meta.projectCode}`, size: 24 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Date d'effet : ${meta.effectiveDate ?? '—'}`, size: 24 })],
    }),
  ];
  if (draft) {
    blocks.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [new TextRun({ text: 'BROUILLON — NON CONFORME POUR DÉPÔT', bold: true, color: 'B00020', size: 28 })],
    }));
  }
  return blocks;
}

function sectionBlocks(model: ReportDocModel): Paragraph[] {
  const out: Paragraph[] = [];
  for (const s of model.sections) {
    out.push(new Paragraph({ text: `${s.number} — ${s.title}`, heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }));

    // Ligne PQ / signature.
    if (s.signed) {
      out.push(new Paragraph({
        children: [new TextRun({ text: `Personne qualifiée : ${s.qp} — ${s.date}`, italics: true, size: 20, color: '3C6E47' })],
      }));
    } else if (s.hasContent) {
      out.push(new Paragraph({
        children: [new TextRun({ text: 'Section non signée par une PQ', italics: true, size: 20, color: 'B00020' })],
      }));
    }

    // Contenu.
    if (s.paragraphs.length === 0) {
      out.push(new Paragraph({ children: [new TextRun({ text: 'À compléter.', italics: true, color: '888888' })] }));
    } else {
      for (const p of s.paragraphs) out.push(new Paragraph({ text: p }));
    }
  }
  return out;
}

/** Construit le Document Word à partir du modèle (pas de téléchargement). */
export function buildDocxDocument(model: ReportDocModel): Document {
  return new Document({
    creator: 'MetalFlow Pro',
    title: `NI 43-101 — ${model.meta.projectCode}`,
    sections: [{ properties: {}, children: [...titleBlock(model), ...sectionBlocks(model)] }],
  });
}

/** Sérialise le rapport en blob .docx. */
export function reportDocxBlob(model: ReportDocModel): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(model));
}

/** Génère et télécharge le .docx (navigateur). */
export async function downloadReportDocx(model: ReportDocModel, filename: string): Promise<void> {
  const blob = await reportDocxBlob(model);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
