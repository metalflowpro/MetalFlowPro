import { formatDecimalGrouped } from '../../lib/format/number';
import { Droplets, AlertTriangle, CheckCircle2, Info, Star,
} from 'lucide-react';
import { type RouteEstimate } from '../../lib/analytics/routeEstimation';
import { useProject } from '../../lib/ProjectContext';
import type { AdsorptionDecisionThresholds } from '../../lib/config/metConstants';

import { LimsData, cilVsCip } from './model';
import { RouteBar } from './charts';

// ─── Tab: Route Métallurgique ─────────────────────────────────────────────────

/**
 * Modèles de récupération par étage, AJUSTÉS SUR LES ESSAIS DU PROJET.
 *
 * C'est la méthode d'un rapport technique (§13.5) : chaque étage est une
 * fonction de la teneur d'alimentation, ajustée par régression sur les essais du
 * projet — d'où deux modèles différents pour deux gisements différents. Le
 * panneau montre l'équation, l'effectif, le R² et la plage de validité, tout ce
 * qu'une personne qualifiée doit pouvoir vérifier.
 */
function StageModelsPanel() {
  const { stageModels } = useProject();
  const entries = [
    { key: 'flotation', label: 'Flottation', model: stageModels.flotation, forme: 'saturante — R = a×(1−e^(−b·teneur))' },
    { key: 'leach',     label: 'Lixiviation', model: stageModels.leach,    forme: 'logarithmique — R = a×ln(teneur)+b' },
  ];
  if (entries.every(e => !e.model)) {
    return (
      <div className="rounded-xl border border-mf-border/60 bg-mf-hover/10 p-4">
        <div className="text-sm font-semibold text-mf-txt mb-1">Modèles d'étage ajustés sur les essais</div>
        <p className="text-xs text-mf-txt4">
          Aucun étage n'a encore assez d'essais portant À LA FOIS la teneur d'alimentation et la
          récupération pour ajuster un modèle. L'application compose donc les moyennes d'essais.
          Renseignez la teneur d'alimentation de vos essais de flottation et de lixiviation pour
          obtenir une récupération fonction de la teneur, comme dans un rapport technique.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="text-sm font-semibold text-mf-txt mb-1">Modèles d'étage ajustés sur les essais du projet</div>
      <p className="text-[11px] text-mf-txt4 mb-3">
        Récupération en fonction de la teneur d'alimentation, ajustée par régression sur les essais
        de CE projet — méthode d'un rapport technique. Un modèle faiblement soutenu est signalé et
        n'alimente pas l'estimation des routes.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {entries.map(e => (
          <div key={e.key} className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-mf-txt">{e.label}</span>
              {e.model && (
                <span className={`badge text-[9px] ${e.model.weak ? 'badge-orange' : 'badge-green'}`}>
                  {e.model.weak ? 'faiblement soutenu' : 'ajusté'}
                </span>
              )}
            </div>
            {e.model ? (
              <>
                <div className="font-mono text-[11px] text-sky-300 mb-1">{e.model.equation}</div>
                <div className="text-[10px] text-mf-txt4 leading-relaxed">
                  n = {e.model.n} essais · R² = {formatDecimalGrouped(e.model.rSquared, 3)} ·
                  RMSE {formatDecimalGrouped(e.model.rmsePts, 1)} pts<br />
                  valide de {formatDecimalGrouped(e.model.minGradeGt, 2)} à {formatDecimalGrouped(e.model.maxGradeGt, 2)} g/t
                </div>
              </>
            ) : (
              <div className="text-[10px] text-mf-txt4">
                Essais insuffisants pour ajuster ({e.forme}). Moyenne des essais utilisée.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RoutesTab({ routes, maxRec, data, adsorptionThresholds }: { routes: RouteEstimate[]; maxRec: number; data: LimsData; adsorptionThresholds?: AdsorptionDecisionThresholds }) {
  if (routes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Info size={32} className="text-mf-txt4 mb-3" />
        <p className="text-sm font-semibold text-mf-txt mb-1">Données insuffisantes</p>
        <p className="text-xs text-mf-txt4 max-w-xs">Saisissez au minimum des données de lixiviation (D1) pour générer les routes.</p>
      </div>
    );
  }
  const allRefs = [...new Set(routes.flatMap(r => r.references))];
  const cilCip = cilVsCip(data, adsorptionThresholds);

  // The recommendation is decided once, in metallurgicalRoutes(), so every view
  // reads the same flag. Re-deciding it here is what made the tabs disagree.
  const recommended = routes.find(r => r.recommended);

  return (
    <div className="space-y-5">
      {/* Modèles d'étage ajustés sur les essais DU PROJET — équivalent §13.5 d'un
          rapport technique : la récupération d'un étage est une FONCTION de la
          teneur, ajustée par régression, pas une moyenne d'essais. */}
      <StageModelsPanel />

      {/* Recommended highlight */}
      {recommended && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Star size={16} className="text-emerald-400 fill-emerald-400" />
            <span className="text-sm font-bold text-emerald-400">Circuit recommandé</span>
          </div>
          <div className="flex items-end gap-6">
            <div className="flex-1">
              <div className="text-base font-bold text-mf-txt mb-1">{recommended.route}</div>
              <div className="text-xs text-mf-txt3 mb-2">{recommended.basis}</div>
              <div className="flex gap-3 text-xs">
                <span>Confiance: <span className="font-semibold text-emerald-400">{recommended.confidence.toUpperCase()}</span></span>
                <span>CapEx: <span className="font-semibold">{recommended.capex_indicator.toUpperCase()}</span></span>
                <span>OpEx: <span className="font-semibold">{recommended.opex_indicator.toUpperCase()}</span></span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-mono font-bold text-emerald-400">{recommended.recovery_pct}%</div>
              <div className="text-xs text-mf-txt4">récupération estimée</div>
            </div>
          </div>

          {/* Adsorption sub-circuit — part of the SAME single recommendation */}
          <div className="mt-4 pt-4 border-t border-emerald-500/15">
            <div className="flex items-center gap-2 mb-2">
              <Droplets size={14} className={cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'} />
              <span className="text-xs text-mf-txt3">Circuit d'adsorption retenu :</span>
              <span className={`text-sm font-bold font-mono ${cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'}`}>{cilCip.recommendation}</span>
              <span className="text-[11px] text-mf-txt4">{cilCip.recommendation === 'CIL' ? 'Carbon-In-Leach — carbone actif en circuit ouvert' : 'Carbon-In-Pulp — tanks CIP séparés de la lixiviation'}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {cilCip.reasons.slice(0, 3).map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] text-mf-txt3">
                  <CheckCircle2 size={10} className={`shrink-0 mt-0.5 ${cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'}`} />
                  {r}
                </div>
              ))}
              {cilCip.warnings.map((w, i) => (
                <div key={`w${i}`} className="flex items-start gap-1.5 text-[10px] text-amber-300">
                  <AlertTriangle size={10} className="text-amber-400 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* All routes comparison */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-4">Analyse comparative — {routes.length} circuit{routes.length > 1 ? 's' : ''} proposé{routes.length > 1 ? 's' : ''}</div>
        {routes.map(r => <RouteBar key={r.route} route={r} maxRec={maxRec} />)}
      </div>

      {/* Detail table */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Tableau comparatif — Récupération globale estimée</div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Circuit proposé</th>
                <th className="text-right">Récup. glob. (%)</th>
                <th>Confiance</th>
                <th>Qualité données</th>
                <th>CapEx</th>
                <th>OpEx</th>
                <th>Base de calcul</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(r => (
                <tr key={r.route} className={r.recommended ? 'bg-emerald-500/5' : ''}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {r.recommended && <Star size={10} className="text-emerald-400 fill-emerald-400 shrink-0" />}
                      <span className="text-xs text-mf-txt font-medium">{r.route}</span>
                    </div>
                  </td>
                  <td className={`num font-bold text-sm ${r.recommended ? 'text-emerald-400' : ''}`}>{r.recovery_pct}</td>
                  <td><span className={`badge text-[9px] ${r.confidence === 'high' ? 'badge-green' : r.confidence === 'medium' ? 'badge-orange' : 'badge-gray'}`}>{r.confidence}</span></td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-mf-border/40 overflow-hidden">
                        <div className={`h-full rounded-full ${r.dataQualityScore >= 67 ? 'bg-emerald-400' : r.dataQualityScore >= 33 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${r.dataQualityScore}%` }} />
                      </div>
                      <span className="text-[9px] text-mf-txt4 font-mono">{r.dataQualityScore}%</span>
                    </div>
                  </td>
                  <td><span className={`text-[10px] font-semibold ${r.capex_indicator === 'low' ? 'text-emerald-400' : r.capex_indicator === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>{r.capex_indicator.toUpperCase()}</span></td>
                  <td><span className={`text-[10px] font-semibold ${r.opex_indicator === 'low' ? 'text-emerald-400' : r.opex_indicator === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>{r.opex_indicator.toUpperCase()}</span></td>
                  <td><span className="text-[10px] text-mf-txt4 leading-tight max-w-xs block">{r.basis}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disclaimer + refs */}
      <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-lg flex items-start gap-2">
        <Info size={13} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-mf-txt3">Ces estimations guident le choix du circuit mais ne remplacent pas une étude de faisabilité. La confiance augmente avec le nombre d'essais et la représentativité des composites.</div>
      </div>
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Références</div>
        <div className="space-y-1.5">
          {allRefs.map((ref, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-mf-border/40">
              <div className="w-4 h-4 rounded bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-bold text-amber-500">{i + 1}</span>
              </div>
              <span className="text-xs text-mf-txt3">{ref}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
