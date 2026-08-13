import { describe, it, expect } from 'vitest';
import { buildReportDocModel, splitParagraphs, type DocSectionInput, type ReportDocMeta } from './reportDoc';

const META: ReportDocMeta = { projectName: 'Morrison', projectCode: 'MOR', effectiveDate: '2026-08-13' };

function sec(partial: Partial<DocSectionInput>): DocSectionInput {
  return {
    number: partial.number ?? 'S1',
    title: partial.title ?? 'Résumé',
    content: partial.content ?? '',
    qp: partial.qp ?? null,
    date: partial.date ?? null,
    required: partial.required ?? false,
  };
}

describe('splitParagraphs', () => {
  it('découpe sur les sauts de ligne et ignore le vide', () => {
    expect(splitParagraphs('a\n\nb\n c \n')).toEqual(['a', 'b', 'c']);
    expect(splitParagraphs('   ')).toEqual([]);
  });
});

describe('buildReportDocModel — structure', () => {
  it('conserve l\'ordre et le nombre des sections', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1' }), sec({ number: 'S2' }), sec({ number: 'S3' }),
    ]);
    expect(m.sections.map(s => s.number)).toEqual(['S1', 'S2', 'S3']);
    expect(m.totalSections).toBe(3);
  });

  it('compte contenu et signatures', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1', content: 'texte', qp: 'J. Roy', date: '2026-08-10' }),
      sec({ number: 'S2', content: 'texte' }), // contenu non signé
      sec({ number: 'S3', content: '' }),      // vide
    ]);
    expect(m.withContent).toBe(2);
    expect(m.signed).toBe(1);
  });
});

describe('buildReportDocModel — règle d\'export V7', () => {
  it('bloque l\'export si une section a du contenu non signé', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1', content: 'ok', qp: 'PQ', date: '2026-08-10' }),
      sec({ number: 'S8', title: 'Forage', content: 'données forage' }), // non signée
    ]);
    expect(m.exportable).toBe(false);
    expect(m.unsignedWithContent).toContain('S8 — Forage');
  });

  it('autorise l\'export quand tout contenu est signé', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1', content: 'ok', qp: 'PQ', date: '2026-08-10' }),
      sec({ number: 'S2', content: '' }), // pas de contenu → n'exige pas de signature
    ]);
    expect(m.exportable).toBe(true);
    expect(m.unsignedWithContent).toHaveLength(0);
  });
});

describe('buildReportDocModel — brouillon', () => {
  it('marque brouillon si une section obligatoire manque de contenu', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1', content: 'ok', qp: 'PQ', date: '2026-08-10', required: true }),
      sec({ number: 'S13', title: 'Ressources', content: '', required: true }),
    ]);
    expect(m.draft).toBe(true);
    expect(m.missingRequired).toContain('S13 — Ressources');
  });

  it('marque brouillon si la date d\'effet est absente', () => {
    const m = buildReportDocModel(
      { projectName: 'X', projectCode: 'X', effectiveDate: null },
      [sec({ number: 'S1', content: 'ok', qp: 'PQ', date: '2026-08-10', required: true })],
    );
    expect(m.draft).toBe(true);
  });

  it('non brouillon quand obligatoires remplies et date d\'effet présente', () => {
    const m = buildReportDocModel(META, [
      sec({ number: 'S1', content: 'ok', qp: 'PQ', date: '2026-08-10', required: true }),
    ]);
    expect(m.draft).toBe(false);
    expect(m.exportable).toBe(true);
  });
});
