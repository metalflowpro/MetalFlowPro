import { useState } from 'react';
import { FileDown, FileSpreadsheet, Eye, EyeOff } from 'lucide-react';
import { buildReportMarkdown, exportReportExcel, printReport } from '../../lib/plantopt/report';
import type { PlantModel, SimConfig, SimResult } from '../../lib/plantopt/types';

interface Props {
  model: PlantModel;
  config: SimConfig;
  result: SimResult | null;
  projectCode?: string;
}

const METHODOLOGY = [
  'Capacité PERT pour la variabilité de production de chaque aire',
  'Pannes aléatoires (TTF Weibull, TTR Log-normale) et arrêts planifiés',
  'Tampons dynamiques : effets de famine (amont vide) et blocage (aval plein)',
  'Causes communes (corrélation de défaillance, facteur β)',
  'Corrélation dureté → capacité et teneur → récupération',
];

/** Onglet RAPPORT & EXPORT : prévisualisation Markdown + export PDF/Excel + méthodologie. */
export function ReportTab({ model, config, result, projectCode }: Props) {
  const [show, setShow] = useState(true);
  if (!result) {
    return <div className="text-sm text-mf-txt4 py-10 text-center">Lancez une simulation pour générer le rapport.</div>;
  }
  const markdown = buildReportMarkdown(model, config, result, projectCode);

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShow(s => !s)} className="btn btn-sm btn-secondary">
            {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? 'Masquer' : 'Afficher'} le rapport
          </button>
          <button onClick={() => printReport(markdown)} className="btn btn-sm text-red-300 border border-red-500/40 hover:bg-red-500/10">
            <FileDown size={13} /> Export PDF
          </button>
          <button onClick={() => exportReportExcel(model, config, result)} className="btn btn-sm text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/10">
            <FileSpreadsheet size={13} /> Export Excel
          </button>
        </div>
      </div>

      {show && (
        <div className="card">
          <div className="section-title mb-3">Prévisualisation</div>
          <pre className="text-xs text-mf-txt2 whitespace-pre-wrap font-mono bg-mf-panel/40 rounded-lg p-4 border border-mf-border/50 overflow-x-auto">{markdown}</pre>
        </div>
      )}

      <div className="card">
        <div className="section-title mb-2">Méthodologie</div>
        <p className="text-xs text-mf-txt3 mb-2">
          Plant Optimizer simule le comportement dynamique de l'usine par Monte Carlo : chaque itération représente un futur possible sur l'horizon choisi. Le moteur applique un modèle à pas de temps (type « tank ») avec :
        </p>
        <ul className="text-xs text-mf-txt3 space-y-1 list-disc pl-5">
          {METHODOLOGY.map(m => <li key={m}>{m}</li>)}
        </ul>
        <p className="text-[11px] text-mf-txt4 mt-3">
          P10/P50/P90 : percentiles de la distribution du débit simulé. L'écart P10→P90 mesure l'incertitude. La probabilité de goulot identifie la priorité d'investissement.
        </p>
      </div>
    </div>
  );
}
