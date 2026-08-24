-- ─────────────────────────────────────────────────────────────────────────────
-- Retrait du module COS (« Système d'Exploitation Cognitif »).
--
-- Le code applicatif du module a été supprimé (page, composants, lib, types —
-- PR #29). Cette migration retire son schéma de base de données.
--
-- `if exists` → idempotent (une table déjà absente n'échoue pas).
-- `cascade`   → emporte les objets DÉPENDANTS des tables COS : index, policies
--               RLS, contraintes et clés étrangères INTERNES au module
--               (cos_blend_sources→cos_blend_plans, cos_reconciliation_lines→
--               cos_reconciliation_periods, cos_operator_actions→
--               cos_recommendations), et les triggers de provenance/audit posés
--               sur ces tables. Aucune table hors-COS ne référence ces tables
--               (les seules FK entrantes sont cos→cos), donc rien d'externe n'est
--               emporté. Les lignes historiques d'`audit_logs` (entity_type
--               textuel, sans FK) sont conservées.
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists public.cos_operator_actions       cascade;
drop table if exists public.cos_recommendations         cascade;
drop table if exists public.cos_alerts                  cascade;
drop table if exists public.cos_reconciliation_lines    cascade;
drop table if exists public.cos_reconciliation_periods  cascade;
drop table if exists public.cos_reconciliation_runs     cascade;
drop table if exists public.cos_blend_sources           cascade;
drop table if exists public.cos_blend_plans             cascade;
drop table if exists public.cos_streams                 cascade;
drop table if exists public.cos_stockpiles              cascade;
drop table if exists public.cos_ore_lots                cascade;
drop table if exists public.cos_ore_movements           cascade;
drop table if exists public.cos_reagent_consumption     cascade;
drop table if exists public.cos_tag_readings            cascade;
drop table if exists public.cos_equipment_events        cascade;
drop table if exists public.cos_equipment_status        cascade;
drop table if exists public.cos_work_orders             cascade;
drop table if exists public.cos_shifts                  cascade;
drop table if exists public.cos_ingestion_config        cascade;
