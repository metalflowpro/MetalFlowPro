// ─────────────────────────────────────────────────────────────────────────────
// Simulation d'adsorption sur charbon multi-cuves en série (CIL / CIP).
//
// Modèle de bilan de masse et de cinétique d'adsorption cuve par cuve (N cuves).
// Résout les profils de teneur en or en solution Cᵢ (g/m³) et sur le charbon qᵢ (g/t)
// pour un circuit à contre-courant de charbon actif.
//
// Références : Marsden & House, "The Chemistry of Gold Extraction" ;
// Nicol, Fleming & Cromberge, "The Rate of Adsorption of Gold Cyanide onto Activated Carbon".
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export interface MultistageAdsorptionInputs {
  /** Nombre de cuves d'adsorption en série (ex: 6 à 8). */
  tankCount: number;
  /** Volume unitaire de chaque cuve (m³). */
  tankVolumeM3: number;
  /** Débit volumique de pulpe (m³/h). */
  slurryFlowM3H: number;
  /** Teneur en or initiale en solution à l'entrée du circuit (mg/L = g/m³). */
  feedGoldSolubleGm3: number;
  /** Teneur en or solide alimentée (g/t) — pour le CIL (dissolution simultanée). */
  feedGoldSolidGt?: number;
  /** Taux de dissolution de l'or en cuve CIL (h⁻¹). */
  dissolutionRateH1?: number;
  /** Concentration de charbon actif maintenue par cuve (g/L pulpe = kg/m³). */
  carbonConcentrationGl: number;
  /** Débit de transfert de charbon à contre-courant (kg/h). */
  carbonTransferKgH: number;
  /** Constante de vitesse d'adsorption k (h⁻¹). */
  adsorptionRateK: number;
  /** Teneur de chargement maximale du charbon q_max (g Au / t charbon). */
  qMaxGt?: number;
  /** Mode de circuit : CIL (adsorption + dissolution) ou CIP (adsorption seule). */
  mode: 'CIL' | 'CIP';
}

export interface TankState {
  tankIndex: number;
  /** Teneur en or en solution dans la cuve (g/m³ = mg/L). */
  cSolubleGm3: number;
  /** Teneur en or chargée sur le charbon (g/t = g/tonne charbon). */
  qCarbonGt: number;
  /** Temps de séjour dans la cuve (heures). */
  residenceTimeHours: number;
  /** Perte soluble cumulée sortant de la cuve (g/h). */
  solubleLossGH: number;
}

export interface MultistageAdsorptionResult {
  tanks: TankState[];
  /** Récupération globale du circuit d'adsorption (%). */
  overallAdsorptionRecoveryPct: number;
  /** Pertes solubles totales en queues (g Au / h). */
  tailSolubleLossGH: number;
  /** Débit d'or extrait sur le charbon de tête (g Au / h). */
  goldHarvestedGH: number;
  /** Chargement du charbon de tête sortant vers l'élution (g Au / t charbon). */
  loadedCarbonGradeGt: number;
  /** Inventaire total d'or immobilisé sur le charbon du circuit (kg Au). */
  totalCarbonInventoryKg: number;
}

/**
 * Calcule le profil d'adsorption cuve par cuve en régime permanent.
 */
