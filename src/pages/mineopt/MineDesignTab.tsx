import { formatDecimalGrouped } from '../../lib/format/number';
import { Layers, Truck, Save,
  Plus, Trash2, Map as MapIcon, GitBranch, X,
} from 'lucide-react';
import type { PitViz } from '../../lib/mine/pitOptimizer.worker';
import { Pit3D, PitDiagnostic } from '../../components/mine/PitViews';

import { DesignBench, DesignPit, EQUIP_TYPES, EXPLOSIVE_TYPES, EquipSchedule, MineParamsRow, PIT_STATUS_META } from './model';

interface MineDesignTabProps {
  Map: MapConstructor;
  Math: Math;
  Object: ObjectConstructor;
  Set: SetConstructor;
  addDesignBench: () => Promise<void>;
  addDesignPit: () => Promise<void>;
  addEquipSchedule: () => Promise<void>;
  annualOreMt: number;
  benchForm: Partial<DesignBench>;
  deleteDesignBench: (id: string) => Promise<void>;
  deleteDesignPit: (id: string) => Promise<void>;
  deleteEquipSchedule: (id: string) => Promise<void>;
  designBenches: DesignBench[];
  designPits: DesignPit[];
  designSaving: boolean;
  designTab: "pits" | "benches" | "equipment" | "plan" | "3d";
  equipForm: Partial<EquipSchedule>;
  equipSchedule: EquipSchedule[];
  params: MineParamsRow;
  pitForm: Partial<DesignPit>;
  pitViz: PitViz | null;
  selectedPitId: string | null;
  setBenchForm: React.Dispatch<React.SetStateAction<Partial<DesignBench>>>;
  setDesignTab: React.Dispatch<React.SetStateAction<"pits" | "benches" | "equipment" | "plan" | "3d">>;
  setEquipForm: React.Dispatch<React.SetStateAction<Partial<EquipSchedule>>>;
  setPitForm: React.Dispatch<React.SetStateAction<Partial<DesignPit>>>;
  setSelectedPitId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowBenchForm: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEquipForm: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPitForm: React.Dispatch<React.SetStateAction<boolean>>;
  showBenchForm: boolean;
  showEquipForm: boolean;
  showPitForm: boolean;
  updateDesignPit: (id: string, patch: Partial<DesignPit>) => Promise<void>;
}

