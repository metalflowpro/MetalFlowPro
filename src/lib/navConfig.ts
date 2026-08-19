import type { NavGroup } from '../types';

/**
 * Single source of truth for module navigation.
 * Consumed by the Sidebar (grouped rail) and the CommandPalette (Ctrl+K).
 * Icons are resolved from the string keys via each consumer's ICON_MAP,
 * so this file stays free of JSX/lucide imports and can be used anywhere.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Vue Exécutive',
    items: [
      { id: 'dashboard',   label: 'Tableau de bord',              icon: 'dashboard' },
      { id: 'stagegates',  label: 'Stage-Gates',                  icon: 'stagegates' },
    ],
  },
  {
    label: 'Données',
    items: [
      { id: 'drilling',     label: 'Forages',                      icon: 'drilling' },
      { id: 'lims',         label: 'LIMS / Échantillons',          icon: 'lims' },
      { id: 'resource',     label: 'Estimation Ressource',         icon: 'resource' },
      { id: 'blockmodel',   label: 'Block Model',                  icon: 'blockmodel' },
      { id: 'granulometry', label: 'Granulométrie / Étude P80',    icon: 'granulometry' },
      { id: 'analytics',    label: 'Analyse et Interprétation',    icon: 'analytics' },
    ],
  },
  {
    label: 'Design Procédé',
    items: [
      { id: 'criteria',    label: 'Critères de conception',        icon: 'criteria' },
      { id: 'metparams',   label: 'Paramètres métallurgiques',     icon: 'metparams' },
      { id: 'flowsheet',   label: 'Flowsheet Ingénierie',          icon: 'flowsheet' },
      { id: 'massbalance', label: 'Bilan massique & eau',          icon: 'massbalance' },
      { id: 'equipment',   label: 'Équipements',                   icon: 'equipment' },
    ],
  },
  {
    label: 'Optimisation',
    items: [
      { id: 'simulation',  label: 'Simulation Pro',                icon: 'simulation' },
      { id: 'geomet',      label: 'Géo-Métal. Intelligence',       icon: 'geomet' },
      { id: 'mineopt',     label: 'Mine & Optimisation',           icon: 'mineopt' },
      { id: 'cos',         label: 'Système Exploitation Cognitif', icon: 'cos' },
    ],
  },
  {
    label: 'Économie & Risques',
    items: [
      { id: 'economics',   label: 'Modèle Économique',             icon: 'economics' },
      { id: 'risks',       label: 'Registre des Risques',          icon: 'risks' },
    ],
  },
  {
    label: 'Conformité & Rapports',
    items: [
      { id: 'ni43101',     label: 'Rapport NI 43-101',             icon: 'ni43101' },
      { id: 'reports',     label: 'Rapports Interne/Ext.',         icon: 'reports' },
    ],
  },
];

/** Flat list of all navigable modules, in rail order — handy for search. */
export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap(g =>
  g.items.map(item => ({ ...item, group: g.label })),
);