export function simulateMultistageAdsorption(inp: MultistageAdsorptionInputs): MultistageAdsorptionResult {
  const n = Math.max(1, Math.min(12, Math.round(inp.tankCount)));
  const vTank = Math.max(1, inp.tankVolumeM3);
  const qSlurry = Math.max(0.1, inp.slurryFlowM3H);
  const cIn = Math.max(0, inp.feedGoldSolubleGm3);
  const cCarbonKgM3 = Math.max(0.1, inp.carbonConcentrationGl); // 1 g/L = 1 kg/m³
  const kAd = Math.max(0.01, inp.adsorptionRateK);
  const qMax = inp.qMaxGt ?? 12000; // 12 000 g/t = 12 kg/t max loading
  const τ = vTank / qSlurry; // temps de séjour unitaire (h)

  const isCIL = inp.mode === 'CIL';
  const kDiss = isCIL ? (inp.dissolutionRateH1 ?? 0.08) : 0;
  const solidAuIn = isCIL ? Math.max(0, inp.feedGoldSolidGt ?? 0) : 0;

  // Profils de solution C[i] et charbon q[i] (1-indexed dans la logique, 0-indexed en tableau)
  const C = new Array<number>(n).fill(cIn);
  const q = new Array<number>(n).fill(0);
  const solidAu = new Array<number>(n).fill(solidAuIn);

  // Itération jusqu'à convergence du système d'équations couplées contre-courant
  for (let iter = 0; iter < 100; iter++) {
    // Balayage amont -> aval pour la solution C[i] et dissolution solide
    let cPrev = cIn;
    let sPrev = solidAuIn;

    for (let i = 0; i < n; i++) {
      let dissolutionRate = 0;
      if (isCIL && sPrev > 0) {
        dissolutionRate = sPrev * (1 - Math.exp(-kDiss * τ));
        solidAu[i] = Math.max(0, sPrev - dissolutionRate);
      } else {
        solidAu[i] = sPrev;
      }

      // Transfert de masse solution -> charbon : dC/dt = - kAd * C * (1 - q/qMax) * (cCarbon / 1000)
      const drivingForce = Math.max(0.01, 1 - q[i] / qMax);
      const kEff = kAd * drivingForce;
      // Bilan matière cuve i : Q*cPrev + dissolution - Q*C[i] - vTank * kEff * C[i] = 0
      const cNew = (cPrev * qSlurry + dissolutionRate * (qSlurry * 0.5)) /
                   (qSlurry + vTank * kEff * (cCarbonKgM3 / 10));

      C[i] = Math.max(0, Math.min(cIn * 1.5 + solidAuIn, cNew));
      cPrev = C[i];
      sPrev = solidAu[i];
    }

    // Balayage aval -> amont pour le charbon q[i] (contre-courant charbon)
    // Le charbon régénéré (pauvre, ~100 g/t) entre en cuve N, et sort chargé en cuve 0.
    let qNext = 100; // g/t charbon régénéré alimenté en queue
    for (let i = n - 1; i >= 0; i--) {
      // Or capté par le charbon dans la cuve i (g/h) = vTank * kEff * C[i] * cCarbon
      const kEff = kAd * Math.max(0.01, 1 - q[i] / qMax);
      const goldAdsorbedGH = vTank * kEff * C[i] * (cCarbonKgM3 / 10);
      const carbonFlowKgH = Math.max(1, inp.carbonTransferKgH);
      // q[i] = qNext + (goldAdsorbedGH / (carbonFlowKgH / 1000))
      q[i] = Math.min(qMax, qNext + (goldAdsorbedGH * 1000) / carbonFlowKgH);
      qNext = q[i];
    }
  }

  // Construction du résultat
  const tanks: TankState[] = C.map((cSol, i) => ({
    tankIndex: i + 1,
    cSolubleGm3: +cSol.toFixed(3),
    qCarbonGt: +q[i].toFixed(1),
    residenceTimeHours: +τ.toFixed(2),
    solubleLossGH: +(cSol * qSlurry).toFixed(2),
  }));

  const goldInGH = cIn * qSlurry + (isCIL ? solidAuIn * qSlurry * 0.5 : 0);
  const tailSolubleLossGH = C[n - 1] * qSlurry;
  const goldHarvestedGH = Math.max(0, goldInGH - tailSolubleLossGH);
  const overallAdsorptionRecoveryPct = goldInGH > 0 ? Math.max(0, Math.min(100, (goldHarvestedGH / goldInGH) * 100)) : 100;
  const loadedCarbonGradeGt = q[0];
  const totalCarbonInventoryKg = q.reduce((sum, qi) => sum + (qi * vTank * cCarbonKgM3) / 1000000, 0);

  return {
    tanks,
    overallAdsorptionRecoveryPct: +overallAdsorptionRecoveryPct.toFixed(2),
    tailSolubleLossGH: +tailSolubleLossGH.toFixed(2),
    goldHarvestedGH: +goldHarvestedGH.toFixed(2),
    loadedCarbonGradeGt: +loadedCarbonGradeGt.toFixed(1),
    totalCarbonInventoryKg: +totalCarbonInventoryKg.toFixed(3),
  };
}
