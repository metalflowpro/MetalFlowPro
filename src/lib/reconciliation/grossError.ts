// ─────────────────────────────────────────────────────────────────────────────
// Élimination SÉRIELLE des erreurs grossières (AMIRA P754 / metal accounting).
//
// La réconciliation WLS (`reconcile`) suppose des mesures entachées d'un bruit
// ALÉATOIRE. Un biais SYSTÉMATIQUE (capteur déréglé, prise d'échantillon
// non représentative) viole cette hypothèse : il « contamine » tout le bilan,
// car les moindres carrés redistribuent son erreur sur les flux voisins. Le
// test global χ² détecte alors une incohérence anormale, mais un seul passage
// ne fait que DÉSIGNER le suspect — il ne le retire pas.
//
// La procédure standard (Narasimhan & Jordache, ch. 7 ; AMIRA P754) est
// ITÉRATIVE :
//   1. réconcilier ; 2. si le test global passe → stop (aucune erreur grossière) ;
//   3. sinon retirer la mesure au score de suspicion le plus élevé ; 4. répéter.
//
// « Retirer » = dé-pondérer massivement la mesure (variance → ∞) : le flux
// existe toujours et sa valeur RÉCONCILIÉE flotte librement pour boucler les
// bilans, mais il ne contraint plus la solution ni le test χ². C'est le proxy
// pratique de l'élimination (équivalent à traiter le flux comme non mesuré),
// sans réécrire le noyau en variables mesurées/non mesurées.
//
// Les flux `fixed` (références) ne sont JAMAIS éliminés. On s'arrête dès que le
// test global passe, qu'il n'existe plus de suspect, ou à `maxEliminations`.
//
// Module PUR : réutilise `reconcile`. Aucune dépendance.
// ─────────────────────────────────────────────────────────────────────────────

import {
  reconcile, DEFAULT_RECON_CONFIDENCE,
  type ReconNode, type ReconStream, type ReconResult,
} from './wls';

/** Une mesure retirée pendant la procédure, dans l'ordre d'élimination. */
export interface EliminatedSensor {
  id: string;
  label?: string;
  /** Score de suspicion au moment du retrait. */
  score: number;
  /** Statistique du test global AVANT ce retrait. */
  gammaBefore: number;
  /** Seuil χ² correspondant. */
  thresholdBefore: number;
}

export interface SerialEliminationResult {
  /** Réconciliation finale (mesures suspectes dé-pondérées). */
  result: ReconResult;
  /** Mesures éliminées, dans l'ordre. */
  eliminated: EliminatedSensor[];
  /** Le test global était-il en erreur grossière au départ ? */
  initialGrossError: boolean;
  /** Le circuit est-il « propre » à l'arrivée (test global passe) ? */
  cleared: boolean;
  /** Nombre de réconciliations effectuées. */
  iterations: number;
  notes: string[];
}

export interface SerialEliminationOptions {
  confidence?: number;
  /** Nombre maximal de mesures à éliminer (défaut : redondance = m − nœuds). */
  maxEliminations?: number;
}

/** Écart-type « d'élimination » : énorme devant l'échelle du flux → poids ≈ 0. */
function eliminatedStd(measured: number): number {
  return 1e6 * Math.max(1, Math.abs(measured));
}

/**
 * Applique l'élimination sérielle des erreurs grossières à un réseau de flux.
 *
 * Retourne la réconciliation finale, la liste ordonnée des mesures retirées, et
 * si le circuit est redevenu cohérent (test global χ² satisfait).
 */
export function eliminateGrossErrorsSerial(
  nodes: ReconNode[],
  streams: ReconStream[],
  options: SerialEliminationOptions = {},
): SerialEliminationResult {
  const confidence = options.confidence ?? DEFAULT_RECON_CONFIDENCE;
  const notes: string[] = [];

  // Redondance = mesures − contraintes : au-delà, le retrait rendrait le réseau
  // sous-déterminé. Plafond de sécurité par défaut.
  const redundancy = Math.max(0, streams.length - nodes.length);
  const maxElim = options.maxEliminations ?? redundancy;

  const eliminated: EliminatedSensor[] = [];
  const removedIds = new Set<string>();

  const runWith = (): ReconResult => reconcile(
    nodes,
    streams.map(s => removedIds.has(s.id) ? { ...s, std: eliminatedStd(s.measured), fixed: false } : s),
    confidence,
  );

  let result = runWith();
  const initialGrossError = result.globalTest.gerossError;
  let iterations = 1;

  if (!result.feasible) {
    notes.push('Réseau infaisable — élimination impossible.');
    return { result, eliminated, initialGrossError, cleared: false, iterations, notes };
  }

  while (result.globalTest.gerossError && eliminated.length < maxElim) {
    // Suspect le plus probable, parmi les flux encore actifs et non figés.
    const candidates = result.streams
      .filter(s => !removedIds.has(s.id) && s.isSuspect)
      .sort((a, b) => b.suspicionScore - a.suspicionScore);

    if (candidates.length === 0) {
      notes.push('Erreur grossière résiduelle mais aucun capteur isolé désigné — vérifier la topologie ou plusieurs biais simultanés.');
      break;
    }

    const worst = candidates[0];
    eliminated.push({
      id: worst.id,
      label: worst.label,
      score: worst.suspicionScore,
      gammaBefore: result.globalTest.statistic,
      thresholdBefore: result.globalTest.threshold,
    });
    removedIds.add(worst.id);

    result = runWith();
    iterations++;
  }

  const cleared = !result.globalTest.gerossError;

  if (!initialGrossError) {
    notes.push('Aucune erreur grossière au départ — réconciliation directe.');
  } else if (cleared) {
    notes.push(`Circuit assaini après ${eliminated.length} élimination(s) : ${eliminated.map(e => e.label ?? e.id).join(', ')}.`);
  } else if (eliminated.length >= maxElim && maxElim > 0) {
    notes.push(`Erreur grossière persistante après ${eliminated.length} élimination(s) (limite de redondance atteinte).`);
  }

  return { result, eliminated, initialGrossError, cleared, iterations, notes };
}
