// Champs d'édition du module Coûts miniers : chaque valeur affiche sa
// provenance (Projet, Mine & Optimisation, Paramètres, Référence, Saisi) et
// peut être remise à sa valeur d'origine.

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { InputOrigin, Provenance } from '../../../lib/mining/types';
import type { MiningCostState } from './useMiningCostModel';
import { provenanceOf } from './provenance';

const ORIGIN_META: Record<InputOrigin, { label: string; cls: string }> = {
  projet:    { label: 'Projet',      cls: 'text-sky-300 border-sky-400/30 bg-sky-400/10' },
  mine:      { label: 'Mine & Opt.', cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  settings:  { label: 'Paramètres',  cls: 'text-violet-300 border-violet-400/30 bg-violet-400/10' },
  economie:  { label: 'Économie',    cls: 'text-teal-300 border-teal-400/30 bg-teal-400/10' },
  reference: { label: 'Référence',   cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  derive:    { label: 'Calculé',     cls: 'mf-txt3 border-white/15 bg-white/5' },
  override:  { label: 'Saisi',       cls: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
};

export function ProvenanceBadge({ p }: { p: Provenance | undefined }) {
  if (!p) return null;
  const m = ORIGIN_META[p.origin];
  return (
    <span title={p.source} className={`inline-block text-[9px] px-1 py-0 rounded border whitespace-nowrap ${m.cls}`}>
      {m.label}
    </span>
  );
}

/**
 * Champ numérique lié à un chemin du modèle. Brouillon local, validé à la
 * sortie du champ (ou Entrée) — même comportement que les paramètres de
 * l'Économie, pour ne pas recalculer à chaque frappe.
 */
export function NumField({ state, path, label, unit, step = 'any', scale = 1, digits }: {
  state: MiningCostState;
  path: string;
  label: string;
  unit?: string;
  step?: string;
  /** Facteur d'affichage (ex. 100 pour afficher une fraction en %). */
  scale?: number;
  digits?: number;
}) {
  const raw = state.valueAt(path);
  const value = typeof raw === 'number' ? raw * scale : null;
  const fmt = (v: number | null) => (v == null ? '' : digits != null ? String(+v.toFixed(digits)) : String(+v.toPrecision(10)));
  const [draft, setDraft] = useState(fmt(value));
  useEffect(() => { setDraft(fmt(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const n = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(n)) { setDraft(fmt(value)); return; }
    if (value != null && Math.abs(n - value) < 1e-12) return;
    state.setOverride(path, n / scale);
  }

  return (
    <label className="flex items-center gap-2 text-xs py-0.5">
      <span className="mf-txt3 flex-1 min-w-0 truncate" title={label}>{label}</span>
      <input
        type="number" step={step} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="input-field text-xs text-right w-24 py-0.5"
      />
      <span className="text-[10px] mf-txt4 w-14 shrink-0">{unit}</span>
      <span className="w-[68px] shrink-0 flex items-center gap-1">
        <ProvenanceBadge p={provenanceOf(state, path)} />
        {state.isOverridden(path) && (
          <button type="button" title="Revenir à la valeur d'origine" onClick={() => state.resetOverride(path)} className="mf-txt4 hover:text-amber-300">
            <RotateCcw size={10} />
          </button>
        )}
      </span>
    </label>
  );
}

export function Section({ title, subtitle, children, defaultOpen = false, right }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-sm">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs font-semibold mf-txt flex-1 text-left">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
          {subtitle && <span className="font-normal mf-txt4 ml-1">{subtitle}</span>}
        </button>
        {right}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * Éditeur de tableau d'objets (catalogue d'engins, taux, effectifs…) : toute
 * modification remplace le tableau complet sous son chemin (une surcharge).
 */
export function ArrayTable<T extends Record<string, unknown>>({ state, path, columns, rowKey, newRow, title }: {
  state: MiningCostState;
  path: string;
  columns: { key: keyof T & string; label: string; type?: 'text' | 'number' | 'select'; options?: { value: string; label: string }[]; width?: string; scale?: number }[];
  rowKey: (r: T, i: number) => string;
  newRow?: () => T;
  title?: string;
}) {
  const rows = (state.valueAt(path) as T[] | undefined) ?? [];
  const update = (i: number, key: string, v: unknown) => {
    const next = rows.map((r, j) => (j === i ? { ...r, [key]: v } : r));
    state.setOverride(path, next);
  };
  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-2 mb-1">
        {title && <span className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">{title}</span>}
        <ProvenanceBadge p={provenanceOf(state, path)} />
        {state.isOverridden(path) && (
          <button type="button" onClick={() => state.resetOverride(path)} className="text-[10px] mf-txt4 hover:text-amber-300 flex items-center gap-1">
            <RotateCcw size={10} /> Réinitialiser
          </button>
        )}
      </div>
      <table className="tbl w-full text-[11px]">
        <thead>
          <tr>
            {columns.map(c => <th key={c.key} className="text-left px-2 py-1 mf-txt3 font-semibold whitespace-nowrap">{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-white/5">
              {columns.map(c => {
                const v = r[c.key];
                const scale = c.scale ?? 1;
                return (
                  <td key={c.key} className="px-1 py-0.5">
                    {c.type === 'select' ? (
                      <select className="input-field text-[11px] py-0.5" value={String(v ?? '')} onChange={e => update(i, c.key, e.target.value)}>
                        {(c.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : c.type === 'text' ? (
                      <input className={`input-field text-[11px] py-0.5 ${c.width ?? 'w-48'}`} defaultValue={String(v ?? '')}
                        key={`${rowKey(r, i)}-${c.key}-${String(v)}`}
                        onBlur={e => { if (e.target.value !== v) update(i, c.key, e.target.value); }} />
                    ) : (
                      <input type="number" step="any" className={`input-field text-[11px] py-0.5 text-right ${c.width ?? 'w-20'}`}
                        defaultValue={typeof v === 'number' ? +(v * scale).toPrecision(8) : ''}
                        key={`${rowKey(r, i)}-${c.key}-${String(v)}`}
                        onBlur={e => {
                          const n = parseFloat(e.target.value);
                          if (Number.isFinite(n) && n / scale !== v) update(i, c.key, n / scale);
                        }} />
                    )}
                  </td>
                );
              })}
              <td className="px-1">
                <button type="button" onClick={() => state.setOverride(path, rows.filter((_, j) => j !== i))} className="text-red-400/40 hover:text-red-400">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {newRow && (
        <button type="button" onClick={() => state.setOverride(path, [...rows, newRow()])} className="btn btn-secondary text-[11px] mt-1 py-0.5">
          + Ajouter une ligne
        </button>
      )}
    </div>
  );
}
