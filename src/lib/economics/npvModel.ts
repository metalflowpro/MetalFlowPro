// ─────────────────────────────────────────────────────────────────────────────
// Modèle de trésorerie projet — transparent, PUR, réutilisant npv()/irr().
//
// Un modèle NPV/TRI « pleine mine » explicite (revenu net, EBITDA, capex initial
// + soutien, actualisation sur la durée de vie), assez simple pour être audité et
// assez complet pour alimenter une analyse de sensibilité crédible. Reprend les
// primitives éprouvées `npv`/`irr` du moteur de scénarios.
// ─────────────────────────────────────────────────────────────────────────────

import { npv, irr } from '../simulation/economics';

export interface NpvModelInputs {
  /** Production annuelle (troy oz/an). */
  annualOz: number;
  /** Prix de l'or (USD/oz). */
  goldPriceUsdOz: number;
  /** OPEX total annuel (USD/an). */
  annualOpexUsd: number;
  /** CAPEX initial, contingence incluse (USD, dépensé en t=0). */
  initialCapexUsd: number;
  /** CAPEX de soutien annuel (USD/an). */
  sustainingCapexUsdYr: number;
  /** Taux d'actualisation (fraction, ex. 0.08). */
  discountRate: number;
  /** Durée de vie de la mine (années). */
  lomYears: number;
  /** Redevance (fraction du revenu brut). */
  royaltyFraction: number;
  /** Frais de raffinage (USD/oz). */
  refineryChargeUsdOz: number;
}

export interface NpvModelResult {
  grossRevenueYr: number;
  netRevenueYr: number;
  ebitdaYr: number;
  annualCashflow: number;
  npv: number;
  irr: number | null;
  paybackYears: number;
}

/**
 * Trésorerie projet et indicateurs. Convention temporelle : le CAPEX initial est
 * en t=0, les flux d'exploitation en t=1…LOM (cohérent avec `npv`, qui actualise
 * son premier flux à t=1).
 */
export function computeProjectNpv(inputs: NpvModelInputs): NpvModelResult {
  const {
    annualOz, goldPriceUsdOz, annualOpexUsd, initialCapexUsd, sustainingCapexUsdYr,
    discountRate, lomYears, royaltyFraction, refineryChargeUsdOz,
  } = inputs;

  const grossRevenueYr = annualOz * goldPriceUsdOz;
  const royaltyYr = grossRevenueYr * royaltyFraction;
  const refiningYr = annualOz * refineryChargeUsdOz;
  const netRevenueYr = grossRevenueYr - royaltyYr - refiningYr;
  const ebitdaYr = netRevenueYr - annualOpexUsd;
  const annualCashflow = ebitdaYr - sustainingCapexUsdYr;

  const years = Math.max(0, Math.round(lomYears));
  const operating = Array(years).fill(annualCashflow);
  // npv() actualise operating[0] à t=1 ; le CAPEX initial reste en t=0.
  const npvValue = npv(operating, discountRate) - initialCapexUsd;

  const irrValue = irr([-initialCapexUsd, ...operating]);
  const paybackYears = annualCashflow > 0 ? initialCapexUsd / annualCashflow : Infinity;

  return {
    grossRevenueYr, netRevenueYr, ebitdaYr, annualCashflow,
    npv: npvValue, irr: irrValue, paybackYears,
  };
}
