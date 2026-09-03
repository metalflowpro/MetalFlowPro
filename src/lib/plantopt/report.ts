// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Rapport & export (Markdown, Excel, impression PDF)
//
// Construit un rapport lisible du run courant et l'exporte : classeur Excel
// (KPIs + aires + goulots) via `xlsx`, et impression PDF via une fenêtre dédiée
// (le navigateur produit le PDF). Aucune donnée figée : tout provient du modèle et
// du résultat passés en argument.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from '@e965/xlsx';
import type { PlantModel, SimConfig, SimResult } from './types';

/** Formate un nombre entier avec séparateur de milliers FR. */
function n0(v: number): string {
  return Math.round(v).toLocaleString('fr-FR');
}

/** Aires triées par probabilité de goulot décroissante. */
function bottleneckRanking(model: PlantModel, result: SimResult): { name: string; prob: number }[] {
  return model.areas
    .map(a => ({ name: a.name, prob: result.bottleneckProbability[a.id] ?? 0 }))
    .sort((x, y) => y.prob - x.prob);
}

/** Construit le rapport au format Markdown. */
export function buildReportMarkdown(model: PlantModel, config: SimConfig, result: SimResult, projectCode?: string): string {
  const horizon = config.horizonHours ?? model.horizonHours;
  const ranking = bottleneckRanking(model, result);
  const top = ranking[0];
  const lines: string[] = [];
  lines.push('# Rapport Plant Optimizer');
  if (projectCode) lines.push(`**Projet :** ${projectCode}`);
  lines.push(`**Date :** ${new Date().toLocaleDateString('fr-FR')}`);
  lines.push('');
  lines.push('## Paramètres de simulation');
  lines.push(`- Itérations Monte Carlo : ${config.iterations}`);
  lines.push(`- Horizon : ${n0(horizon)} heures`);
  lines.push(`- Graine (seed) : ${config.seed}`);
  lines.push(`- Rodage exclu : ${config.warmupHours} h · Pas de temps : ${config.timeStepHours} h`);
  lines.push('');
  lines.push('## Résultats principaux');
  lines.push('');
  lines.push('| Indicateur | Valeur |');
  lines.push('| --- | --- |');
  lines.push(`| Débit P10 | ${n0(result.throughputP10)} t/h |`);
  lines.push(`| Débit P50 (médiane) | ${n0(result.throughputP50)} t/h |`);
  lines.push(`| Débit P90 | ${n0(result.throughputP90)} t/h |`);
  lines.push(`| Incertitude P10→P90 | ${n0(result.throughputP90 - result.throughputP10)} t/h |`);
  lines.push(`| Disponibilité usine | ${(100 * result.availability).toFixed(1)} % |`);
  lines.push(`| Coût OPEX moyen | ${result.costPerTonne.toFixed(2)} ${model.currency} / t |`);
  lines.push(`| Récupération | ${(100 * result.recoveryMean).toFixed(1)} % |`);
  lines.push(`| Débit récupéré P50 | ${n0(result.recoveredThroughputP50)} t/h |`);
  lines.push('');
  lines.push('## Analyse des goulots');
  lines.push('');
  if (top) lines.push(`- **${top.name}** : ${(100 * top.prob).toFixed(1)} % des scénarios`);
  for (const r of ranking.slice(1)) {
    if (r.prob > 0) lines.push(`- ${r.name} : ${(100 * r.prob).toFixed(1)} %`);
  }
  return lines.join('\n');
}

/** Exporte le run courant en classeur Excel (feuilles Résumé / Aires / Goulots). */
export function exportReportExcel(model: PlantModel, config: SimConfig, result: SimResult): void {
  const wb = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ['Indicateur', 'Valeur', 'Unité'],
    ['Débit P10', Math.round(result.throughputP10), 't/h'],
    ['Débit P50', Math.round(result.throughputP50), 't/h'],
    ['Débit P90', Math.round(result.throughputP90), 't/h'],
    ['Incertitude P10→P90', Math.round(result.throughputP90 - result.throughputP10), 't/h'],
    ['Disponibilité usine', Number((100 * result.availability).toFixed(1)), '%'],
    ['Coût OPEX moyen', Number(result.costPerTonne.toFixed(2)), `${model.currency}/t`],
    ['Récupération moyenne', Number((100 * result.recoveryMean).toFixed(1)), '%'],
    ['Débit récupéré P50', Math.round(result.recoveredThroughputP50), 't/h'],
    [],
    ['Itérations', config.iterations, ''],
    ['Horizon', config.horizonHours ?? model.horizonHours, 'h'],
    ['Graine', config.seed, ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Résumé');

  const areasSheet: (string | number)[][] = [['Aire', 'Ordre', 'Min (t/h)', 'Mode (t/h)', 'Max (t/h)', 'OPEX/t', 'Prob. goulot %']];
  for (const a of [...model.areas].sort((x, y) => x.processOrder - y.processOrder)) {
    const p = a.capacityDist.params;
    areasSheet.push([
      a.name, a.processOrder,
      typeof p.min === 'number' ? Math.round(p.min) : '',
      typeof p.mode === 'number' ? Math.round(p.mode) : '',
      typeof p.max === 'number' ? Math.round(p.max) : '',
      a.opexPerTonne,
      Number((100 * (result.bottleneckProbability[a.id] ?? 0)).toFixed(1)),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(areasSheet), 'Aires');

  const bn: (string | number)[][] = [['Aire', 'Probabilité goulot %']];
  for (const r of bottleneckRanking(model, result)) bn.push([r.name, Number((100 * r.prob).toFixed(1))]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bn), 'Goulots');

  XLSX.writeFile(wb, 'plant_optimizer_rapport.xlsx');
}

/** Ouvre une fenêtre d'impression contenant le rapport (le navigateur produit le PDF). */
export function printReport(markdown: string, title = 'Rapport Plant Optimizer'): void {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    '<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:800px;margin:32px auto;color:#111;line-height:1.5}' +
    'pre{white-space:pre-wrap;font:inherit}h1{font-size:22px}</style></head>' +
    `<body><pre>${esc(markdown)}</pre></body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}