export function MineDesignTab({ Map, Math, Object, Set, addDesignBench, addDesignPit, addEquipSchedule, annualOreMt, benchForm, deleteDesignBench, deleteDesignPit, deleteEquipSchedule, designBenches, designPits, designSaving, designTab, equipForm, equipSchedule, params, pitForm, pitViz, selectedPitId, setBenchForm, setDesignTab, setEquipForm, setPitForm, setSelectedPitId, setShowBenchForm, setShowEquipForm, setShowPitForm, showBenchForm, showEquipForm, showPitForm, updateDesignPit }: MineDesignTabProps) {
  return (
          <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="flex items-center justify-between">
              <div className="flex rounded-lg overflow-hidden border border-mf-border">
                {(['pits', 'benches', 'equipment', 'plan', '3d'] as const).map(t => (
                  <button key={t} onClick={() => setDesignTab(t)}
                    className={`px-4 py-2 text-xs font-semibold transition-colors ${designTab === t ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
                    {t === 'pits' ? 'Phases Pit' : t === 'benches' ? 'Bancs & Géologie' : t === 'equipment' ? 'Flotte & Équipements' : t === 'plan' ? 'Vue d\'ensemble' : 'Vue 3D'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {designTab === 'pits' && (
                  <button onClick={() => setShowPitForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Nouvelle phase pit
                  </button>
                )}
                {designTab === 'benches' && (
                  <button onClick={() => setShowBenchForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Ajouter banc
                  </button>
                )}
                {designTab === 'equipment' && (
                  <button onClick={() => setShowEquipForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Planifier équipement
                  </button>
                )}
              </div>
            </div>

            {/* ── Pits tab ── */}
            {designTab === 'pits' && (
              <div className="space-y-3">
                {/* Summary KPIs */}
                {designPits.length > 0 && (
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Phases pit',      val: designPits.length.toString(),                                                             color: 'text-amber-400' },
                      { label: 'Minerai total',    val: `${formatDecimalGrouped(designPits.reduce((s,p)=>s+p.ore_mt,0), 1)} Mt`,                               color: 'text-emerald-400' },
                      { label: 'Stérile total',    val: `${formatDecimalGrouped(designPits.reduce((s,p)=>s+p.waste_mt,0), 1)} Mt`,                             color: 'text-sky-400' },
                      { label: 'RS global',        val: designPits.reduce((s,p)=>s+p.ore_mt,0)>0 ? `${formatDecimalGrouped((designPits.reduce((s,p)=>s+p.waste_mt,0)/designPits.reduce((s,p)=>s+p.ore_mt,0)), 1)}:1` : '—', color: 'text-orange-400' },
                    ].map(k => (
                      <div key={k.label} className="card-sm py-2">
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`text-lg font-bold font-mono ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pit list */}
                {designPits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <MapIcon size={28} className="text-amber-400" />
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold mf-txt mb-1">Aucune phase pit définie</div>
                      <div className="text-xs mf-txt4 max-w-xs">Définissez les phases d'excavation (push-backs), les enveloppes de pit et les paramètres géotechniques.</div>
                    </div>
                    <button onClick={() => setShowPitForm(true)} className="btn btn-teal flex items-center gap-2 text-xs">
                      <Plus size={13} /> Créer la Phase 1
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {designPits.map((pit) => {
                      const benches = designBenches.filter(b => b.pit_id === pit.id);
                      const depth = pit.crest_rl != null && pit.floor_rl != null ? pit.crest_rl - pit.floor_rl : null;
                      const nBenches = depth != null ? Math.floor(depth / pit.bench_height_m) : null;
                      const isSelected = selectedPitId === pit.id;
                      return (
                        <div key={pit.id}
                          className={`card-sm cursor-pointer transition-all ${isSelected ? 'border-amber-400/50 bg-amber-400/5' : 'hover:border-white/15'}`}
                          onClick={() => setSelectedPitId(isSelected ? null : pit.id)}>
                          <div className="flex items-start gap-3">
                            <div className="w-2 self-stretch rounded-full shrink-0 mt-1" style={{ backgroundColor: pit.color, minHeight: 40 }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="text-sm font-semibold mf-txt">{pit.name}</div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: PIT_STATUS_META[pit.status]?.color + '22', color: PIT_STATUS_META[pit.status]?.color }}>
                                  {PIT_STATUS_META[pit.status]?.label}
                                </span>
                                <span className="text-[10px] mf-txt4">{pit.pit_type === 'open_pit' ? 'Ciel ouvert' : 'Souterrain'}</span>
                              </div>
                              <div className="grid grid-cols-5 gap-3 text-xs">
                                {[
                                  { label: 'Minerai',    val: `${pit.ore_mt} Mt`, sub: `@ ${pit.grade_g_t} g/t` },
                                  { label: 'Stérile',    val: `${pit.waste_mt} Mt`, sub: `RS ${pit.strip_ratio?.toFixed(1)}:1` },
                                  { label: 'Profondeur', val: depth != null ? `${formatDecimalGrouped(depth, 0)} m` : '—', sub: `${pit.crest_rl ?? '?'} → ${pit.floor_rl ?? '?'} mRL` },
                                  { label: 'Talus',      val: `${pit.slope_angle_deg}°`, sub: `Bancs ${pit.bench_height_m}m` },
                                  { label: 'Bancs définis', val: benches.length.toString(), sub: nBenches != null ? `${nBenches} théoriques` : '' },
                                ].map(k => (
                                  <div key={k.label}>
                                    <div className="mf-txt4 text-[10px]">{k.label}</div>
                                    <div className="font-semibold mf-txt font-mono">{k.val}</div>
                                    <div className="text-[10px] mf-txt4">{k.sub}</div>
                                  </div>
                                ))}
                              </div>
                              {pit.notes && <div className="text-[10px] mf-txt4 mt-2 italic">{pit.notes}</div>}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <select value={pit.status} onClick={e => e.stopPropagation()}
                                onChange={e => updateDesignPit(pit.id, { status: e.target.value as DesignPit['status'] })}
                                className="input-field text-[10px] py-0.5 px-1 w-24">
                                {Object.entries(PIT_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select>
                              <button onClick={e => { e.stopPropagation(); deleteDesignPit(pit.id); }}
                                className="text-red-400/50 hover:text-red-400 transition-colors p-1">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Benches tab ── */}
            {designTab === 'benches' && (
              <div className="space-y-3">
                {/* Pit selector */}
                {designPits.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs mf-txt3">Filtrer par pit:</span>
                    <button onClick={() => setSelectedPitId(null)}
                      className={`px-2.5 py-1 rounded text-xs ${selectedPitId == null ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
                      Tous
                    </button>
                    {designPits.map(p => (
                      <button key={p.id} onClick={() => setSelectedPitId(p.id)}
                        className={`px-2.5 py-1 rounded text-xs ${selectedPitId === p.id ? 'text-white' : 'mf-txt3 hover:mf-txt'}`}
                        style={selectedPitId === p.id ? { backgroundColor: p.color + '33', color: p.color } : {}}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Bench section visualization + table */}
                {(() => {
                  const filtered = selectedPitId ? designBenches.filter(b => b.pit_id === selectedPitId) : designBenches;
                  const pit = designPits.find(p => p.id === selectedPitId);
                  if (filtered.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Layers size={28} className="mf-txt4 opacity-30" />
                      <div className="text-xs mf-txt3">Aucun banc — ajoutez des niveaux de bancs pour détailler le plan d'extraction</div>
                    </div>
                  );
                  const _maxOre = Math.max(...filtered.map(b => b.ore_mt + b.waste_mt), 1);
                  const minRL = Math.min(...filtered.map(b => b.bench_rl));
                  const maxRL = Math.max(...filtered.map(b => b.bench_rl));
                  return (
                    <div className="grid grid-cols-3 gap-4">
                      {/* Section view */}
                      <div className="card-sm col-span-1">
                        <div className="text-xs font-semibold mf-txt mb-3 flex items-center gap-1.5">
                          <Layers size={12} className="text-amber-400" />
                          Coupe de pit — {filtered.length} bancs
                        </div>
                        <svg viewBox="0 0 220 340" className="w-full">
                          {filtered.map((b) => {
                            const yFrac = maxRL === minRL ? 0.5 : (maxRL - b.bench_rl) / (maxRL - minRL);
                            const y = 20 + yFrac * 290;
                            const totalMt = b.ore_mt + b.waste_mt;
                            const oreBarW = totalMt > 0 ? (b.ore_mt / totalMt) * 120 : 0;
                            const wasteBarW = totalMt > 0 ? (b.waste_mt / totalMt) * 120 : 0;
                            const pitCol = pit?.color ?? '#F59E0B';
                            return (
                              <g key={b.id}>
                                <rect x={40} y={y - 7} width={oreBarW} height={12} fill="#10B98144" stroke="#10B981" strokeWidth={0.5} rx={1} />
                                <rect x={40 + oreBarW} y={y - 7} width={wasteBarW} height={12} fill={pitCol + '33'} stroke={pitCol} strokeWidth={0.5} rx={1} />
                                <text x={36} y={y + 3} textAnchor="end" fontSize={7} fill="#ffffffaa">{b.bench_rl}m</text>
                                {b.grade_g_t > 0 && <text x={40 + oreBarW + wasteBarW + 3} y={y + 3} fontSize={6} fill="#10B981aa">{b.grade_g_t}g/t</text>}
                              </g>
                            );
                          })}
                          <text x={105} y={330} textAnchor="middle" fontSize={7} fill="#ffffff30">Tonnage (relative)</text>
                        </svg>
                      </div>
                      {/* Table */}
                      <div className="col-span-2 overflow-x-auto">
                        <table className="tbl w-full text-xs">
                          <thead>
                            <tr>{['RL (mRL)', 'Minerai (Mt)', 'Stérile (Mt)', 'Teneur (g/t)', 'Larg. (m)', 'Long. (m)', 'Schéma tir', 'Explosif', 'Facteur poudre', 'Type minerai', ''].map(h => (
                              <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold whitespace-nowrap">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {filtered.map(b => (
                              <tr key={b.id} className="border-b border-white/5 hover:bg-white/3">
                                <td className="px-2 py-1.5 font-mono font-semibold mf-txt">{b.bench_rl}</td>
                                <td className="px-2 py-1.5 font-mono text-emerald-300">{b.ore_mt}</td>
                                <td className="px-2 py-1.5 font-mono mf-txt3">{b.waste_mt}</td>
                                <td className="px-2 py-1.5 font-mono text-amber-300">{b.grade_g_t > 0 ? b.grade_g_t : '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.width_m ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.length_m ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.blast_pattern ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.explosive_type ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.powder_factor ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.ore_type ?? '—'}</td>
                                <td className="px-2 py-1.5">
                                  <button onClick={() => deleteDesignBench(b.id)} className="text-red-400/40 hover:text-red-400 transition-colors">
                                    <Trash2 size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Equipment tab ── */}
            {designTab === 'equipment' && (
              <div className="space-y-3">
                {/* Pit filter */}
                {designPits.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs mf-txt3">Filtrer:</span>
                    <button onClick={() => setSelectedPitId(null)} className={`px-2.5 py-1 rounded text-xs ${selectedPitId == null ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>Tous</button>
                    {designPits.map(p => (
                      <button key={p.id} onClick={() => setSelectedPitId(p.id)} className={`px-2.5 py-1 rounded text-xs ${selectedPitId === p.id ? 'text-white' : 'mf-txt3 hover:mf-txt'}`} style={selectedPitId === p.id ? { backgroundColor: p.color + '33', color: p.color } : {}}>{p.name}</button>
                    ))}
                  </div>
                )}

                {/* Equipment schedule table */}
                {(() => {
                  const filtered = selectedPitId ? equipSchedule.filter(e => e.pit_id === selectedPitId) : equipSchedule;
                  if (filtered.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Truck size={28} className="mf-txt4 opacity-30" />
                      <div className="text-xs mf-txt3">Aucun équipement planifié — définissez la flotte minière par année et par phase</div>
                    </div>
                  );
                  // Group by year
                  const yearMap = new Map<number, EquipSchedule[]>();
                  for (const e of filtered) {
                    if (!yearMap.has(e.year)) yearMap.set(e.year, []);
                    yearMap.get(e.year)!.push(e);
                  }
                  const totalAnnualCost = (e: EquipSchedule) => e.quantity * e.hours_year * e.cost_h / 1e6;
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Équipements', val: filtered.length.toString(), color: 'text-amber-400' },
                          { label: 'Unités total', val: filtered.reduce((s,e)=>s+e.quantity,0).toString(), color: 'text-sky-400' },
                          { label: 'Coût flotte/an', val: `${formatDecimalGrouped(filtered.reduce((s,e)=>s+totalAnnualCost(e),0), 1)} M$`, color: 'text-emerald-400' },
                        ].map(k => <div key={k.label} className="card-sm py-2"><div className="text-[10px] mf-txt4">{k.label}</div><div className={`text-lg font-bold font-mono ${k.color}`}>{k.val}</div></div>)}
                      </div>
                      {[...yearMap.entries()].sort((a,b)=>a[0]-b[0]).map(([year, items]) => (
                        <div key={year} className="card-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-lg bg-amber-400/15 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-amber-400">{year}</span>
                            </div>
                            <div className="text-xs font-semibold mf-txt">Année {year}</div>
                            <div className="text-[10px] mf-txt4">{items.reduce((s,e)=>s+e.quantity,0)} unités · {formatDecimalGrouped(items.reduce((s,e)=>s+totalAnnualCost(e),0), 2)} M$</div>
                          </div>
                          <div className="space-y-1">
                            {items.map(e => (
                              <div key={e.id} className="flex items-center gap-3 py-1.5 px-2 rounded bg-white/3 text-xs">
                                <Truck size={11} className="text-amber-400 shrink-0" />
                                <span className="font-semibold mf-txt w-32 shrink-0 truncate">{e.equipment_name}</span>
                                <span className="mf-txt4 text-[10px] w-20 shrink-0">{e.equipment_type}</span>
                                <span className="font-mono mf-txt3">{e.quantity}× · {e.hours_year}h/an</span>
                                <span className="font-mono text-emerald-300 ml-auto">{formatDecimalGrouped(totalAnnualCost(e), 2)} M$/an</span>
                                {e.notes && <span className="text-[10px] mf-txt4 italic">{e.notes}</span>}
                                <button onClick={() => deleteEquipSchedule(e.id)} className="text-red-400/40 hover:text-red-400 transition-colors ml-1 shrink-0">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Plan overview tab ── */}
            {designTab === 'plan' && (
              <div className="space-y-4">
                {/* Timeline Gantt-style */}
                {designPits.length === 0 ? (
                  <div className="text-center mf-txt4 text-xs py-16">Définissez des phases pit pour visualiser le plan d'exploitation</div>
                ) : (() => {
                  const lomLen = Math.max(params?.lom_years ?? 10, 1);
                  const yearCols = Array.from({ length: lomLen }, (_, i) => i + 1);
                  const totalOre = designPits.reduce((s,p)=>s+p.ore_mt,0);
                  const totalWaste = designPits.reduce((s,p)=>s+p.waste_mt,0);
                  const annualMine = params ? annualOreMt : null;

                  return (
                    <div className="space-y-4">
                      {/* Summary bar */}
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          { label: 'Phases pit',     val: designPits.length.toString(),               color: 'text-amber-400' },
                          { label: 'Minerai total',  val: `${formatDecimalGrouped(totalOre, 1)} Mt`,                color: 'text-emerald-400' },
                          { label: 'Stérile total',  val: `${formatDecimalGrouped(totalWaste, 1)} Mt`,              color: 'text-sky-400' },
                          { label: 'RS global',      val: totalOre>0 ? `${formatDecimalGrouped((totalWaste/totalOre), 1)}:1` : '—', color: 'text-orange-400' },
                          { label: 'Extraction/an',  val: annualMine!=null ? `${formatDecimalGrouped(annualMine, 2)} Mt/an` : '—', color: 'text-purple-400' },
                        ].map(k => <div key={k.label} className="card-sm py-2"><div className="text-[10px] mf-txt4">{k.label}</div><div className={`text-base font-bold font-mono ${k.color}`}>{k.val}</div></div>)}
                      </div>

                      {/* Gantt chart */}
                      <div className="card-sm overflow-x-auto">
                        <div className="text-xs font-semibold mf-txt mb-3 flex items-center gap-2">
                          <GitBranch size={13} className="text-amber-400" />
                          Séquencement des phases — LOM {lomLen} ans
                        </div>
                        <div className="min-w-max">
                          {/* Header */}
                          <div className="flex mb-1">
                            <div className="w-40 shrink-0" />
                            {yearCols.map(y => (
                              <div key={y} className="w-12 text-center text-[10px] mf-txt4 font-mono">An {y}</div>
                            ))}
                          </div>
                          {/* Phase rows */}
                          {designPits.map(pit => {
                            const startYear = pit.sequence_order;
                            const pitOrePerYear = annualMine ?? 1;
                            const durationYears = Math.max(1, Math.ceil(pit.ore_mt / Math.max(0.01, pitOrePerYear)));
                            return (
                              <div key={pit.id} className="flex items-center mb-1.5">
                                <div className="w-40 shrink-0 text-xs mf-txt truncate pr-2">{pit.name}</div>
                                {yearCols.map(y => {
                                  const active = y >= startYear && y < startYear + durationYears;
                                  return (
                                    <div key={y} className={`w-12 h-7 border-r border-white/3 ${active ? 'first:rounded-l last:rounded-r' : ''}`}
                                      style={active ? { backgroundColor: pit.color + '40', borderTop: `2px solid ${pit.color}` } : {}}>
                                      {active && y === startYear && (
                                        <div className="text-[8px] px-1 truncate" style={{ color: pit.color }}>{pit.name.substring(0, 6)}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                          {/* Equipment rows */}
                          {equipSchedule.length > 0 && (
                            <>
                              <div className="text-[10px] mf-txt4 mt-3 mb-1 uppercase tracking-wider">Équipements planifiés</div>
                              {[...new Set(equipSchedule.map(e=>e.equipment_type))].map(type => {
                                const items = equipSchedule.filter(e=>e.equipment_type===type);
                                return (
                                  <div key={type} className="flex items-center mb-1">
                                    <div className="w-40 shrink-0 text-[10px] mf-txt3 truncate pr-2 flex items-center gap-1">
                                      <Truck size={9} /> {type}
                                    </div>
                                    {yearCols.map(y => {
                                      const qty = items.filter(e=>e.year===y).reduce((s,e)=>s+e.quantity,0);
                                      return (
                                        <div key={y} className="w-12 h-7 flex items-center justify-center border-r border-white/3">
                                          {qty > 0 && <span className="text-[9px] font-bold text-sky-300 font-mono">{qty}</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Tonnage chart by phase */}
                      <div className="card-sm">
                        <div className="text-xs font-semibold mf-txt mb-3">Tonnage par phase (minerai vs stérile)</div>
                        <svg viewBox="0 0 640 200" className="w-full">
                          {designPits.map((pit, i) => {
                            const bw = 580 / designPits.length;
                            const x = 30 + i * bw + bw * 0.1;
                            const bwInner = bw * 0.8;
                            const maxMt = Math.max(...designPits.map(p => p.ore_mt + p.waste_mt), 1);
                            const wasteH = (pit.waste_mt / maxMt) * 150;
                            const oreH = (pit.ore_mt / maxMt) * 150;
                            return (
                              <g key={pit.id}>
                                <rect x={x} y={160 - wasteH - oreH} width={bwInner * 0.48} height={wasteH} fill={pit.color + '44'} stroke={pit.color} strokeWidth={0.5} rx={1} />
                                <rect x={x + bwInner * 0.52} y={160 - oreH} width={bwInner * 0.48} height={oreH} fill="#10B98155" stroke="#10B981" strokeWidth={0.5} rx={1} />
                                <text x={x + bwInner / 2} y={174} textAnchor="middle" fontSize={7} fill="#ffffffaa">{pit.name.substring(0, 8)}</text>
                              </g>
                            );
                          })}
                          <line x1={25} y1={10} x2={25} y2={165} stroke="#ffffff15" strokeWidth={1} />
                          <line x1={25} y1={165} x2={625} y2={165} stroke="#ffffff15" strokeWidth={1} />
                          <text x={450} y={195} fontSize={8} fill="#ffffff30">Stérile (gauche)  ·  Minerai (droite)</text>
                        </svg>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {designTab === '3d' && (
              <div className="space-y-4">
                {!pitViz || pitViz.surface.length === 0 ? (
                  <div className="card-sm text-center py-16">
                    <MapIcon size={26} className="text-mf-txt4 mx-auto mb-3" />
                    <div className="text-sm font-semibold mf-txt mb-1">Aucune fosse optimisée</div>
                    <div className="text-xs mf-txt4 max-w-md mx-auto">
                      Lancez l'optimisation dans <strong className="mf-txt3">1 · Optimisation fosse</strong> — la vue 3D
                      affiche alors la surface de la fosse ultime (fond de fosse par colonne), issue du modèle de blocs réel.
                    </div>
                  </div>
                ) : (
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-2">Fosse ultime — vue 3D</div>
                    <Pit3D viz={pitViz} />
                    <PitDiagnostic viz={pitViz} />
                  </div>
                )}
              </div>
            )}

            {/* ── Modal: Nouvelle phase pit ── */}
            {showPitForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPitForm(false)}>
                <div className="card w-[540px] space-y-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><MapIcon size={14} className="text-amber-400" /> Nouvelle phase pit</div>
                    <button onClick={() => setShowPitForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Nom *', key: 'name', type: 'text', placeholder: 'Phase 1 – Pit principal' },
                      { label: 'Type', key: 'pit_type', type: 'select', options: ['open_pit', 'underground'] },
                      { label: 'RL crête (m)', key: 'crest_rl', type: 'number', placeholder: '500' },
                      { label: 'RL fond (m)', key: 'floor_rl', type: 'number', placeholder: '350' },
                      { label: 'Hauteur banc (m)', key: 'bench_height_m', type: 'number', placeholder: '10' },
                      { label: 'Largeur berm (m)', key: 'berm_width_m', type: 'number', placeholder: '8' },
                      { label: 'Angle talus (°)', key: 'slope_angle_deg', type: 'number', placeholder: '45' },
                      { label: 'Minerai (Mt)', key: 'ore_mt', type: 'number', placeholder: '5.0' },
                      { label: 'Stérile (Mt)', key: 'waste_mt', type: 'number', placeholder: '20.0' },
                      { label: 'Teneur (g/t Au)', key: 'grade_g_t', type: 'number', placeholder: '2.5' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(pitForm[f.key as keyof typeof pitForm] as string) ?? ''} onChange={e => setPitForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o} value={o}>{o === 'open_pit' ? 'Ciel ouvert' : 'Souterrain'}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(pitForm[f.key as keyof typeof pitForm] as string | number) ?? ''}
                            onChange={e => setPitForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                    <div className="col-span-2 space-y-1">
                      <label className="mf-txt3 text-[10px] uppercase tracking-wider">Notes</label>
                      <textarea className="input-field w-full text-xs h-16 resize-none" placeholder="Observations géotechniques, contraintes, etc."
                        value={pitForm.notes ?? ''} onChange={e => setPitForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowPitForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addDesignPit} disabled={designSaving || !pitForm.name?.trim()} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Créer phase pit'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Modal: Nouveau banc ── */}
            {showBenchForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowBenchForm(false)}>
                <div className="card w-[500px] space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><Layers size={14} className="text-amber-400" /> Ajouter un banc</div>
                    <button onClick={() => setShowBenchForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {designPits.length > 0 && (
                      <div className="col-span-2 space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">Phase pit</label>
                        <select className="input-field w-full text-xs" value={benchForm.pit_id ?? selectedPitId ?? ''} onChange={e => setBenchForm(prev => ({ ...prev, pit_id: e.target.value || null }))}>
                          <option value="">— Tous les pits —</option>
                          {designPits.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                    {[
                      { label: 'RL Banc (mRL) *', key: 'bench_rl', type: 'number', placeholder: '450' },
                      { label: 'Minerai (Mt)',     key: 'ore_mt',    type: 'number', placeholder: '0.5' },
                      { label: 'Stérile (Mt)',     key: 'waste_mt',  type: 'number', placeholder: '2.0' },
                      { label: 'Teneur Au (g/t)',  key: 'grade_g_t', type: 'number', placeholder: '2.5' },
                      { label: 'Largeur (m)',      key: 'width_m',   type: 'number', placeholder: '200' },
                      { label: 'Longueur (m)',     key: 'length_m',  type: 'number', placeholder: '400' },
                      { label: 'Schéma tir',       key: 'blast_pattern', type: 'text', placeholder: '4x4' },
                      { label: 'Explosif',         key: 'explosive_type', type: 'select', options: EXPLOSIVE_TYPES },
                      { label: 'Facteur poudre',   key: 'powder_factor', type: 'number', placeholder: '0.35' },
                      { label: 'Type minerai',     key: 'ore_type',  type: 'text', placeholder: 'Oxyde / Sulfure' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(benchForm[f.key as keyof typeof benchForm] as string) ?? ''} onChange={e => setBenchForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(benchForm[f.key as keyof typeof benchForm] as string | number) ?? ''}
                            onChange={e => setBenchForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowBenchForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addDesignBench} disabled={designSaving || benchForm.bench_rl == null} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Ajouter banc'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Modal: Planifier équipement ── */}
            {showEquipForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowEquipForm(false)}>
                <div className="card w-[480px] space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><Truck size={14} className="text-amber-400" /> Planifier un équipement</div>
                    <button onClick={() => setShowEquipForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Nom équipement *', key: 'equipment_name', type: 'text', placeholder: 'CAT 793D (220t)' },
                      { label: 'Type',             key: 'equipment_type',  type: 'select', options: EQUIP_TYPES },
                      { label: 'Année *',          key: 'year',            type: 'number', placeholder: '1' },
                      { label: 'Quantité',         key: 'quantity',        type: 'number', placeholder: '3' },
                      { label: 'Heures/an',        key: 'hours_year',      type: 'number', placeholder: '6000' },
                      { label: 'Coût/h ($)',       key: 'cost_h',          type: 'number', placeholder: '250' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(equipForm[f.key as keyof typeof equipForm] as string) ?? ''} onChange={e => setEquipForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(equipForm[f.key as keyof typeof equipForm] as string | number) ?? ''}
                            onChange={e => setEquipForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                    <div className="col-span-2 space-y-1">
                      <label className="mf-txt3 text-[10px] uppercase tracking-wider">Notes</label>
                      <input type="text" className="input-field w-full text-xs" placeholder="Spécifications, fournisseur, etc."
                        value={equipForm.notes ?? ''} onChange={e => setEquipForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowEquipForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addEquipSchedule} disabled={designSaving || !equipForm.equipment_name?.trim() || !equipForm.year} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Planifier'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
}
