// ─────────────────────────────────────────────────────────────────────────────
// Bouton d'export Word (.docx) un-clic du rapport NI 43-101.
//
// Règle réglementaire (V7) : l'export est BLOQUÉ tant qu'une section porte du
// contenu narratif non signé par une PQ — on ne diffuse pas un livrable dont un
// texte technique n'engage personne. Un rapport incomplet mais dont tout contenu
// est signé s'exporte en BROUILLON (filigrane dans le document).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { FileText, Loader, AlertTriangle } from 'lucide-react';
import { buildReportDocModel, type DocSectionInput, type ReportDocMeta } from '../../lib/report/reportDoc';
import { downloadReportDocx } from '../../lib/report/docxRenderer';

interface Props {
  meta: ReportDocMeta;
  sections: DocSectionInput[];
  className?: string;
}

export function ReportExportButton({ meta, sections, className = 'btn btn-sm btn-secondary' }: Props) {
  const [busy, setBusy] = useState(false);
  const model = buildReportDocModel(meta, sections);

  async function handleExport() {
    if (!model.exportable || busy) return;
    setBusy(true);
    try {
      const base = `NI43-101_${meta.projectCode || 'rapport'}${model.draft ? '_BROUILLON' : ''}`;
      await downloadReportDocx(model, base);
    } finally {
      setBusy(false);
    }
  }

  if (!model.exportable) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-2.5 py-1.5"
        title={`Sections à signer avant export :\n${model.unsignedWithContent.join('\n')}`}>
        <AlertTriangle size={13} /> Export Word bloqué — {model.unsignedWithContent.length} section(s) non signée(s)
      </span>
    );
  }

  return (
    <button className={className} onClick={handleExport} disabled={busy}
      title={model.draft ? 'Le rapport est incomplet : export en BROUILLON (filigrane).' : 'Exporter le rapport NI 43-101 en Word (.docx)'}>
      {busy ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
      {' '}Exporter Word{model.draft ? ' (brouillon)' : ''}
    </button>
  );
}
