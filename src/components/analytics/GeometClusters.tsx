// ─────────────────────────────────────────────────────────────────────────────
// Clustering géométallurgique — sous-page « Géométallurgie ».
//
// Découvre les populations métallurgiques réelles (k-means déterministe) sur les
// caractéristiques du minerai, indépendamment des domaines géologiques. Suggère
// le nombre de clusters par silhouette et affiche le profil (centroïde) de
// chaque population. Module pur analytics/geometClustering.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { kmeansGeomet, suggestK, type ClusterInput } from '../../lib/analytics/geometClustering';

interface Props {
  data: ClusterInput[];
  featureNames: string[];
  featureUnits?: string[];
}

const CLUSTER_COLORS = ['#14b8a6', '#f59e0b', '#9d78f0', '#38bdf8', '#ef4444'];

export function GeometClusters({ data, featureNames, featureUnits }: Props) {
  const result = useMemo(() => {
    if (data.length < 4) return null;
    const best = suggestK(data, 5);
    if (!best) return null;
    const km = kmeansGeomet(data, best.k);
    return km ? { km, suggestedK: best.k } : null;
  }, [data]);

  if (data.length < 4) {
    return (
      <div className="card">
        <div className="text-sm font-semibold text-mf-txt mb-1">Populations métallurgiques (clustering)</div>
        <div className="text-xs text-mf-txt3">
          Au moins 4 échantillons avec caractéristiques complètes (BWi, S sulfure, C org, GRG, Au libre)
          sont nécessaires pour découvrir des populations métallurgiques. Actuellement {data.length}.
        </div>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="card">
        <div className="text-sm font-semibold text-mf-txt mb-1">Populations métallurgiques (clustering)</div>
        <div className="text-xs text-mf-txt3">Données trop homogènes ou colinéaires pour dégager des populations distinctes.</div>
      </div>
    );
  }

  const { km } = result;
  const qual = km.silhouette >= 0.5 ? 'populations nettes' : km.silhouette >= 0.25 ? 'séparation modérée' : 'chevauchement fort';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-mf-txt">Populations métallurgiques (k-means)</div>
        <span className="text-[11px] text-mf-txt3">{km.k} populations · silhouette {km.silhouette.toFixed(2)} · {qual}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-mf-txt3 border-b border-mf-border">
              <th className="text-left py-1.5 pr-2">Population</th>
              <th className="text-right px-2">Effectif</th>
              {featureNames.map((f, i) => (
                <th key={f} className="text-right px-2">{f}{featureUnits?.[i] ? <span className="text-mf-txt4"> ({featureUnits[i]})</span> : null}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {km.centroids.map((c, ci) => (
              <tr key={ci} className="border-b border-mf-border/50">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CLUSTER_COLORS[ci % CLUSTER_COLORS.length] }} />
                    <span className="text-mf-txt font-medium">Pop. {ci + 1}</span>
                  </span>
                </td>
                <td className="text-right px-2 text-mf-txt">{km.sizes[ci]}</td>
                {c.map((v, fi) => (
                  <td key={fi} className="text-right px-2 text-mf-txt2">{v.toFixed(v >= 100 ? 0 : 1)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-mf-txt3 leading-snug">
        Chaque population regroupe des échantillons au comportement métallurgique proche, indépendamment du domaine géologique.
        Un profil à BWi élevé + Au libre bas signale une population dure et réfractaire à isoler dans le plan de blend.
      </div>
    </div>
  );
}
