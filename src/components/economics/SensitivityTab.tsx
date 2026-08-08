import { useMemo } from 'react';
import { AlertCircle, Leaf } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { computeProjectNpv, type NpvModelInputs } from '../../lib/economics/npvModel';
import { tornado } from '../../lib/economics/sensitivity';
import { TornadoChart, type TornadoDatum } from '../ui/Chart';
import { SENSITIVITY_SWINGS, CARBON_ASSUMPTIONS, type ResolvedAssumptions } from '../../lib/config/constants';

/**
 * Onglet Sensibilité d'Economics — extrait de la page pour la garder lisible.
 *
 * Tornado NPV (une variable à la fois, calculé sur un vrai modèle de trésorerie,
 * plages ± issues de la config) + impact d'une tarification carbone sur la NPV.
 * Ne conserve aucun état : toutes les entrées viennent de la page via props.
 */

interface Props {
  annualOz: number;
  annualTonnes: number;
  goldPrice: number;
  annualOpexM: number | null;
  totalCapex: number;
  sustainCapex: number | null;
  refinery: number;
  assumptions: ResolvedAssumptions;
  baseNpv: number;
}

export function SensitivityTab({
  annualOz, annualTonnes, goldPrice, annualOpexM,
  totalCapex, sustainCapex, refinery, assumptions, baseNpv,
}: Props) {
  // Tornado de sensibilité — chaque barre est le NPV recalculé (M$) aux bornes
  // basse/haute d'une variable, base = NPV courant.
  const sensitivity = useMemo(() => {
    if (!(annualOz > 0) || !(totalCapex > 0) || annualOpexM == null) return null;
    const modelBase: NpvModelInputs = {
      annualOz,
      goldPriceUsdOz: goldPrice,
      annualOpexUsd: annualOpexM * 1_000_000,
      initialCapexUsd: totalCapex * 1_000_000,
      sustainingCapexUsdYr: (sustainCapex ?? 0) * 1_000_000,
      discountRate: assumptions.discountRate,
      lomYears: assumptions.lomYears,
      royaltyFraction: assumptions.royaltyFraction,
      refineryChargeUsdOz: refinery,
    };
    const oz = annualOz, gp = goldPrice, cx = modelBase.initialCapexUsd, ox = modelBase.annualOpexUsd, dr = modelBase.discountRate;
    const evalNpvM = (x: NpvModelInputs) => computeProjectNpv(x).npv / 1_000_000;
    // ± ranges come from config (SENSITIVITY_SWINGS), not hardcoded here.
    const S = SENSITIVITY_SWINGS;
    const pct = (v: number, s: number) => ({ low: v * (1 - s), high: v * (1 + s) });
    const pctLabel = (s: number) => `±${Math.round(s * 100)}%`;
    const { baseOutput, bars } = tornado<NpvModelInputs>(
      modelBase,
      [
        { key: 'goldPriceUsdOz',  label: `Prix de l'or ${pctLabel(S.goldPrice.amount)}`,   ...pct(gp, S.goldPrice.amount) },
        { key: 'annualOz',        label: `Teneur de tête ${pctLabel(S.grade.amount)}`,      ...pct(oz, S.grade.amount) },
        { key: 'annualOz',        label: `Débit ${pctLabel(S.throughput.amount)}`,          ...pct(oz, S.throughput.amount) },
        { key: 'annualOz',        label: `Récupération ${pctLabel(S.recovery.amount)}`,     ...pct(oz, S.recovery.amount) },
        { key: 'initialCapexUsd', label: `CAPEX ${pctLabel(S.capex.amount)}`,               ...pct(cx, S.capex.amount) },
        { key: 'annualOpexUsd',   label: `OPEX ${pctLabel(S.opex.amount)}`,                 ...pct(ox, S.opex.amount) },
        { key: 'discountRate',    label: `Taux d'act. ±${(S.discountRate.amount * 100).toFixed(0)} pts`, low: Math.max(0.001, dr - S.discountRate.amount), high: dr + S.discountRate.amount },
      ],
      evalNpvM,
    );
    return { baseOutput, bars };
  }, [annualOz, goldPrice, annualOpexM, totalCapex, sustainCapex, refinery, assumptions]);

  return (
    <div className="space-y-4">
      {baseNpv === 0 && (
        <div className="card text-xs text-amber-300 flex gap-2 items-center border-amber-400/20 bg-amber-400/5">
          <AlertCircle size={13}/> La NPV de base est nulle — configurez tous les paramètres pour une analyse de sensibilité valide.
        </div>
      )}
      <div className="card-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Tornado — Sensibilité NPV (une variable à la fois)</div>
          <div className="text-[10px] mf-txt4">rouge = borne défavorable · vert = favorable</div>
        </div>
        {sensitivity ? (
          <>
            <TornadoChart
              data={sensitivity.bars.map((b): TornadoDatum => ({ label: b.label, low: b.lowOutput, high: b.highOutput }))}
              base={sensitivity.baseOutput}
              valueFormat={v => `${formatDecimalGrouped(v, 0)}M`}
            />
            <div className="text-[10px] mf-txt4">
              Variable la plus déterminante : <span className="text-amber-300 font-semibold">{sensitivity.bars[0]?.label}</span>
              {' '}(amplitude {formatDecimalGrouped(sensitivity.bars[0]?.swing ?? 0, 0)} M$ sur la NPV).
            </div>
          </>
        ) : (
          <div className="text-xs mf-txt4">Configurez production, CAPEX et OPEX pour générer le tornado.</div>
        )}
      </div>

      {/* Carbon-aware economics — NPV impact of carbon pricing */}
      {annualTonnes > 0 && (
        <div className="card-sm space-y-3">
          <div className="flex items-center gap-2">
            <Leaf size={14} className="text-emerald-400" />
            <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">
              Économie sobre en carbone — Impact tarification CO₂ sur NPV
            </div>
          </div>
          <div className="text-[10px] mf-txt4">
            Impact d'une taxe carbone sur la NPV du projet, selon les émissions annuelles estimées et la durée LOM.
          </div>
          {(() => {
            // Emissions = tonnage traité × intensité GES (tCO2e/t), pas une fonction de l'OPEX
            // (l'OPEX est un montant financier, sans lien physique avec des émissions).
            const annualCO2 = annualTonnes * CARBON_ASSUMPTIONS.EMISSION_FACTOR_T_CO2E_PER_TONNE_ORE;
            const lomYears = assumptions.lomYears;
            const discRate = assumptions.discountRate;
            const annuityFactor = (1 - Math.pow(1 + discRate, -lomYears)) / discRate;
            const carbonPrices = CARBON_ASSUMPTIONS.CARBON_PRICE_LADDER_USD_T;

            return (
              <>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {carbonPrices.map(cp => {
                    const annualCost = annualCO2 * cp;
                    const npvImpact = annualCost * annuityFactor;
                    const adjustedNpv = baseNpv - npvImpact;
                    const pctChange = baseNpv !== 0 ? ((adjustedNpv - baseNpv) / Math.abs(baseNpv)) * 100 : 0;
                    return (
                      <div key={cp} className={`p-2 rounded border ${cp === 0 ? 'border-mf-border bg-mf-card' : pctChange < -20 ? 'border-red-500/30 bg-red-500/5' : pctChange < -10 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                        <div className="text-[10px] mf-txt4">${cp}/t</div>
                        <div className={`text-xs font-bold font-mono ${cp === 0 ? 'text-mf-txt' : pctChange < -20 ? 'text-red-400' : pctChange < -10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {pctChange === 0 ? '—' : `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`}
                        </div>
                        <div className="text-[9px] mf-txt4 mt-0.5">
                          {formatDecimalGrouped(adjustedNpv, 0)}M
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] mf-txt4">
                  <span>Émissions est.: {formatDecimalGrouped(annualCO2, 0)} tCO₂e/an</span>
                  <span>LOM: {lomYears} ans · Taux: {(discRate * 100).toFixed(0)}%</span>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
