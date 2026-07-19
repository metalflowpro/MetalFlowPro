import { useState } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import { Plus, Wrench, Search, Zap, CheckCircle2, Package, Settings, Network, AlertCircle } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project, EquipmentItem } from '../types';
import type { CanvasNode } from './Flowsheet';

const CATEGORIES = ['Comminution', 'Classification', 'Gravimétrie', 'Flottation', 'Lixiviation', 'ADR', 'Traitement eau', 'Résidus', 'Utilités'];

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  proposed:  { label: 'Proposé',    color: 'badge-gray'  },
  ordered:   { label: 'Commandé',   color: 'badge-blue'  },
  installed: { label: 'Installé',   color: 'badge-gold'  },
  operating: { label: 'En service', color: 'badge-green' },
};

// ─── Auto-generation mapping ──────────────────────────────────────────────────

interface EquipDefaults {
  category: string;
  sub_category: string;
  capacity_fraction: number; // multiplier × project tph
  capacity_unit: string;
  power_ref_kw: number; // reference power at 200 t/h
  unit_qty: number; // default number of units (ignored in generation, used for display)
}

// Reference power at 200 t/h; capacity_fraction × tph = displayed capacity
const EQUIP_DEFAULTS: Record<string, EquipDefaults> = {
  // Alimentation
  FEED_ROM:        { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:0,    unit_qty:1 },
  FEED_COB:        { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:0,    unit_qty:1 },
  FEED_APRON:      { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:45,   unit_qty:1 },
  FEED_SURGE:      { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.5, capacity_unit:'t',   power_ref_kw:0,    unit_qty:1 },
  CONV_BELT:       { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.1, capacity_unit:'t/h', power_ref_kw:75,   unit_qty:1 },
  FEED_STACKER:    { category:'Comminution',    sub_category:'Alimentation',        capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:110,  unit_qty:1 },
  // Concassage
  CRUSH_GYRATORY:  { category:'Comminution',    sub_category:'Concassage primaire', capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:400,  unit_qty:1 },
  CRUSH_JAW:       { category:'Comminution',    sub_category:'Concassage primaire', capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:200,  unit_qty:1 },
  CRUSH_CONE_SEC:  { category:'Comminution',    sub_category:'Concassage secondaire',capacity_fraction:1.1,capacity_unit:'t/h', power_ref_kw:250,  unit_qty:2 },
  CRUSH_CONE_TER:  { category:'Comminution',    sub_category:'Concassage tertiaire',capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:220,  unit_qty:2 },
  CRUSH_HPGR:      { category:'Comminution',    sub_category:'HPGR',               capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:2500, unit_qty:1 },
  CRUSH_IMPACT:    { category:'Comminution',    sub_category:'Concassage VSI',      capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:180,  unit_qty:1 },
  CRUSH_PEBBLE:    { category:'Comminution',    sub_category:'Concassage galets',   capacity_fraction:0.4, capacity_unit:'t/h', power_ref_kw:185,  unit_qty:2 },
  CRUSH_ROLL:      { category:'Comminution',    sub_category:'Concassage rouleaux', capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:160,  unit_qty:1 },
  // Criblage
  SCREEN_VIB:      { category:'Classification', sub_category:'Crible vibrant',      capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:22,   unit_qty:2 },
  SCREEN_BANANA:   { category:'Classification', sub_category:'Crible banane',       capacity_fraction:1.2, capacity_unit:'t/h', power_ref_kw:30,   unit_qty:2 },
  SCREEN_TROMMEL:  { category:'Classification', sub_category:'Trommel',             capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:18,   unit_qty:1 },
  SCREEN_DSM:      { category:'Classification', sub_category:'Tamis DSM',           capacity_fraction:0.5, capacity_unit:'m³/h',power_ref_kw:0,    unit_qty:2 },
  SCREEN_INTER:    { category:'Lixiviation',    sub_category:'Tamis interstade CIP',capacity_fraction:0.8, capacity_unit:'t/h', power_ref_kw:7,    unit_qty:2 },
  // Broyage
  MILL_SAG:        { category:'Comminution',    sub_category:'Broyeur SAG',         capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:3700, unit_qty:1 },
  MILL_AG:         { category:'Comminution',    sub_category:'Broyeur AG',          capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:3200, unit_qty:1 },
  MILL_BALL:       { category:'Comminution',    sub_category:'Broyeur à billes',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:2800, unit_qty:2 },
  MILL_ROD:        { category:'Comminution',    sub_category:'Broyeur à barres',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:1500, unit_qty:1 },
  MILL_VERTIMILL:  { category:'Comminution',    sub_category:'Rebroyage Vertimill', capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:700,  unit_qty:2 },
  MILL_ISAMILL:    { category:'Comminution',    sub_category:'Rebroyage IsaMill',   capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:1120, unit_qty:2 },
  MILL_TOWER:      { category:'Comminution',    sub_category:'Tower Mill',          capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:560,  unit_qty:2 },
  MILL_STIRRED:    { category:'Comminution',    sub_category:'Broyeur agité SMD',   capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:750,  unit_qty:2 },
  // Classification
  CLASSIF_CYCL:    { category:'Classification', sub_category:'Hydrocyclones',       capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:0,    unit_qty:10 },
  CLASSIF_SPIRAL:  { category:'Classification', sub_category:'Classificateur spirale',capacity_fraction:0.8,capacity_unit:'t/h',power_ref_kw:7,    unit_qty:2 },
  CLASSIF_RAKE:    { category:'Classification', sub_category:'Classificateur râteau',capacity_fraction:0.8, capacity_unit:'t/h',power_ref_kw:11,   unit_qty:2 },
  // Gravimétrie
  GRAV_KNELSON:    { category:'Gravimétrie',    sub_category:'Knelson CVD',         capacity_fraction:0.8, capacity_unit:'t/h', power_ref_kw:30,   unit_qty:2 },
  GRAV_FALCON:     { category:'Gravimétrie',    sub_category:'Falcon SB',           capacity_fraction:0.8, capacity_unit:'t/h', power_ref_kw:22,   unit_qty:2 },
  GRAV_TABLE:      { category:'Gravimétrie',    sub_category:'Table Gemeni',        capacity_fraction:0.1, capacity_unit:'t/h', power_ref_kw:1,    unit_qty:1 },
  GRAV_JIG:        { category:'Gravimétrie',    sub_category:'Jig Kelsey',          capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:15,   unit_qty:2 },
  GRAV_SPIRAL:     { category:'Gravimétrie',    sub_category:'Spirale',             capacity_fraction:0.5, capacity_unit:'t/h', power_ref_kw:0,    unit_qty:4 },
  GRAV_ILR:        { category:'Gravimétrie',    sub_category:'Réacteur ILR',        capacity_fraction:0.05,capacity_unit:'t/h', power_ref_kw:75,   unit_qty:1 },
  GRAV_KACHA:      { category:'Gravimétrie',    sub_category:'Gold Kacha',          capacity_fraction:0.1, capacity_unit:'t/h', power_ref_kw:5,    unit_qty:1 },
  // Flottation
  FLOAT_MECH:      { category:'Flottation',     sub_category:'Cellule mécanique',   capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:55,   unit_qty:8 },
  FLOAT_COLUMN:    { category:'Flottation',     sub_category:'Colonne',             capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:37,   unit_qty:2 },
  FLOAT_FLASH:     { category:'Flottation',     sub_category:'Flash Flotation',     capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:30,   unit_qty:1 },
  FLOAT_JAMESON:   { category:'Flottation',     sub_category:'Jameson Cell',        capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:22,   unit_qty:2 },
  FLOAT_ROUGH:     { category:'Flottation',     sub_category:'Rougher',             capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:260,  unit_qty:6 },
  FLOAT_CLEAN:     { category:'Flottation',     sub_category:'Cleaner',             capacity_fraction:0.3, capacity_unit:'m³',  power_ref_kw:110,  unit_qty:4 },
  // Épaississeurs / Filtres
  THCK_CONV:       { category:'Lixiviation',    sub_category:'Épaississeur conventionnel',capacity_fraction:1.0,capacity_unit:'t/h',power_ref_kw:45, unit_qty:1 },
  THCK_HIRATE:     { category:'Lixiviation',    sub_category:'Épaississeur haute capacité',capacity_fraction:1.0,capacity_unit:'t/h',power_ref_kw:55, unit_qty:1 },
  THCK_PASTE:      { category:'Résidus',        sub_category:'Épaississeur pâte',   capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:75,   unit_qty:1 },
  FILT_BELT:       { category:'Résidus',        sub_category:'Filtre à bande',      capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:37,   unit_qty:2 },
  FILT_PRESS:      { category:'Résidus',        sub_category:'Filtre presse',       capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:55,   unit_qty:2 },
  FILT_DISC:       { category:'Résidus',        sub_category:'Filtre à disques',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:30,   unit_qty:2 },
  FILT_CENTRIFUGE: { category:'Résidus',        sub_category:'Centrifugeuse',       capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:45,   unit_qty:2 },
  // Lixiviation
  CIL_TANK:        { category:'Lixiviation',    sub_category:'Cuve CIL',           capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:55,   unit_qty:8 },
  CIP_TANK:        { category:'Lixiviation',    sub_category:'Cuve CIP',           capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:55,   unit_qty:8 },
  LEACH_TANK:      { category:'Lixiviation',    sub_category:'Lixiviation agitée', capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:45,   unit_qty:6 },
  LEACH_HEAP:      { category:'Lixiviation',    sub_category:'Heap Leach',         capacity_fraction:1.0, capacity_unit:'t/j', power_ref_kw:75,   unit_qty:1 },
  AGGLOM:          { category:'Lixiviation',    sub_category:'Agglomération',      capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:90,   unit_qty:1 },
  PLS_POND:        { category:'Lixiviation',    sub_category:'Bassin PLS',         capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:0,    unit_qty:1 },
  // Oxydation
  OX_AUTOCLAVE:    { category:'Lixiviation',    sub_category:'Autoclave POX',      capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:1500, unit_qty:2 },
  OX_ROASTER:      { category:'Lixiviation',    sub_category:'Four rôtissoire',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:800,  unit_qty:1 },
  OX_BIOX:         { category:'Lixiviation',    sub_category:'Réacteurs BIOX',     capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:220,  unit_qty:4 },
  OX_ALBION:       { category:'Lixiviation',    sub_category:'Procédé Albion',     capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:960,  unit_qty:2 },
  OX_NITROX:       { category:'Lixiviation',    sub_category:'Procédé NITROX',     capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:750,  unit_qty:2 },
  NEUT_TANK:       { category:'Lixiviation',    sub_category:'Neutralisation',     capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:37,   unit_qty:2 },
  PREG_ROBBING:    { category:'Lixiviation',    sub_category:'Lixiviation spéciale',capacity_fraction:1.0,capacity_unit:'t/h', power_ref_kw:55,   unit_qty:4 },
  // ADR
  ADR_COLUMN:      { category:'ADR',            sub_category:'Colonnes carbone',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:15,   unit_qty:6 },
  ADR_ELUTION_AARL:{ category:'ADR',            sub_category:'Élution AARL',       capacity_fraction:0.5, capacity_unit:'t C/j',power_ref_kw:45,  unit_qty:1 },
  ADR_ELUTION_ZADRA:{ category:'ADR',           sub_category:'Élution ZADRA',      capacity_fraction:0.5, capacity_unit:'t C/j',power_ref_kw:45,  unit_qty:1 },
  ADR_EW:          { category:'ADR',            sub_category:'Électrolyse EW',     capacity_fraction:0.2, capacity_unit:'kg Au/j',power_ref_kw:75, unit_qty:1 },
  ADR_FURNACE:     { category:'ADR',            sub_category:'Four à induction',   capacity_fraction:0.2, capacity_unit:'kg Au/j',power_ref_kw:110,unit_qty:1 },
  ADR_RETORT:      { category:'ADR',            sub_category:'Cornue (retort)',    capacity_fraction:0.2, capacity_unit:'kg Au/j',power_ref_kw:18, unit_qty:1 },
  ADR_KILN:        { category:'ADR',            sub_category:'Four régénération C',capacity_fraction:0.5, capacity_unit:'t C/j',power_ref_kw:75,  unit_qty:1 },
  ADR_DORE:        { category:'ADR',            sub_category:'Fonte lingot doré',  capacity_fraction:0.2, capacity_unit:'kg/coulée',power_ref_kw:55,unit_qty:1},
  MC_MERRILL:      { category:'ADR',            sub_category:'Merrill-Crowe',      capacity_fraction:1.0, capacity_unit:'m³/h', power_ref_kw:37,   unit_qty:1 },
  // Traitement eau / résidus
  TAILS_TSF:       { category:'Résidus',        sub_category:'Parc à résidus TSF', capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:75,   unit_qty:1 },
  TAILS_DRY:       { category:'Résidus',        sub_category:'Dry Stack',          capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:185,  unit_qty:1 },
  TAILS_PASTE:     { category:'Résidus',        sub_category:'Résidus en pâte',    capacity_fraction:1.0, capacity_unit:'t/h', power_ref_kw:110,  unit_qty:1 },
  WT_DETOX:        { category:'Traitement eau', sub_category:'Détoxification CN',  capacity_fraction:1.0, capacity_unit:'m³/h',power_ref_kw:55,   unit_qty:1 },
  WT_EFFLUENT:     { category:'Traitement eau', sub_category:'Traitement effluents',capacity_fraction:1.0,capacity_unit:'m³/h',power_ref_kw:37,   unit_qty:1 },
  WT_POND:         { category:'Traitement eau', sub_category:'Bassin eau',         capacity_fraction:1.0, capacity_unit:'m³',  power_ref_kw:0,    unit_qty:1 },
};

