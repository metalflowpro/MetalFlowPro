import { formatDecimalGrouped } from '../../lib/format/number';
import {
  Mountain, Target, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { type Block as PitBlock, type Shell } from '../../lib/mine/pitOptimizer';
import type { PitViz } from '../../lib/mine/pitOptimizer.worker';
import { PitSection } from '../../components/mine/PitViews';

import { MINE_MODEL, MineParamsRow } from './model';

interface PitOptimizationTabProps {
  Math: Math;
  blockSize: { x: number; y: number; z: number; };
  blocks: PitBlock[];
  blocksLoading: boolean;
  blocksTruncated: boolean;
  cancelOptimisation: () => void;
  edgeCount: number;
  optimError: string;
  optimProgress: { done: number; total: number; };
  optimising: boolean;
  p: MineParamsRow | null;
  params: MineParamsRow;
  pitViz: PitViz | null;
  runPitOptimisation: () => Promise<void>;
  shells: Shell[];
  ultimatePit: Shell;
}

export function PitOptimizationTab({ Math, blockSize, blocks, blocksLoading, blocksTruncated, cancelOptimisation, edgeCount, optimError, optimProgress, optimising, p, params, pitViz, runPitOptimisation, shells, ultimatePit }: PitOptimizationTabProps) {
  return (
          <div className="space-y-4">
            {blocksLoading ? (
              <div className="card-sm text-center py-12">
                <RefreshCw size={22} className="text-amber-400 mx-auto mb-3 animate-spin" />
                <div className="text-sm font-semibold mf-txt mb-1">Chargement du modèle de blocs…</div>
                <div className="text-xs mf-txt4">Le reste du module reste utilisable pendant ce temps.</div>
              </div>
            ) : blocks.length === 0 ? (
              <div className="card-sm text-center py-12">
                <Mountain size={28} className="text-mf-txt4 mx-auto mb-3" />
                <div className="text-sm font-semibold mf-txt mb-1">Aucun modèle de blocs</div>
                <div className="text-xs mf-txt4 max-w-lg mx-auto">
                  L'optimisation Lerchs-Grossmann s'exécute sur le modèle de blocs du projet.
                  Importez-le dans le module <strong className="mf-txt3">Block Model</strong> — sans lui, l'enveloppe
                  économique ne peut pas être calculée, seulement supposée.
                </div>
              </div>
            ) : (
              <>
                {blocksTruncated && (
                  <div className="p-2.5 rounded-md bg-amber-400/8 border border-amber-400/20 text-xs text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={12} />
                    Modèle tronqué à {MINE_MODEL.MAX_BLOCKS_OPTIMISED.toLocaleString('fr-CA')} blocs pour
                    l'optimisation en navigateur — la fosse affichée ne couvre pas tout le gisement.
                  </div>
                )}

                {/* Optimisation is explicit: nine max-flow solves over the whole
                    model is heavy, synchronous work. Running it automatically froze
                    the tab — the engineer chooses when to pay for it. */}
                <div className="card-sm flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold mf-txt">
                      {blocks.length.toLocaleString('fr-CA')} blocs chargés
                      {blockSize.x > 0 && ` · ${formatDecimalGrouped(blockSize.x, 0)} × ${formatDecimalGrouped(blockSize.y, 0)} m`}
                    </div>
                    <div className="text-[10px] mf-txt4">
                      {optimising
                        ? `Shell ${optimProgress.done}/${optimProgress.total} — calcul hors du fil d'affichage, la page reste utilisable.`
                        : shells.length
                          ? `${shells.length} shells optimisées${edgeCount ? ` · ${formatDecimalGrouped((edgeCount / 1e6), 1)} M arcs de préséance par shell` : ''} — relancer après un changement d'hypothèse.`
                          : 'L\'optimisation n\'est pas lancée automatiquement : elle est lourde et se lance à la demande.'}
                    </div>
                    {optimising && optimProgress.total > 0 && (
                      <div className="w-64 h-1 bg-white/10 rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-amber-400 transition-all"
                          style={{ width: `${(optimProgress.done / optimProgress.total) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {optimising && (
                      <button onClick={cancelOptimisation} className="btn btn-secondary text-xs">Annuler</button>
                    )}
                    <button onClick={runPitOptimisation} disabled={optimising}
                      className="btn bg-amber-400 text-gray-900 hover:bg-amber-300 font-semibold flex items-center gap-2 disabled:opacity-50">
                      {optimising
                        ? <><RefreshCw size={13} className="animate-spin" /> Optimisation…</>
                        : <><Target size={13} /> {shells.length ? 'Relancer l\'optimisation' : 'Lancer l\'optimisation Lerchs-Grossmann'}</>}
                    </button>
                  </div>
                </div>

                {optimError && (
                  <div className="p-2.5 rounded-md bg-red-400/8 border border-red-400/20 text-xs text-red-300 flex items-center gap-2">
                    <AlertTriangle size={12} /> {optimError}
                  </div>
                )}

                {/* Ultimate pit */}
                {ultimatePit && (
                  <div className="card-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Target size={12} className="text-emerald-400" />
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Fosse ultime — fermeture maximale (Lerchs-Grossmann)</div>
                    </div>
                    <div className="text-[10px] mf-txt4 mb-3">
                      Optimum <strong className="mf-txt3">prouvé</strong> par coupe minimale sur le graphe de préséance
                      ({blocks.length.toLocaleString('fr-CA')} blocs, talus {params.slope_angle_deg}°) — pas une heuristique.
                      Chaque bloc est valorisé avec la récupération et l'énergie de broyage de <em>son</em> domaine géométallurgique,
                      ce qu'une récupération unique à l'échelle du gisement ne peut pas exprimer.
                    </div>
                    <div className="grid grid-cols-6 gap-3">
                      {[
                        { label: 'Valeur non actualisée', val: `${formatDecimalGrouped((ultimatePit.result.totalValueUsd / 1e6), 1)} M$`, color: 'text-emerald-400' },
                        { label: 'Minerai', val: `${formatDecimalGrouped((ultimatePit.result.oreTonnes / 1e6), 2)} Mt`, color: 'text-amber-400' },
                        { label: 'Stérile', val: `${formatDecimalGrouped((ultimatePit.result.wasteTonnes / 1e6), 2)} Mt`, color: 'mf-txt3' },
                        { label: 'Ratio décapage', val: `${formatDecimalGrouped(ultimatePit.result.strippingRatio, 2)}:1`, color: 'text-sky-400' },
                        { label: 'Onces contenues', val: `${formatDecimalGrouped((ultimatePit.result.containedOz / 1000), 0)} koz`, color: 'mf-txt3' },
                        { label: 'Onces récupérables', val: `${formatDecimalGrouped((ultimatePit.result.recoveredOz / 1000), 0)} koz`, color: 'text-amber-400' },
                      ].map(k => (
                        <div key={k.label}>
                          <div className="text-[10px] mf-txt4">{k.label}</div>
                          <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                        </div>
                      ))}
                    </div>
                    {p?.reserves_mt != null && ultimatePit.result.oreTonnes > 0 && (() => {
                      const optMt = ultimatePit.result.oreTonnes / 1e6;
                      const drift = Math.abs(p.reserves_mt - optMt) / optMt > 0.1;
                      return (
                        <div className={`text-[10px] mt-2 ${drift ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {drift ? '⚠' : '✓'} Réserves saisies {formatDecimalGrouped(p.reserves_mt, 1)} Mt vs. fosse optimale {formatDecimalGrouped(optMt, 2)} Mt.
                          {drift && ' Le plan LOM utilise les réserves saisies — les aligner sur la fosse optimisée.'}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Nested shells */}
                {shells.length > 0 && (
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Shells économiques emboîtées</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Une optimisation par facteur de revenu. Les shells basses révèlent le cœur à haute valeur qui se paie
                    en premier — elles deviennent la séquence de pushbacks de l'étape 3.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="tbl w-full text-xs">
                      <thead>
                        <tr>
                          {['Facteur', 'Prix Au', 'Blocs', 'Minerai (Mt)', 'Stérile (Mt)', 'RS', 'koz récup.', 'Valeur (M$)'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shells.map(s => {
                          const isBase = Math.abs(s.revenueFactor - 1) < 1e-9;
                          return (
                            <tr key={s.revenueFactor} className={`border-b border-white/5 ${isBase ? 'bg-amber-400/5' : ''}`}>
                              <td className={`px-3 py-1.5 font-mono ${isBase ? 'text-amber-400 font-bold' : 'mf-txt3'}`}>
                                {formatDecimalGrouped(s.revenueFactor, 2)}{isBase ? ' ★' : ''}
                              </td>
                              <td className="px-3 py-1.5 mf-txt3">${formatDecimalGrouped(s.goldPriceUsdOz, 0)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{s.result.blocksInPit.toLocaleString('fr-CA')}</td>
                              <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped((s.result.oreTonnes / 1e6), 2)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((s.result.wasteTonnes / 1e6), 2)}</td>
                              <td className="px-3 py-1.5 text-sky-400">{formatDecimalGrouped(s.result.strippingRatio, 2)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((s.result.recoveredOz / 1000), 0)}</td>
                              <td className="px-3 py-1.5 font-bold text-emerald-400">{formatDecimalGrouped((s.result.totalValueUsd / 1e6), 1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}

                {/* Pit shell cross-section */}
                {pitViz && pitViz.section.some(s => s.floorByI.some(v => v !== null)) && (
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-2">Coupe des shells (Pit Shell)</div>
                    <PitSection viz={pitViz} />
                  </div>
                )}

                {/* Geotech */}
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Paramètres géotechniques</div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Angle de talus', val: `${params.slope_angle_deg}°`, sub: 'Contraint la préséance' },
                      { label: 'Hauteur de banc', val: `${params.bench_height_m} m`, sub: 'Résolution du cône' },
                      { label: 'Taille de bloc', val: `${formatDecimalGrouped(blockSize.x, 0)} × ${formatDecimalGrouped(blockSize.y, 0)} m`, sub: 'Lue du modèle' },
                      { label: 'Niveaux du cône', val: `${MINE_MODEL.CONE_LEVELS}`, sub: 'Bancs de préséance' },
                    ].map(g => (
                      <div key={g.label}>
                        <div className="text-[10px] mf-txt4">{g.label}</div>
                        <div className="text-lg font-bold mf-txt">{g.val}</div>
                        <div className="text-[9px] mf-txt4">{g.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
}
