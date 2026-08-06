import { describe, it, expect } from 'vitest';
import {
  FORM_43101F1_ITEMS, assembleReport, reportReadiness, type SectionState,
} from './assemble';

describe('structure Form 43-101F1', () => {
  it('compte 25 items numérotés dans l\'ordre', () => {
    expect(FORM_43101F1_ITEMS).toHaveLength(25);
    FORM_43101F1_ITEMS.forEach((item, i) => expect(item.number).toBe(i + 1));
  });

  it('contient les items réglementaires clés ressource (13) et réserve (14)', () => {
    expect(FORM_43101F1_ITEMS.find(i => i.number === 13)!.key).toBe('resource');
    expect(FORM_43101F1_ITEMS.find(i => i.number === 14)!.key).toBe('reserve');
  });
});

describe('assemblage & complétude', () => {
  it('une section n\'est complète qu\'avec contenu + QP + date', () => {
    const states: Record<string, SectionState> = {
      title: { hasContent: true, qpId: 'qp1', date: '2026-08-05' },
      resource: { hasContent: true, qpId: 'qp1', date: null }, // manque la date
      reserve: { hasContent: true, qpId: null, date: '2026-08-05' }, // manque le QP
    };
    const asm = assembleReport(states);
    expect(asm.find(s => s.key === 'title')!.complete).toBe(true);
    expect(asm.find(s => s.key === 'resource')!.complete).toBe(false);
    expect(asm.find(s => s.key === 'reserve')!.complete).toBe(false);
    // section non fournie → non complète, sans contenu
    expect(asm.find(s => s.key === 'mining')!.hasContent).toBe(false);
  });

  it('reportReadiness : avancement, liste des manquants, sign-off', () => {
    const asm = assembleReport({ title: { hasContent: true, qpId: 'qp1', date: '2026-08-05' } });
    const r = reportReadiness(asm);
    expect(r.total).toBe(25);
    expect(r.complete).toBe(1);
    expect(r.pct).toBeCloseTo(1 / 25, 6);
    expect(r.missing).toContain('13. Estimation des ressources minérales');
    expect(r.allSignedOff).toBe(true); // la seule section à contenu est signée
  });

  it('allSignedOff faux si une section a du contenu sans QP/date', () => {
    const asm = assembleReport({ history: { hasContent: true, qpId: null, date: null } });
    expect(reportReadiness(asm).allSignedOff).toBe(false);
  });
});