interface EquipmentProps { project: Project; items: EquipmentItem[]; onRefresh: () => void; }

export function Equipment({ project, items, onRefresh }: EquipmentProps) {
  const [search, setSearch]       = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg]       = useState<string | null>(null);
  const [genError, setGenError]   = useState<string | null>(null);
  const [form, setForm] = useState({
    tag: '', name: '', category: 'Comminution', sub_category: '',
    capacity: '', capacity_unit: 't/h', power_kw: '', status: 'proposed' as EquipmentItem['status'],
  });

  // Use DB items if available, otherwise empty (no mock data — force real generation)
  const displayItems = items;

  const filtered = displayItems.filter(e => {
    const matchS = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.tag.toLowerCase().includes(search.toLowerCase());
    const matchC = !filterCat || e.category === filterCat;
    return matchS && matchC;
  });

  const totalPower = displayItems.reduce((s, e) => s + (e.power_kw ?? 0), 0);
  const usedCats   = Array.from(new Set(displayItems.map(e => e.category)));
  const byCategory = CATEGORIES
    .filter(c => usedCats.includes(c))
    .map(c => ({ cat: c, count: displayItems.filter(e => e.category === c).length }));

  // ─── Generate from flowsheet ────────────────────────────────────────────────

  async function generateFromFlowsheet() {
    setGenerating(true);
    setGenMsg(null);
    setGenError(null);
    try {
      // Load latest flowsheet
      const { data: fsData } = await supabase
        .from('project_flowsheets')
        .select('nodes')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fsData || !fsData.nodes || (fsData.nodes as CanvasNode[]).length === 0) {
        setGenError('Aucun flowsheet trouvé. Construisez votre flowsheet d\'abord.');
        return;
      }

      const nodes = fsData.nodes as CanvasNode[];
      const tph   = project.target_tph ?? 200;

      // Build equipment rows from nodes
      const newItems = nodes
        .map((node, idx) => {
          const def = EQUIP_DEFAULTS[node.equipCode];
          if (!def) return null;
          const cap = def.capacity_fraction > 0 ? Math.round(def.capacity_fraction * tph * 10) / 10 : null;
          const pwr = def.power_ref_kw > 0 ? Math.round(def.power_ref_kw * (tph / 200) * 10) / 10 : null;
          return {
            project_id:    project.id,
            tag:           node.tag,
            name:          node.label,
            category:      def.category,
            sub_category:  def.sub_category,
            capacity:      cap,
            capacity_unit: def.capacity_unit,
            power_kw:      pwr,
            status:        'proposed' as const,
          };
        })
        .filter(Boolean) as Omit<EquipmentItem, 'id' | 'created_at'>[];

      if (newItems.length === 0) {
        setGenError('Aucun équipement reconnu dans le flowsheet.');
        return;
      }

      // Delete existing non-edited items, then insert
      await supabase.from('equipment_items').delete().eq('project_id', project.id);
      await supabase.from('equipment_items').insert(newItems);

      onRefresh();
      setGenMsg(`${newItems.length} équipements générés depuis le flowsheet.`);
    } catch (err) {
      setGenError('Erreur lors de la génération. Réessayez.');
    } finally {
      setGenerating(false);
    }
  }

  // ─── Add single item ─────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      await supabase.from('equipment_items').insert({
        project_id:    project.id,
        tag:           form.tag,
        name:          form.name,
        category:      form.category,
        sub_category:  form.sub_category || null,
        capacity:      form.capacity ? Number(form.capacity) : null,
        capacity_unit: form.capacity_unit || null,
        power_kw:      form.power_kw ? Number(form.power_kw) : null,
        status:        form.status,
      });
      setShowModal(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Liste des Équipements"
        subtitle={`${displayItems.length} équipements · ${totalPower.toLocaleString()} kW installés`}
        breadcrumb={['Design Procédé', 'Équipements']}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={generateFromFlowsheet}
              disabled={generating}
            >
              <Network size={14} /> {generating ? 'Génération…' : 'Générer depuis Flowsheet'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Ajouter équipement
            </button>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Generation feedback */}
        {genMsg && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-sm">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{genMsg}</span>
            <button className="ml-auto text-emerald-600 hover:text-emerald-400" onClick={() => setGenMsg(null)}>×</button>
          </div>
        )}
        {genError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
            <AlertCircle size={15} className="shrink-0" />
            <span>{genError}</span>
            <button className="ml-auto text-red-600 hover:text-red-400" onClick={() => setGenError(null)}>×</button>
          </div>
        )}

        {/* Empty state */}
        {displayItems.length === 0 && (
          <div className="card flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-14 h-14 rounded-xl bg-mf-panel flex items-center justify-center">
              <Wrench size={24} className="text-mf-txt3" />
            </div>
            <div>
              <div className="text-mf-txt font-semibold mb-1">Aucun équipement</div>
              <div className="text-sm text-mf-txt4 max-w-sm">
                Construisez votre flowsheet, puis cliquez sur{' '}
                <span className="text-amber-400 font-medium">Générer depuis Flowsheet</span>{' '}
                pour peupler automatiquement la liste.
              </div>
            </div>
            <button className="btn btn-primary btn-sm mt-2" onClick={generateFromFlowsheet} disabled={generating}>
              <Network size={14} /> {generating ? 'Génération…' : 'Générer depuis Flowsheet'}
            </button>
          </div>
        )}

        {displayItems.length > 0 && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total équipements',  val: displayItems.length,                                          icon: Package,     color: 'text-mf-txt'     },
                { label: 'Puissance installée',val: `${formatDecimalGrouped((totalPower/1000), 1)} MW`,                          icon: Zap,         color: 'text-amber-400'  },
                { label: 'Commandés',          val: displayItems.filter(e => e.status === 'ordered').length,       icon: CheckCircle2,color: 'text-blue-400'   },
                { label: 'En service',         val: displayItems.filter(e => e.status === 'operating').length,     icon: Settings,    color: 'text-emerald-400'},
              ].map(s => (
                <div key={s.label} className="card-sm flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-mf-panel flex items-center justify-center">
                    <s.icon size={16} className={s.color} />
                  </div>
                  <div>
                    <div className={`text-xl font-bold font-mono ${s.color}`}>{s.val}</div>
                    <div className="text-xs text-mf-txt4">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterCat('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${!filterCat ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'border-mf-border text-mf-txt3 hover:bg-mf-hover'}`}
              >Tous</button>
              {byCategory.map(c => (
                <button
                  key={c.cat}
                  onClick={() => setFilterCat(c.cat === filterCat ? '' : c.cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterCat === c.cat ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'border-mf-border text-mf-txt3 hover:bg-mf-hover'}`}
                >
                  {c.cat} <span className="opacity-60 ml-1">({c.count})</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-txt4" />
              <input className="input-field pl-9" placeholder="Rechercher par tag ou désignation…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Table */}
            <div className="card overflow-hidden p-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Désignation</th>
                    <th>Catégorie</th>
                    <th>Sous-catég.</th>
                    <th className="text-right">Capacité</th>
                    <th className="text-right">Puissance</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => {
                    const cfg = STATUS_CFG[e.status] ?? STATUS_CFG.proposed;
                    return (
                      <tr key={e.id}>
                        <td><span className="font-mono text-xs text-amber-400 font-bold">{e.tag}</span></td>
                        <td className="text-mf-txt">{e.name}</td>
                        <td><span className="badge badge-purple text-[10px]">{e.category}</span></td>
                        <td className="text-mf-txt3 text-xs">{e.sub_category ?? '—'}</td>
                        <td className="num">{e.capacity ? `${e.capacity} ${e.capacity_unit}` : '—'}</td>
                        <td className="num">{e.power_kw ? `${e.power_kw} kW` : '—'}</td>
                        <td><span className={`badge ${cfg.color}`}>{cfg.label}</span></td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-mf-txt4">Aucun équipement correspondant</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showModal && (
        <Modal
          title="Ajouter un équipement"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.tag || !form.name}>
                {saving ? 'Enregistrement…' : 'Ajouter'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Tag *</label>
                <input className="input-field" placeholder="ex. MI-003" value={form.tag} onChange={e => setForm(f => ({ ...f, tag: e.target.value }))} />
              </div>
              <div>
                <label className="label">Catégorie</label>
                <select className="input-field" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Désignation *</label>
              <input className="input-field" placeholder="ex. Broyeur à billes Ø5.5×8.5m" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Sous-catégorie</label>
              <input className="input-field" placeholder="ex. Broyeur SAG" value={form.sub_category} onChange={e => setForm(f => ({ ...f, sub_category: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Capacité</label>
                <input className="input-field" type="number" placeholder="ex. 200" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div>
                <label className="label">Unité</label>
                <input className="input-field" placeholder="t/h, m³, etc." value={form.capacity_unit} onChange={e => setForm(f => ({ ...f, capacity_unit: e.target.value }))} />
              </div>
              <div>
                <label className="label">Puissance kW</label>
                <input className="input-field" type="number" placeholder="ex. 2800" value={form.power_kw} onChange={e => setForm(f => ({ ...f, power_kw: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Statut</label>
              <select className="input-field" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as EquipmentItem['status'] }))}>
                <option value="proposed">Proposé</option>
                <option value="ordered">Commandé</option>
                <option value="installed">Installé</option>
                <option value="operating">En service</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
