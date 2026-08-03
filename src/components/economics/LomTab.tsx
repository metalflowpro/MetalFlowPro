import { AlertCircle } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';

/**
 * Onglet Plan LOM d'Economics — extrait de la page pour la garder lisible.
 * Vue pure : reçoit les lignes annuelles déjà calculées par la page.
 */

export interface LomRow {
  yr: number;
  tonnes: number;
  oz_k: number;
  revM: number;
  opM: number;
  capM: number;
  fcf: number;
  cumFcf: number;
}

export function LomTab({ lomRows }: { lomRows: LomRow[] }) {
  return (
    <div className="space-y-3">
      {lomRows.length === 0 ? (
        <div className="card border-amber-400/20 bg-amber-400/5 text-xs text-amber-300 flex gap-2 items-center">
          <AlertCircle size={13}/> Configurez heures/an, durée LOM, et saisissez CAPEX + OPEX pour générer le plan LOM.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                {['Année', 'Tonnes (kt)', 'Onces (koz)', 'Revenus (M$)', 'OPEX (M$)', 'CAPEX (M$)', 'FCF (M$)', 'FCF cumulé (M$)'].map(h => (
                  <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lomRows.map(r => (
                <tr key={r.yr} className={`border-b border-white/5 hover:bg-white/5 ${r.cumFcf > 0 ? 'bg-emerald-400/2' : ''}`}>
                  <td className="px-3 py-1.5 font-semibold mf-txt">An {r.yr}</td>
                  <td className="px-3 py-1.5">{formatDecimalGrouped((r.tonnes / 1000), 0)}</td>
                  <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(r.oz_k, 1)}</td>
                  <td className="px-3 py-1.5 text-emerald-300">{formatDecimalGrouped(r.revM, 1)}</td>
                  <td className="px-3 py-1.5 mf-txt2">{formatDecimalGrouped(r.opM, 1)}</td>
                  <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(r.capM, 1)}</td>
                  <td className={`px-3 py-1.5 font-semibold ${r.fcf >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatDecimalGrouped(r.fcf, 1)}</td>
                  <td className={`px-3 py-1.5 font-bold ${r.cumFcf >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatDecimalGrouped(r.cumFcf, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
