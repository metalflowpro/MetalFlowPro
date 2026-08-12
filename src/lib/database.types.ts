// ─────────────────────────────────────────────────────────────────────────────
// Types de la base Supabase — GÉNÉRÉS. Ne pas éditer à la main.
// Régénérer : npx supabase gen types typescript --project-id qbcvrwyapvzugekbhrfy > src/lib/database.types.ts
// ─────────────────────────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string | null
          id: string
          is_admin: boolean
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          id: string
          is_admin?: boolean
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_admin?: boolean
          status?: string
        }
        Relationships: []
      }
      bm_blocks: {
        Row: {
          attributes: Json | null
          au_g_t: number
          config_id: string
          created_at: string | null
          cx: number
          cy: number
          cz: number
          density: number
          i: number
          id: string
          j: number
          k: number
          project_id: string
          resource_category: string | null
          rock_type: string | null
          volume_m3: number
        }
        Insert: {
          attributes?: Json | null
          au_g_t?: number
          config_id: string
          created_at?: string | null
          cx: number
          cy: number
          cz: number
          density?: number
          i: number
          id?: string
          j: number
          k: number
          project_id: string
          resource_category?: string | null
          rock_type?: string | null
          volume_m3?: number
        }
        Update: {
          attributes?: Json | null
          au_g_t?: number
          config_id?: string
          created_at?: string | null
          cx?: number
          cy?: number
          cz?: number
          density?: number
          i?: number
          id?: string
          j?: number
          k?: number
          project_id?: string
          resource_category?: string | null
          rock_type?: string | null
          volume_m3?: number
        }
        Relationships: [
          {
            foreignKeyName: "bm_blocks_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "bm_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_blocks_config_project_fkey"
            columns: ["config_id", "project_id"]
            isOneToOne: false
            referencedRelation: "bm_configs"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      bm_configs: {
        Row: {
          block_x: number
          block_y: number
          block_z: number
          created_at: string | null
          id: string
          name: string
          origin_x: number
          origin_y: number
          origin_z: number
          project_id: string
          rotation_deg: number
        }
        Insert: {
          block_x?: number
          block_y?: number
          block_z?: number
          created_at?: string | null
          id?: string
          name: string
          origin_x?: number
          origin_y?: number
          origin_z?: number
          project_id: string
          rotation_deg?: number
        }
        Update: {
          block_x?: number
          block_y?: number
          block_z?: number
          created_at?: string | null
          id?: string
          name?: string
          origin_x?: number
          origin_y?: number
          origin_z?: number
          project_id?: string
          rotation_deg?: number
        }
        Relationships: [
          {
            foreignKeyName: "bm_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      capex_lines: {
        Row: {
          category: string
          contingency_pct: number | null
          created_at: string | null
          description: string
          id: string
          notes: string | null
          project_id: string
          sort_order: number | null
          source: string | null
          sub_category: string | null
          value_musd: number
        }
        Insert: {
          category: string
          contingency_pct?: number | null
          created_at?: string | null
          description: string
          id?: string
          notes?: string | null
          project_id: string
          sort_order?: number | null
          source?: string | null
          sub_category?: string | null
          value_musd?: number
        }
        Update: {
          category?: string
          contingency_pct?: number | null
          created_at?: string | null
          description?: string
          id?: string
          notes?: string | null
          project_id?: string
          sort_order?: number | null
          source?: string | null
          sub_category?: string | null
          value_musd?: number
        }
        Relationships: [
          {
            foreignKeyName: "capex_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      carbon_footprint_items: {
        Row: {
          activity_unit: string | null
          activity_value: number | null
          created_at: string | null
          description: string | null
          ef_unit: string | null
          emission_factor: number | null
          id: string
          is_edited: boolean | null
          project_id: string
          scope: number
          sort_order: number | null
          source: string
          tco2e_year: number | null
          updated_at: string | null
        }
        Insert: {
          activity_unit?: string | null
          activity_value?: number | null
          created_at?: string | null
          description?: string | null
          ef_unit?: string | null
          emission_factor?: number | null
          id?: string
          is_edited?: boolean | null
          project_id: string
          scope: number
          sort_order?: number | null
          source: string
          tco2e_year?: number | null
          updated_at?: string | null
        }
        Update: {
          activity_unit?: string | null
          activity_value?: number | null
          created_at?: string | null
          description?: string | null
          ef_unit?: string | null
          emission_factor?: number | null
          id?: string
          is_edited?: boolean | null
          project_id?: string
          scope?: number
          sort_order?: number | null
          source?: string
          tco2e_year?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carbon_footprint_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      circuit_recommendations: {
        Row: {
          ai_score: number | null
          basis: string | null
          circuit_code: string
          circuit_label: string
          co2_t_oz: number | null
          confidence: string | null
          created_at: string | null
          data_snapshot: Json | null
          id: string
          is_recommended: boolean
          opex_usd_t: number | null
          project_id: string
          recovery_pct: number | null
        }
        Insert: {
          ai_score?: number | null
          basis?: string | null
          circuit_code: string
          circuit_label: string
          co2_t_oz?: number | null
          confidence?: string | null
          created_at?: string | null
          data_snapshot?: Json | null
          id?: string
          is_recommended?: boolean
          opex_usd_t?: number | null
          project_id: string
          recovery_pct?: number | null
        }
        Update: {
          ai_score?: number | null
          basis?: string | null
          circuit_code?: string
          circuit_label?: string
          co2_t_oz?: number | null
          confidence?: string | null
          created_at?: string | null
          data_snapshot?: Json | null
          id?: string
          is_recommended?: boolean
          opex_usd_t?: number | null
          project_id?: string
          recovery_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "circuit_recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          cause: string | null
          created_at: string | null
          description: string | null
          domain: string | null
          entity: string
          entity_name: string | null
          escalated_to: string | null
          evidence: Json | null
          id: string
          project_id: string
          resolved_at: string | null
          severity: string
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          cause?: string | null
          created_at?: string | null
          description?: string | null
          domain?: string | null
          entity: string
          entity_name?: string | null
          escalated_to?: string | null
          evidence?: Json | null
          id?: string
          project_id: string
          resolved_at?: string | null
          severity?: string
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          cause?: string | null
          created_at?: string | null
          description?: string | null
          domain?: string | null
          entity?: string
          entity_name?: string | null
          escalated_to?: string | null
          evidence?: Json | null
          id?: string
          project_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cos_alerts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_blend_plans: {
        Row: {
          created_at: string | null
          id: string
          predicted_au_g_t: number | null
          predicted_cao_kg_t: number | null
          predicted_nacn_kg_t: number | null
          predicted_recovery_pct: number | null
          predicted_throughput_tph: number | null
          project_id: string
          shift_label: string
          status: string
          target_au_g_t: number
          target_tph: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          predicted_au_g_t?: number | null
          predicted_cao_kg_t?: number | null
          predicted_nacn_kg_t?: number | null
          predicted_recovery_pct?: number | null
          predicted_throughput_tph?: number | null
          project_id: string
          shift_label: string
          status?: string
          target_au_g_t: number
          target_tph: number
        }
        Update: {
          created_at?: string | null
          id?: string
          predicted_au_g_t?: number | null
          predicted_cao_kg_t?: number | null
          predicted_nacn_kg_t?: number | null
          predicted_recovery_pct?: number | null
          predicted_throughput_tph?: number | null
          project_id?: string
          shift_label?: string
          status?: string
          target_au_g_t?: number
          target_tph?: number
        }
        Relationships: [
          {
            foreignKeyName: "cos_blend_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_blend_sources: {
        Row: {
          au_g_t: number
          blend_plan_id: string
          bwi: number | null
          created_at: string | null
          id: string
          lot_id: string
          ore_lot_id: string | null
          project_id: string
          proportion_pct: number
          source_name: string
          tph: number
        }
        Insert: {
          au_g_t: number
          blend_plan_id: string
          bwi?: number | null
          created_at?: string | null
          id?: string
          lot_id: string
          ore_lot_id?: string | null
          project_id: string
          proportion_pct: number
          source_name: string
          tph: number
        }
        Update: {
          au_g_t?: number
          blend_plan_id?: string
          bwi?: number | null
          created_at?: string | null
          id?: string
          lot_id?: string
          ore_lot_id?: string | null
          project_id?: string
          proportion_pct?: number
          source_name?: string
          tph?: number
        }
        Relationships: [
          {
            foreignKeyName: "cos_blend_sources_blend_plan_id_fkey"
            columns: ["blend_plan_id"]
            isOneToOne: false
            referencedRelation: "cos_blend_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cos_blend_sources_ore_lot_id_fkey"
            columns: ["ore_lot_id"]
            isOneToOne: false
            referencedRelation: "cos_ore_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cos_blend_sources_plan_project_fkey"
            columns: ["blend_plan_id", "project_id"]
            isOneToOne: false
            referencedRelation: "cos_blend_plans"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "cos_blend_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_equipment_events: {
        Row: {
          asset_path: string
          created_at: string | null
          description: string | null
          duration_min: number | null
          ended_at: string | null
          equipment_tag: string | null
          event_id: string
          event_type: string
          id: string
          operator: string | null
          project_id: string
          reason_code: string | null
          severity: string
          source: string
          started_at: string
          work_order_id: string | null
        }
        Insert: {
          asset_path?: string
          created_at?: string | null
          description?: string | null
          duration_min?: number | null
          ended_at?: string | null
          equipment_tag?: string | null
          event_id: string
          event_type?: string
          id?: string
          operator?: string | null
          project_id: string
          reason_code?: string | null
          severity?: string
          source?: string
          started_at: string
          work_order_id?: string | null
        }
        Update: {
          asset_path?: string
          created_at?: string | null
          description?: string | null
          duration_min?: number | null
          ended_at?: string | null
          equipment_tag?: string | null
          event_id?: string
          event_type?: string
          id?: string
          operator?: string | null
          project_id?: string
          reason_code?: string | null
          severity?: string
          source?: string
          started_at?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_equipment_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_equipment_status: {
        Row: {
          availability_pct: number | null
          created_at: string | null
          downtime_reason: string | null
          equipment_name: string
          equipment_tag: string
          failure_prob_168h: number | null
          failure_prob_24h: number | null
          failure_prob_72h: number | null
          health_components: Json | null
          health_index: number | null
          id: string
          is_bottleneck: boolean | null
          last_updated: string | null
          load_pct: number | null
          mtbf_h: number | null
          mttr_h: number | null
          oee_pct: number | null
          project_id: string
          rul_h: number | null
          section: string
          state: string
          utilization_pct: number | null
        }
        Insert: {
          availability_pct?: number | null
          created_at?: string | null
          downtime_reason?: string | null
          equipment_name: string
          equipment_tag: string
          failure_prob_168h?: number | null
          failure_prob_24h?: number | null
          failure_prob_72h?: number | null
          health_components?: Json | null
          health_index?: number | null
          id?: string
          is_bottleneck?: boolean | null
          last_updated?: string | null
          load_pct?: number | null
          mtbf_h?: number | null
          mttr_h?: number | null
          oee_pct?: number | null
          project_id: string
          rul_h?: number | null
          section?: string
          state?: string
          utilization_pct?: number | null
        }
        Update: {
          availability_pct?: number | null
          created_at?: string | null
          downtime_reason?: string | null
          equipment_name?: string
          equipment_tag?: string
          failure_prob_168h?: number | null
          failure_prob_24h?: number | null
          failure_prob_72h?: number | null
          health_components?: Json | null
          health_index?: number | null
          id?: string
          is_bottleneck?: boolean | null
          last_updated?: string | null
          load_pct?: number | null
          mtbf_h?: number | null
          mttr_h?: number | null
          oee_pct?: number | null
          project_id?: string
          rul_h?: number | null
          section?: string
          state?: string
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_equipment_status_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_ingestion_config: {
        Row: {
          cmms_source: string
          created_at: string | null
          geomet_source: string
          id: string
          lab_id: string
          lims_source: string
          mine_name: string
          opc_source_grinding: string
          opc_source_leaching: string
          opc_source_utilities: string
          project_id: string
          shift_duration_h: number
          shift_start_utc_h: number
          site_code: string
          tz: string
          updated_at: string | null
        }
        Insert: {
          cmms_source?: string
          created_at?: string | null
          geomet_source?: string
          id?: string
          lab_id?: string
          lims_source?: string
          mine_name?: string
          opc_source_grinding?: string
          opc_source_leaching?: string
          opc_source_utilities?: string
          project_id: string
          shift_duration_h?: number
          shift_start_utc_h?: number
          site_code?: string
          tz?: string
          updated_at?: string | null
        }
        Update: {
          cmms_source?: string
          created_at?: string | null
          geomet_source?: string
          id?: string
          lab_id?: string
          lims_source?: string
          mine_name?: string
          opc_source_grinding?: string
          opc_source_leaching?: string
          opc_source_utilities?: string
          project_id?: string
          shift_duration_h?: number
          shift_start_utc_h?: number
          site_code?: string
          tz?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_ingestion_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_operator_actions: {
        Row: {
          created_at: string | null
          id: string
          operator_name: string
          project_id: string
          recommendation_id: string | null
          result: string | null
          setpoints_applied: Json | null
          verified: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          operator_name: string
          project_id: string
          recommendation_id?: string | null
          result?: string | null
          setpoints_applied?: Json | null
          verified?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          operator_name?: string
          project_id?: string
          recommendation_id?: string | null
          result?: string | null
          setpoints_applied?: Json | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_operator_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cos_operator_actions_reco_project_fkey"
            columns: ["recommendation_id", "project_id"]
            isOneToOne: false
            referencedRelation: "cos_recommendations"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "cos_operator_actions_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "cos_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_ore_lots: {
        Row: {
          arsenic_ppm: number | null
          au_g_t: number
          bwi: number | null
          clay_pct: number | null
          created_at: string | null
          id: string
          is_available: boolean | null
          lot_id: string
          organic_carbon_pct: number | null
          project_id: string
          source_name: string
          spi: number | null
          stockpile_id: string | null
          sulfides_pct: number | null
          tonnage_t: number
        }
        Insert: {
          arsenic_ppm?: number | null
          au_g_t?: number
          bwi?: number | null
          clay_pct?: number | null
          created_at?: string | null
          id?: string
          is_available?: boolean | null
          lot_id: string
          organic_carbon_pct?: number | null
          project_id: string
          source_name: string
          spi?: number | null
          stockpile_id?: string | null
          sulfides_pct?: number | null
          tonnage_t?: number
        }
        Update: {
          arsenic_ppm?: number | null
          au_g_t?: number
          bwi?: number | null
          clay_pct?: number | null
          created_at?: string | null
          id?: string
          is_available?: boolean | null
          lot_id?: string
          organic_carbon_pct?: number | null
          project_id?: string
          source_name?: string
          spi?: number | null
          stockpile_id?: string | null
          sulfides_pct?: number | null
          tonnage_t?: number
        }
        Relationships: [
          {
            foreignKeyName: "cos_ore_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_ore_movements: {
        Row: {
          created_at: string | null
          from_location: string
          id: string
          lot_id: string | null
          moisture_pct: number | null
          movement_id: string
          operator: string | null
          project_id: string
          quality: string
          to_location: string
          tonnage_dry_t: number | null
          tonnage_wet_t: number | null
          truck_id: string | null
          ts: string
        }
        Insert: {
          created_at?: string | null
          from_location?: string
          id?: string
          lot_id?: string | null
          moisture_pct?: number | null
          movement_id: string
          operator?: string | null
          project_id: string
          quality?: string
          to_location?: string
          tonnage_dry_t?: number | null
          tonnage_wet_t?: number | null
          truck_id?: string | null
          ts: string
        }
        Update: {
          created_at?: string | null
          from_location?: string
          id?: string
          lot_id?: string | null
          moisture_pct?: number | null
          movement_id?: string
          operator?: string | null
          project_id?: string
          quality?: string
          to_location?: string
          tonnage_dry_t?: number | null
          tonnage_wet_t?: number | null
          truck_id?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "cos_ore_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_reagent_consumption: {
        Row: {
          asset_path: string
          consumed_qty: number | null
          consumed_unit: string
          created_at: string | null
          dose_kg_t: number | null
          id: string
          kind: string
          name: string
          period_from: string | null
          period_to: string | null
          project_id: string
          quality: string
          source: string
          stock_t: number | null
        }
        Insert: {
          asset_path?: string
          consumed_qty?: number | null
          consumed_unit?: string
          created_at?: string | null
          dose_kg_t?: number | null
          id?: string
          kind?: string
          name: string
          period_from?: string | null
          period_to?: string | null
          project_id: string
          quality?: string
          source?: string
          stock_t?: number | null
        }
        Update: {
          asset_path?: string
          consumed_qty?: number | null
          consumed_unit?: string
          created_at?: string | null
          dose_kg_t?: number | null
          id?: string
          kind?: string
          name?: string
          period_from?: string | null
          period_to?: string | null
          project_id?: string
          quality?: string
          source?: string
          stock_t?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_reagent_consumption_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_recommendations: {
        Row: {
          actions: Json | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          confidence: number | null
          created_at: string | null
          description: string | null
          domain: string
          evidence: Json | null
          expected_delta: Json | null
          id: string
          objective: string
          priority: number | null
          project_id: string
          result_notes: string | null
          status: string
          verified_at: string | null
        }
        Insert: {
          actions?: Json | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          domain: string
          evidence?: Json | null
          expected_delta?: Json | null
          id?: string
          objective: string
          priority?: number | null
          project_id: string
          result_notes?: string | null
          status?: string
          verified_at?: string | null
        }
        Update: {
          actions?: Json | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          domain?: string
          evidence?: Json | null
          expected_delta?: Json | null
          id?: string
          objective?: string
          priority?: number | null
          project_id?: string
          result_notes?: string | null
          status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_reconciliation_lines: {
        Row: {
          au_g_t: number | null
          created_at: string | null
          id: string
          is_provisional: boolean | null
          mass_t: number | null
          metal_g: number | null
          project_id: string
          reconciliation_id: string
          stream_id: string
          stream_name: string
          uncertainty_pct: number | null
        }
        Insert: {
          au_g_t?: number | null
          created_at?: string | null
          id?: string
          is_provisional?: boolean | null
          mass_t?: number | null
          metal_g?: number | null
          project_id: string
          reconciliation_id: string
          stream_id: string
          stream_name: string
          uncertainty_pct?: number | null
        }
        Update: {
          au_g_t?: number | null
          created_at?: string | null
          id?: string
          is_provisional?: boolean | null
          mass_t?: number | null
          metal_g?: number | null
          project_id?: string
          reconciliation_id?: string
          stream_id?: string
          stream_name?: string
          uncertainty_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_reconciliation_lines_period_project_fkey"
            columns: ["reconciliation_id", "project_id"]
            isOneToOne: false
            referencedRelation: "cos_reconciliation_periods"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "cos_reconciliation_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cos_reconciliation_lines_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "cos_reconciliation_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_reconciliation_periods: {
        Row: {
          bias_flag: boolean | null
          created_at: string | null
          delta_stock_g: number | null
          end_time: string
          feed_au_g_t: number | null
          feed_mass_t: number | null
          feed_metal_g: number | null
          has_provisional_data: boolean | null
          id: string
          period_label: string
          period_type: string
          product_au_g_t: number | null
          product_mass_t: number | null
          product_metal_g: number | null
          project_id: string
          recovery_pct: number | null
          start_time: string
          status: string | null
          tail_au_g_t: number | null
          tail_mass_t: number | null
          tail_metal_g: number | null
          unaccounted_metal_pct: number | null
          variance_pct: number | null
        }
        Insert: {
          bias_flag?: boolean | null
          created_at?: string | null
          delta_stock_g?: number | null
          end_time: string
          feed_au_g_t?: number | null
          feed_mass_t?: number | null
          feed_metal_g?: number | null
          has_provisional_data?: boolean | null
          id?: string
          period_label: string
          period_type: string
          product_au_g_t?: number | null
          product_mass_t?: number | null
          product_metal_g?: number | null
          project_id: string
          recovery_pct?: number | null
          start_time: string
          status?: string | null
          tail_au_g_t?: number | null
          tail_mass_t?: number | null
          tail_metal_g?: number | null
          unaccounted_metal_pct?: number | null
          variance_pct?: number | null
        }
        Update: {
          bias_flag?: boolean | null
          created_at?: string | null
          delta_stock_g?: number | null
          end_time?: string
          feed_au_g_t?: number | null
          feed_mass_t?: number | null
          feed_metal_g?: number | null
          has_provisional_data?: boolean | null
          id?: string
          period_label?: string
          period_type?: string
          product_au_g_t?: number | null
          product_mass_t?: number | null
          product_metal_g?: number | null
          project_id?: string
          recovery_pct?: number | null
          start_time?: string
          status?: string | null
          tail_au_g_t?: number | null
          tail_mass_t?: number | null
          tail_metal_g?: number | null
          unaccounted_metal_pct?: number | null
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_reconciliation_periods_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_shifts: {
        Row: {
          campaign_id: string | null
          campaign_strategy: string | null
          created_at: string | null
          crew: Json
          end_time: string | null
          id: string
          notes: string | null
          project_id: string
          shift_id: string
          shift_type: string
          start_time: string
          supervisor: string | null
          target_au_oz: number | null
          target_recovery_pct: number | null
          target_throughput_t_h: number | null
          tz: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_strategy?: string | null
          created_at?: string | null
          crew?: Json
          end_time?: string | null
          id?: string
          notes?: string | null
          project_id: string
          shift_id: string
          shift_type?: string
          start_time: string
          supervisor?: string | null
          target_au_oz?: number | null
          target_recovery_pct?: number | null
          target_throughput_t_h?: number | null
          tz?: string
        }
        Update: {
          campaign_id?: string | null
          campaign_strategy?: string | null
          created_at?: string | null
          crew?: Json
          end_time?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          shift_id?: string
          shift_type?: string
          start_time?: string
          supervisor?: string | null
          target_au_oz?: number | null
          target_recovery_pct?: number | null
          target_throughput_t_h?: number | null
          tz?: string
        }
        Relationships: [
          {
            foreignKeyName: "cos_shifts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_stockpiles: {
        Row: {
          blended_au_g_t: number | null
          blended_bwi: number | null
          blended_prc_pct: number | null
          blended_sulfides_pct: number | null
          created_at: string | null
          current_tonnage_t: number | null
          id: string
          name: string
          project_id: string
          reclaim_rate_tph: number | null
          updated_at: string | null
        }
        Insert: {
          blended_au_g_t?: number | null
          blended_bwi?: number | null
          blended_prc_pct?: number | null
          blended_sulfides_pct?: number | null
          created_at?: string | null
          current_tonnage_t?: number | null
          id?: string
          name: string
          project_id: string
          reclaim_rate_tph?: number | null
          updated_at?: string | null
        }
        Update: {
          blended_au_g_t?: number | null
          blended_bwi?: number | null
          blended_prc_pct?: number | null
          blended_sulfides_pct?: number | null
          created_at?: string | null
          current_tonnage_t?: number | null
          id?: string
          name?: string
          project_id?: string
          reclaim_rate_tph?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_stockpiles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_streams: {
        Row: {
          au_g_t: number | null
          confidence_score: number | null
          created_at: string | null
          data_quality: string | null
          density_t_m3: number | null
          id: string
          is_provisional: boolean | null
          last_updated: string | null
          mass_tph: number | null
          moisture_pct: number | null
          name: string
          project_id: string
          section: string
          solids_pct: number | null
          stream_id: string
          stream_type: string
        }
        Insert: {
          au_g_t?: number | null
          confidence_score?: number | null
          created_at?: string | null
          data_quality?: string | null
          density_t_m3?: number | null
          id?: string
          is_provisional?: boolean | null
          last_updated?: string | null
          mass_tph?: number | null
          moisture_pct?: number | null
          name: string
          project_id: string
          section?: string
          solids_pct?: number | null
          stream_id: string
          stream_type?: string
        }
        Update: {
          au_g_t?: number | null
          confidence_score?: number | null
          created_at?: string | null
          data_quality?: string | null
          density_t_m3?: number | null
          id?: string
          is_provisional?: boolean | null
          last_updated?: string | null
          mass_tph?: number | null
          moisture_pct?: number | null
          name?: string
          project_id?: string
          section?: string
          solids_pct?: number | null
          stream_id?: string
          stream_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cos_streams_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_tag_readings: {
        Row: {
          asset_path: string
          confidence: number | null
          created_at: string | null
          id: string
          lineage: string | null
          note: string | null
          project_id: string
          quality: string
          source: string
          tag: string
          ts: string
          unit: string
          value: number | null
        }
        Insert: {
          asset_path?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          lineage?: string | null
          note?: string | null
          project_id: string
          quality?: string
          source?: string
          tag: string
          ts: string
          unit?: string
          value?: number | null
        }
        Update: {
          asset_path?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          lineage?: string | null
          note?: string | null
          project_id?: string
          quality?: string
          source?: string
          tag?: string
          ts?: string
          unit?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cos_tag_readings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cos_work_orders: {
        Row: {
          asset_path: string
          assignee: string | null
          created_at: string | null
          created_at_src: string | null
          description: string | null
          id: string
          priority: number | null
          project_id: string
          scheduled_at: string | null
          source: string
          status: string
          wo_id: string
          wo_type: string
        }
        Insert: {
          asset_path?: string
          assignee?: string | null
          created_at?: string | null
          created_at_src?: string | null
          description?: string | null
          id?: string
          priority?: number | null
          project_id: string
          scheduled_at?: string | null
          source?: string
          status?: string
          wo_id: string
          wo_type?: string
        }
        Update: {
          asset_path?: string
          assignee?: string | null
          created_at?: string | null
          created_at_src?: string | null
          description?: string | null
          id?: string
          priority?: number | null
          project_id?: string
          scheduled_at?: string | null
          source?: string
          status?: string
          wo_id?: string
          wo_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cos_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dc_draft: {
        Row: {
          circuit_flags: Json | null
          content: Json
          id: string
          pipeline_step: string | null
          project_id: string
          updated_at: string | null
        }
        Insert: {
          circuit_flags?: Json | null
          content?: Json
          id?: string
          pipeline_step?: string | null
          project_id: string
          updated_at?: string | null
        }
        Update: {
          circuit_flags?: Json | null
          content?: Json
          id?: string
          pipeline_step?: string | null
          project_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dc_draft_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dc_snapshots: {
        Row: {
          content: Json
          content_hash: string
          created_at: string | null
          frozen_by: string | null
          id: string
          label: string
          project_id: string
        }
        Insert: {
          content: Json
          content_hash: string
          created_at?: string | null
          frozen_by?: string | null
          id?: string
          label: string
          project_id: string
        }
        Update: {
          content?: Json
          content_hash?: string
          created_at?: string | null
          frozen_by?: string | null
          id?: string
          label?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dc_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dh_assay: {
        Row: {
          created_at: string | null
          element: string
          from_m: number
          hole_id: string
          id: string
          lab_job: string | null
          project_id: string
          qaqc_type: string
          to_m: number
          unit: string
          value: number | null
        }
        Insert: {
          created_at?: string | null
          element: string
          from_m: number
          hole_id: string
          id?: string
          lab_job?: string | null
          project_id: string
          qaqc_type?: string
          to_m: number
          unit?: string
          value?: number | null
        }
        Update: {
          created_at?: string | null
          element?: string
          from_m?: number
          hole_id?: string
          id?: string
          lab_job?: string | null
          project_id?: string
          qaqc_type?: string
          to_m?: number
          unit?: string
          value?: number | null
        }
        Relationships: []
      }
      dh_collar: {
        Row: {
          created_at: string | null
          diameter: string | null
          drilled_on: string | null
          hole_id: string
          hole_type: string
          id: string
          max_depth: number | null
          notes: string | null
          project_id: string
          updated_at: string | null
          x: number
          y: number
          z: number
        }
        Insert: {
          created_at?: string | null
          diameter?: string | null
          drilled_on?: string | null
          hole_id: string
          hole_type?: string
          id?: string
          max_depth?: number | null
          notes?: string | null
          project_id: string
          updated_at?: string | null
          x: number
          y: number
          z: number
        }
        Update: {
          created_at?: string | null
          diameter?: string | null
          drilled_on?: string | null
          hole_id?: string
          hole_type?: string
          id?: string
          max_depth?: number | null
          notes?: string | null
          project_id?: string
          updated_at?: string | null
          x?: number
          y?: number
          z?: number
        }
        Relationships: []
      }
      dh_litho: {
        Row: {
          alteration: string | null
          created_at: string | null
          from_m: number
          hole_id: string
          id: string
          lithology: string | null
          mineralization: string | null
          project_id: string
          to_m: number
        }
        Insert: {
          alteration?: string | null
          created_at?: string | null
          from_m: number
          hole_id: string
          id?: string
          lithology?: string | null
          mineralization?: string | null
          project_id: string
          to_m: number
        }
        Update: {
          alteration?: string | null
          created_at?: string | null
          from_m?: number
          hole_id?: string
          id?: string
          lithology?: string | null
          mineralization?: string | null
          project_id?: string
          to_m?: number
        }
        Relationships: []
      }
      dh_survey: {
        Row: {
          azimuth: number
          created_at: string | null
          depth: number
          dip: number
          hole_id: string
          id: string
          project_id: string
        }
        Insert: {
          azimuth?: number
          created_at?: string | null
          depth: number
          dip?: number
          hole_id: string
          id?: string
          project_id: string
        }
        Update: {
          azimuth?: number
          created_at?: string | null
          depth?: number
          dip?: number
          hole_id?: string
          id?: string
          project_id?: string
        }
        Relationships: []
      }
      equipment_items: {
        Row: {
          capacity: number | null
          capacity_unit: string | null
          category: string
          created_at: string
          id: string
          name: string
          power_kw: number | null
          project_id: string
          status: string
          sub_category: string | null
          tag: string
        }
        Insert: {
          capacity?: number | null
          capacity_unit?: string | null
          category?: string
          created_at?: string
          id?: string
          name: string
          power_kw?: number | null
          project_id: string
          status?: string
          sub_category?: string | null
          tag: string
        }
        Update: {
          capacity?: number | null
          capacity_unit?: string | null
          category?: string
          created_at?: string
          id?: string
          name?: string
          power_kw?: number | null
          project_id?: string
          status?: string
          sub_category?: string | null
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_regimes: {
        Row: {
          corp_tax_pct: number
          country: string
          created_at: string | null
          depletion_pct: number
          id: string
          is_active: boolean | null
          mining_tax_pct: number
          notes: string | null
          regime_group: string
          region: string | null
          royalty_pct: number
          sort_order: number | null
        }
        Insert: {
          corp_tax_pct?: number
          country: string
          created_at?: string | null
          depletion_pct?: number
          id: string
          is_active?: boolean | null
          mining_tax_pct?: number
          notes?: string | null
          regime_group?: string
          region?: string | null
          royalty_pct?: number
          sort_order?: number | null
        }
        Update: {
          corp_tax_pct?: number
          country?: string
          created_at?: string | null
          depletion_pct?: number
          id?: string
          is_active?: boolean | null
          mining_tax_pct?: number
          notes?: string | null
          regime_group?: string
          region?: string | null
          royalty_pct?: number
          sort_order?: number | null
        }
        Relationships: []
      }
      geomet_clusters: {
        Row: {
          cluster_centroid: Json | null
          cluster_label: string
          created_at: string | null
          domain_names: string[]
          id: string
          project_id: string
          silhouette_score: number | null
        }
        Insert: {
          cluster_centroid?: Json | null
          cluster_label: string
          created_at?: string | null
          domain_names?: string[]
          id?: string
          project_id: string
          silhouette_score?: number | null
        }
        Update: {
          cluster_centroid?: Json | null
          cluster_label?: string
          created_at?: string | null
          domain_names?: string[]
          id?: string
          project_id?: string
          silhouette_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "geomet_clusters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      geomet_domains: {
        Row: {
          abi: number | null
          avg_bwi_kwh_t: number | null
          avg_cil_pct: number | null
          avg_grg_pct: number | null
          bwi_max: number | null
          bwi_min: number | null
          carbonate_pct: number | null
          cil_max: number | null
          cil_min: number | null
          clay_pct: number | null
          color: string | null
          created_at: string | null
          flotation_pct: number | null
          gid_code: string | null
          grg_max: number | null
          grg_min: number | null
          id: string
          is_imported: boolean
          lom_pct: number | null
          name: string
          notes: string | null
          preg_robbing: boolean | null
          project_id: string
          recovery_design: number | null
          recovery_max: number | null
          recovery_min: number | null
          rqi: number | null
          sai_kwh_t: number | null
          sample_count: number | null
          sulphide_pct: number | null
          updated_at: string | null
        }
        Insert: {
          abi?: number | null
          avg_bwi_kwh_t?: number | null
          avg_cil_pct?: number | null
          avg_grg_pct?: number | null
          bwi_max?: number | null
          bwi_min?: number | null
          carbonate_pct?: number | null
          cil_max?: number | null
          cil_min?: number | null
          clay_pct?: number | null
          color?: string | null
          created_at?: string | null
          flotation_pct?: number | null
          gid_code?: string | null
          grg_max?: number | null
          grg_min?: number | null
          id?: string
          is_imported?: boolean
          lom_pct?: number | null
          name: string
          notes?: string | null
          preg_robbing?: boolean | null
          project_id: string
          recovery_design?: number | null
          recovery_max?: number | null
          recovery_min?: number | null
          rqi?: number | null
          sai_kwh_t?: number | null
          sample_count?: number | null
          sulphide_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          abi?: number | null
          avg_bwi_kwh_t?: number | null
          avg_cil_pct?: number | null
          avg_grg_pct?: number | null
          bwi_max?: number | null
          bwi_min?: number | null
          carbonate_pct?: number | null
          cil_max?: number | null
          cil_min?: number | null
          clay_pct?: number | null
          color?: string | null
          created_at?: string | null
          flotation_pct?: number | null
          gid_code?: string | null
          grg_max?: number | null
          grg_min?: number | null
          id?: string
          is_imported?: boolean
          lom_pct?: number | null
          name?: string
          notes?: string | null
          preg_robbing?: boolean | null
          project_id?: string
          recovery_design?: number | null
          recovery_max?: number | null
          recovery_min?: number | null
          rqi?: number | null
          sai_kwh_t?: number | null
          sample_count?: number | null
          sulphide_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "geomet_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      granulometry_params: {
        Row: {
          abrasion_index: number | null
          ag_active: boolean
          ball_active: boolean
          bwi_kwh_t: number | null
          cone_active: boolean
          cyclone_cut_um: number | null
          density_sg: number | null
          f80_rom_mm: number | null
          feed_rate_tph: number | null
          gyratory_active: boolean
          hpgr_active: boolean
          id: string
          isamill_active: boolean
          jaw_active: boolean
          p80_ball_um: number | null
          p80_cone_mm: number | null
          p80_gyratory_mm: number | null
          p80_regrind_um: number | null
          p80_sag_um: number | null
          pct_solids: number | null
          pebble_active: boolean
          project_id: string
          regrind_ball_active: boolean
          rod_active: boolean
          sag_active: boolean
          sag_specific_energy: number | null
          smd_active: boolean
          spi_kwh_t: number | null
          updated_at: string | null
          vertimill_active: boolean
        }
        Insert: {
          abrasion_index?: number | null
          ag_active?: boolean
          ball_active?: boolean
          bwi_kwh_t?: number | null
          cone_active?: boolean
          cyclone_cut_um?: number | null
          density_sg?: number | null
          f80_rom_mm?: number | null
          feed_rate_tph?: number | null
          gyratory_active?: boolean
          hpgr_active?: boolean
          id?: string
          isamill_active?: boolean
          jaw_active?: boolean
          p80_ball_um?: number | null
          p80_cone_mm?: number | null
          p80_gyratory_mm?: number | null
          p80_regrind_um?: number | null
          p80_sag_um?: number | null
          pct_solids?: number | null
          pebble_active?: boolean
          project_id: string
          regrind_ball_active?: boolean
          rod_active?: boolean
          sag_active?: boolean
          sag_specific_energy?: number | null
          smd_active?: boolean
          spi_kwh_t?: number | null
          updated_at?: string | null
          vertimill_active?: boolean
        }
        Update: {
          abrasion_index?: number | null
          ag_active?: boolean
          ball_active?: boolean
          bwi_kwh_t?: number | null
          cone_active?: boolean
          cyclone_cut_um?: number | null
          density_sg?: number | null
          f80_rom_mm?: number | null
          feed_rate_tph?: number | null
          gyratory_active?: boolean
          hpgr_active?: boolean
          id?: string
          isamill_active?: boolean
          jaw_active?: boolean
          p80_ball_um?: number | null
          p80_cone_mm?: number | null
          p80_gyratory_mm?: number | null
          p80_regrind_um?: number | null
          p80_sag_um?: number | null
          pct_solids?: number | null
          pebble_active?: boolean
          project_id?: string
          regrind_ball_active?: boolean
          rod_active?: boolean
          sag_active?: boolean
          sag_specific_energy?: number | null
          smd_active?: boolean
          spi_kwh_t?: number | null
          updated_at?: string | null
          vertimill_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "granulometry_params_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_campaigns: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          name: string
          project_id: string
          sample_count_target: number | null
          start_date: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          project_id: string
          sample_count_target?: number | null
          start_date?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          project_id?: string
          sample_count_target?: number | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_domains: {
        Row: {
          code: string | null
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          project_id: string
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          project_id: string
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_granulometry: {
        Row: {
          campaign: string | null
          created_at: string | null
          d50_um: number | null
          domain: string | null
          f80_rom_mm: number | null
          id: string
          lithotype: string | null
          notes: string | null
          p80_um: number | null
          project_id: string
          sample_id: string | null
          test_code: string
          updated_at: string | null
        }
        Insert: {
          campaign?: string | null
          created_at?: string | null
          d50_um?: number | null
          domain?: string | null
          f80_rom_mm?: number | null
          id?: string
          lithotype?: string | null
          notes?: string | null
          p80_um?: number | null
          project_id: string
          sample_id?: string | null
          test_code?: string
          updated_at?: string | null
        }
        Update: {
          campaign?: string | null
          created_at?: string | null
          d50_um?: number | null
          domain?: string | null
          f80_rom_mm?: number | null
          id?: string
          lithotype?: string | null
          notes?: string | null
          p80_um?: number | null
          project_id?: string
          sample_id?: string | null
          test_code?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_granulometry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_granulometry_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_import_log: {
        Row: {
          created_at: string | null
          errors: Json | null
          id: string
          import_type: string | null
          project_id: string
          rows_err: number | null
          rows_ok: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          errors?: Json | null
          id?: string
          import_type?: string | null
          project_id: string
          rows_err?: number | null
          rows_ok?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          errors?: Json | null
          id?: string
          import_type?: string | null
          project_id?: string
          rows_err?: number | null
          rows_ok?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      lims_liberation: {
        Row: {
          au_free_pct: number | null
          au_locked_oxide_pct: number | null
          au_locked_silicate_pct: number | null
          au_locked_sulfide_pct: number | null
          au_preg_robbing_pct: number | null
          created_at: string | null
          granulometry_id: string | null
          id: string
          p80_liberation_um: number | null
          project_id: string
          sample_id: string | null
          sulfide_liberation_pct: number | null
        }
        Insert: {
          au_free_pct?: number | null
          au_locked_oxide_pct?: number | null
          au_locked_silicate_pct?: number | null
          au_locked_sulfide_pct?: number | null
          au_preg_robbing_pct?: number | null
          created_at?: string | null
          granulometry_id?: string | null
          id?: string
          p80_liberation_um?: number | null
          project_id: string
          sample_id?: string | null
          sulfide_liberation_pct?: number | null
        }
        Update: {
          au_free_pct?: number | null
          au_locked_oxide_pct?: number | null
          au_locked_silicate_pct?: number | null
          au_locked_sulfide_pct?: number | null
          au_preg_robbing_pct?: number | null
          created_at?: string | null
          granulometry_id?: string | null
          id?: string
          p80_liberation_um?: number | null
          project_id?: string
          sample_id?: string | null
          sulfide_liberation_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_liberation_granulometry_id_fkey"
            columns: ["granulometry_id"]
            isOneToOne: false
            referencedRelation: "lims_granulometry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_liberation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_liberation_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_psd_fractions: {
        Row: {
          au_dist_pct: number | null
          au_g_t: number | null
          granulometry_id: string
          id: string
          passing_pct: number | null
          project_id: string
          retained_pct: number | null
          sieve_um: number
        }
        Insert: {
          au_dist_pct?: number | null
          au_g_t?: number | null
          granulometry_id: string
          id?: string
          passing_pct?: number | null
          project_id: string
          retained_pct?: number | null
          sieve_um: number
        }
        Update: {
          au_dist_pct?: number | null
          au_g_t?: number | null
          granulometry_id?: string
          id?: string
          passing_pct?: number | null
          project_id?: string
          retained_pct?: number | null
          sieve_um?: number
        }
        Relationships: [
          {
            foreignKeyName: "lims_psd_fractions_granulo_project_fkey"
            columns: ["granulometry_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_granulometry"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lims_psd_fractions_granulometry_id_fkey"
            columns: ["granulometry_id"]
            isOneToOne: false
            referencedRelation: "lims_granulometry"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_samples: {
        Row: {
          azimuth_deg: number | null
          campaign: string
          created_at: string
          depth_from: number | null
          depth_to: number | null
          dip_deg: number | null
          domain: string | null
          drill_type: string | null
          elevation: number | null
          hole_id: string | null
          id: string
          length_m: number | null
          notes: string | null
          ore_type: string | null
          project_id: string
          result_unit: string | null
          result_value: number | null
          sample_id: string
          sample_id_display: string | null
          status: string
          test_type: string
          x_coord: number | null
          y_coord: number | null
          zone: string | null
        }
        Insert: {
          azimuth_deg?: number | null
          campaign?: string
          created_at?: string
          depth_from?: number | null
          depth_to?: number | null
          dip_deg?: number | null
          domain?: string | null
          drill_type?: string | null
          elevation?: number | null
          hole_id?: string | null
          id?: string
          length_m?: number | null
          notes?: string | null
          ore_type?: string | null
          project_id: string
          result_unit?: string | null
          result_value?: number | null
          sample_id: string
          sample_id_display?: string | null
          status?: string
          test_type?: string
          x_coord?: number | null
          y_coord?: number | null
          zone?: string | null
        }
        Update: {
          azimuth_deg?: number | null
          campaign?: string
          created_at?: string
          depth_from?: number | null
          depth_to?: number | null
          dip_deg?: number | null
          domain?: string | null
          drill_type?: string | null
          elevation?: number | null
          hole_id?: string | null
          id?: string
          length_m?: number | null
          notes?: string | null
          ore_type?: string | null
          project_id?: string
          result_unit?: string | null
          result_value?: number | null
          sample_id?: string
          sample_id_display?: string | null
          status?: string
          test_type?: string
          x_coord?: number | null
          y_coord?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_samples_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lims_test_chem: {
        Row: {
          ag_g_t: number | null
          al2o3_pct: number | null
          as_ppm: number | null
          au_g_t: number | null
          c_organic_pct: number | null
          cao_pct: number | null
          created_at: string | null
          cu_pct: number | null
          fe_pct: number | null
          hg_ppm: number | null
          id: string
          k2o_pct: number | null
          loi_950_pct: number | null
          mgo_pct: number | null
          mno_pct: number | null
          na2o_pct: number | null
          project_id: string
          s_sulfide_pct: number | null
          s_total_pct: number | null
          sample_id: string
          sb_ppm: number | null
          sio2_pct: number | null
          tio2_pct: number | null
        }
        Insert: {
          ag_g_t?: number | null
          al2o3_pct?: number | null
          as_ppm?: number | null
          au_g_t?: number | null
          c_organic_pct?: number | null
          cao_pct?: number | null
          created_at?: string | null
          cu_pct?: number | null
          fe_pct?: number | null
          hg_ppm?: number | null
          id?: string
          k2o_pct?: number | null
          loi_950_pct?: number | null
          mgo_pct?: number | null
          mno_pct?: number | null
          na2o_pct?: number | null
          project_id: string
          s_sulfide_pct?: number | null
          s_total_pct?: number | null
          sample_id: string
          sb_ppm?: number | null
          sio2_pct?: number | null
          tio2_pct?: number | null
        }
        Update: {
          ag_g_t?: number | null
          al2o3_pct?: number | null
          as_ppm?: number | null
          au_g_t?: number | null
          c_organic_pct?: number | null
          cao_pct?: number | null
          created_at?: string | null
          cu_pct?: number | null
          fe_pct?: number | null
          hg_ppm?: number | null
          id?: string
          k2o_pct?: number | null
          loi_950_pct?: number | null
          mgo_pct?: number | null
          mno_pct?: number | null
          na2o_pct?: number | null
          project_id?: string
          s_sulfide_pct?: number | null
          s_total_pct?: number | null
          sample_id?: string
          sb_ppm?: number | null
          sio2_pct?: number | null
          tio2_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_chem_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_chem_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_chem_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_comminution: {
        Row: {
          ai_index: number | null
          axb_jk: number | null
          brwi_kwh_t: number | null
          bwi_kwh_t: number | null
          created_at: string | null
          cwi_kwh_t: number | null
          dwi_kwh_m3: number | null
          f80_um: number | null
          id: string
          mia_kwh_t: number | null
          mib_kwh_t: number | null
          mic_kwh_t: number | null
          mih_kwh_t: number | null
          p80_um: number | null
          project_id: string
          rho_bulk_t_m3: number | null
          sample_id: string
          scse_kwh_t: number | null
          sg_t_m3: number | null
          spi_min: number | null
          ta_jk: number | null
          test_code: string
          ucs_mpa: number | null
        }
        Insert: {
          ai_index?: number | null
          axb_jk?: number | null
          brwi_kwh_t?: number | null
          bwi_kwh_t?: number | null
          created_at?: string | null
          cwi_kwh_t?: number | null
          dwi_kwh_m3?: number | null
          f80_um?: number | null
          id?: string
          mia_kwh_t?: number | null
          mib_kwh_t?: number | null
          mic_kwh_t?: number | null
          mih_kwh_t?: number | null
          p80_um?: number | null
          project_id: string
          rho_bulk_t_m3?: number | null
          sample_id: string
          scse_kwh_t?: number | null
          sg_t_m3?: number | null
          spi_min?: number | null
          ta_jk?: number | null
          test_code?: string
          ucs_mpa?: number | null
        }
        Update: {
          ai_index?: number | null
          axb_jk?: number | null
          brwi_kwh_t?: number | null
          bwi_kwh_t?: number | null
          created_at?: string | null
          cwi_kwh_t?: number | null
          dwi_kwh_m3?: number | null
          f80_um?: number | null
          id?: string
          mia_kwh_t?: number | null
          mib_kwh_t?: number | null
          mic_kwh_t?: number | null
          mih_kwh_t?: number | null
          p80_um?: number | null
          project_id?: string
          rho_bulk_t_m3?: number | null
          sample_id?: string
          scse_kwh_t?: number | null
          sg_t_m3?: number | null
          spi_min?: number | null
          ta_jk?: number | null
          test_code?: string
          ucs_mpa?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_comminution_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_comminution_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_cyanide_detox: {
        Row: {
          as_mg_l: number | null
          cao_kg_t: number | null
          cn_free_mg_l: number | null
          cn_total_mg_l: number | null
          cn_wad_mg_l: number | null
          cn_wad_rebound_24h_mg_l: number | null
          cn_wad_rebound_7j_mg_l: number | null
          created_at: string | null
          cu_mg_l: number | null
          cuso4_kg_t: number | null
          fe_mg_l: number | null
          h2o2_kg_t: number | null
          hg_ug_l: number | null
          id: string
          ni_mg_l: number | null
          pb_mg_l: number | null
          ph_final: number | null
          project_id: string
          sample_id: string
          scn_mg_l: number | null
          so2_kg_t: number | null
          treatment_duration_min: number | null
          zn_mg_l: number | null
        }
        Insert: {
          as_mg_l?: number | null
          cao_kg_t?: number | null
          cn_free_mg_l?: number | null
          cn_total_mg_l?: number | null
          cn_wad_mg_l?: number | null
          cn_wad_rebound_24h_mg_l?: number | null
          cn_wad_rebound_7j_mg_l?: number | null
          created_at?: string | null
          cu_mg_l?: number | null
          cuso4_kg_t?: number | null
          fe_mg_l?: number | null
          h2o2_kg_t?: number | null
          hg_ug_l?: number | null
          id?: string
          ni_mg_l?: number | null
          pb_mg_l?: number | null
          ph_final?: number | null
          project_id: string
          sample_id: string
          scn_mg_l?: number | null
          so2_kg_t?: number | null
          treatment_duration_min?: number | null
          zn_mg_l?: number | null
        }
        Update: {
          as_mg_l?: number | null
          cao_kg_t?: number | null
          cn_free_mg_l?: number | null
          cn_total_mg_l?: number | null
          cn_wad_mg_l?: number | null
          cn_wad_rebound_24h_mg_l?: number | null
          cn_wad_rebound_7j_mg_l?: number | null
          created_at?: string | null
          cu_mg_l?: number | null
          cuso4_kg_t?: number | null
          fe_mg_l?: number | null
          h2o2_kg_t?: number | null
          hg_ug_l?: number | null
          id?: string
          ni_mg_l?: number | null
          pb_mg_l?: number | null
          ph_final?: number | null
          project_id?: string
          sample_id?: string
          scn_mg_l?: number | null
          so2_kg_t?: number | null
          treatment_duration_min?: number | null
          zn_mg_l?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_cyanide_detox_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_cyanide_detox_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_cyanide_detox_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_egrg: {
        Row: {
          au_conc_grade_g_t: number | null
          created_at: string | null
          cumulative_recovery_pct: number | null
          id: string
          k80_um: number | null
          measured_grade_g_t: number | null
          project_id: string
          recalc_grade_g_t: number | null
          recovery_pct: number | null
          residue_grade_g_t: number | null
          sample_id: string
        }
        Insert: {
          au_conc_grade_g_t?: number | null
          created_at?: string | null
          cumulative_recovery_pct?: number | null
          id?: string
          k80_um?: number | null
          measured_grade_g_t?: number | null
          project_id: string
          recalc_grade_g_t?: number | null
          recovery_pct?: number | null
          residue_grade_g_t?: number | null
          sample_id: string
        }
        Update: {
          au_conc_grade_g_t?: number | null
          created_at?: string | null
          cumulative_recovery_pct?: number | null
          id?: string
          k80_um?: number | null
          measured_grade_g_t?: number | null
          project_id?: string
          recalc_grade_g_t?: number | null
          recovery_pct?: number | null
          residue_grade_g_t?: number | null
          sample_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_egrg_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_egrg_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_egrg_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_elution: {
        Row: {
          au_eluted_mg_l: number | null
          au_recovery_pct: number | null
          au_solution_fin_mg_l: number | null
          au_solution_ini_mg_l: number | null
          carbon_fines_pct: number | null
          carbon_load_g_l: number | null
          carbon_type: string | null
          created_at: string | null
          eluant_cn_g_l: number | null
          eluant_naoh_g_l: number | null
          elution_temp_c: number | null
          elution_time_h: number | null
          flow_rate_bv_h: number | null
          id: string
          kinetics_freundlich: number | null
          observations: string | null
          project_id: string
          sample_id: string
          test_type: string | null
        }
        Insert: {
          au_eluted_mg_l?: number | null
          au_recovery_pct?: number | null
          au_solution_fin_mg_l?: number | null
          au_solution_ini_mg_l?: number | null
          carbon_fines_pct?: number | null
          carbon_load_g_l?: number | null
          carbon_type?: string | null
          created_at?: string | null
          eluant_cn_g_l?: number | null
          eluant_naoh_g_l?: number | null
          elution_temp_c?: number | null
          elution_time_h?: number | null
          flow_rate_bv_h?: number | null
          id?: string
          kinetics_freundlich?: number | null
          observations?: string | null
          project_id: string
          sample_id: string
          test_type?: string | null
        }
        Update: {
          au_eluted_mg_l?: number | null
          au_recovery_pct?: number | null
          au_solution_fin_mg_l?: number | null
          au_solution_ini_mg_l?: number | null
          carbon_fines_pct?: number | null
          carbon_load_g_l?: number | null
          carbon_type?: string | null
          created_at?: string | null
          eluant_cn_g_l?: number | null
          eluant_naoh_g_l?: number | null
          elution_temp_c?: number | null
          elution_time_h?: number | null
          flow_rate_bv_h?: number | null
          id?: string
          kinetics_freundlich?: number | null
          observations?: string | null
          project_id?: string
          sample_id?: string
          test_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_elution_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_elution_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_elution_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_flotation: {
        Row: {
          au_conc_g_t: number | null
          au_feed_g_t: number | null
          au_recovery_pct: number | null
          au_tail_g_t: number | null
          collector_g_t: number | null
          conc_wt_pct: number | null
          created_at: string | null
          depressant_g_t: number | null
          feed_p80_um: number | null
          frother_g_t: number | null
          id: string
          project_id: string
          s_recovery_pct: number | null
          sample_id: string
          total_time_min: number | null
        }
        Insert: {
          au_conc_g_t?: number | null
          au_feed_g_t?: number | null
          au_recovery_pct?: number | null
          au_tail_g_t?: number | null
          collector_g_t?: number | null
          conc_wt_pct?: number | null
          created_at?: string | null
          depressant_g_t?: number | null
          feed_p80_um?: number | null
          frother_g_t?: number | null
          id?: string
          project_id: string
          s_recovery_pct?: number | null
          sample_id: string
          total_time_min?: number | null
        }
        Update: {
          au_conc_g_t?: number | null
          au_feed_g_t?: number | null
          au_recovery_pct?: number | null
          au_tail_g_t?: number | null
          collector_g_t?: number | null
          conc_wt_pct?: number | null
          created_at?: string | null
          depressant_g_t?: number | null
          feed_p80_um?: number | null
          frother_g_t?: number | null
          id?: string
          project_id?: string
          s_recovery_pct?: number | null
          sample_id?: string
          total_time_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_flotation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_flotation_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_flotation_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_gravity: {
        Row: {
          created_at: string | null
          grg_recovery_pct: number | null
          id: string
          mass_pull_pct: number | null
          p80_feed_um: number | null
          project_id: string
          sample_id: string
          test_code: string
        }
        Insert: {
          created_at?: string | null
          grg_recovery_pct?: number | null
          id?: string
          mass_pull_pct?: number | null
          p80_feed_um?: number | null
          project_id: string
          sample_id: string
          test_code: string
        }
        Update: {
          created_at?: string | null
          grg_recovery_pct?: number | null
          id?: string
          mass_pull_pct?: number | null
          p80_feed_um?: number | null
          project_id?: string
          sample_id?: string
          test_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_gravity_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_gravity_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_head: {
        Row: {
          au_g_t: number | null
          c_organic_pct: number | null
          created_at: string | null
          cu_pct: number | null
          fe_pct: number | null
          id: string
          project_id: string
          s_sulfide_pct: number | null
          s_total_pct: number | null
          sample_id: string
          test_code: string
        }
        Insert: {
          au_g_t?: number | null
          c_organic_pct?: number | null
          created_at?: string | null
          cu_pct?: number | null
          fe_pct?: number | null
          id?: string
          project_id: string
          s_sulfide_pct?: number | null
          s_total_pct?: number | null
          sample_id: string
          test_code: string
        }
        Update: {
          au_g_t?: number | null
          c_organic_pct?: number | null
          created_at?: string | null
          cu_pct?: number | null
          fe_pct?: number | null
          id?: string
          project_id?: string
          s_sulfide_pct?: number | null
          s_total_pct?: number | null
          sample_id?: string
          test_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_head_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_head_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_knelson: {
        Row: {
          au_conc_g_t: number | null
          au_feed_g_t: number | null
          au_tail_g_t: number | null
          conc_mass_g: number | null
          created_at: string | null
          duration_min: number | null
          grg_recovery_pct: number | null
          id: string
          mass_feed_kg: number | null
          mass_pull_pct: number | null
          p80_feed_um: number | null
          project_id: string
          rotation_rpm: number | null
          sample_id: string
          solids_pct: number | null
          water_psi: number | null
        }
        Insert: {
          au_conc_g_t?: number | null
          au_feed_g_t?: number | null
          au_tail_g_t?: number | null
          conc_mass_g?: number | null
          created_at?: string | null
          duration_min?: number | null
          grg_recovery_pct?: number | null
          id?: string
          mass_feed_kg?: number | null
          mass_pull_pct?: number | null
          p80_feed_um?: number | null
          project_id: string
          rotation_rpm?: number | null
          sample_id: string
          solids_pct?: number | null
          water_psi?: number | null
        }
        Update: {
          au_conc_g_t?: number | null
          au_feed_g_t?: number | null
          au_tail_g_t?: number | null
          conc_mass_g?: number | null
          created_at?: string | null
          duration_min?: number | null
          grg_recovery_pct?: number | null
          id?: string
          mass_feed_kg?: number | null
          mass_pull_pct?: number | null
          p80_feed_um?: number | null
          project_id?: string
          rotation_rpm?: number | null
          sample_id?: string
          solids_pct?: number | null
          water_psi?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_knelson_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_knelson_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_knelson_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_leach: {
        Row: {
          cao_kg_t: number | null
          created_at: string | null
          id: string
          nacn_kg_t: number | null
          project_id: string
          recovery_pct: number | null
          residue_au_g_t: number | null
          retention_h: number | null
          sample_id: string
          test_code: string
        }
        Insert: {
          cao_kg_t?: number | null
          created_at?: string | null
          id?: string
          nacn_kg_t?: number | null
          project_id: string
          recovery_pct?: number | null
          residue_au_g_t?: number | null
          retention_h?: number | null
          sample_id: string
          test_code?: string
        }
        Update: {
          cao_kg_t?: number | null
          created_at?: string | null
          id?: string
          nacn_kg_t?: number | null
          project_id?: string
          recovery_pct?: number | null
          residue_au_g_t?: number | null
          retention_h?: number | null
          sample_id?: string
          test_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_leach_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_leach_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_leaching: {
        Row: {
          au_feed_g_t: number | null
          au_tail_g_t: number | null
          cao_consumption_kg_t: number | null
          carbon_load_g_l: number | null
          composite_type: string | null
          created_at: string | null
          id: string
          leach_duration_h: number | null
          leach_rec_12h_pct: number | null
          leach_rec_24h_pct: number | null
          leach_rec_2h_pct: number | null
          leach_rec_48h_pct: number | null
          leach_rec_4h_pct: number | null
          leach_rec_8h_pct: number | null
          nacn_consumption_kg_t: number | null
          nacn_initial_ppm: number | null
          nacn_residual_24h_ppm: number | null
          o2_consumption_kg_t: number | null
          o2_dissolved_mg_l: number | null
          p80_um: number | null
          ph_final: number | null
          ph_initial: number | null
          project_id: string
          sample_id: string
          sg_t_m3: number | null
          solids_pct: number | null
          temperature_c: number | null
        }
        Insert: {
          au_feed_g_t?: number | null
          au_tail_g_t?: number | null
          cao_consumption_kg_t?: number | null
          carbon_load_g_l?: number | null
          composite_type?: string | null
          created_at?: string | null
          id?: string
          leach_duration_h?: number | null
          leach_rec_12h_pct?: number | null
          leach_rec_24h_pct?: number | null
          leach_rec_2h_pct?: number | null
          leach_rec_48h_pct?: number | null
          leach_rec_4h_pct?: number | null
          leach_rec_8h_pct?: number | null
          nacn_consumption_kg_t?: number | null
          nacn_initial_ppm?: number | null
          nacn_residual_24h_ppm?: number | null
          o2_consumption_kg_t?: number | null
          o2_dissolved_mg_l?: number | null
          p80_um?: number | null
          ph_final?: number | null
          ph_initial?: number | null
          project_id: string
          sample_id: string
          sg_t_m3?: number | null
          solids_pct?: number | null
          temperature_c?: number | null
        }
        Update: {
          au_feed_g_t?: number | null
          au_tail_g_t?: number | null
          cao_consumption_kg_t?: number | null
          carbon_load_g_l?: number | null
          composite_type?: string | null
          created_at?: string | null
          id?: string
          leach_duration_h?: number | null
          leach_rec_12h_pct?: number | null
          leach_rec_24h_pct?: number | null
          leach_rec_2h_pct?: number | null
          leach_rec_48h_pct?: number | null
          leach_rec_4h_pct?: number | null
          leach_rec_8h_pct?: number | null
          nacn_consumption_kg_t?: number | null
          nacn_initial_ppm?: number | null
          nacn_residual_24h_ppm?: number | null
          o2_consumption_kg_t?: number | null
          o2_dissolved_mg_l?: number | null
          p80_um?: number | null
          ph_final?: number | null
          ph_initial?: number | null
          project_id?: string
          sample_id?: string
          sg_t_m3?: number | null
          solids_pct?: number | null
          temperature_c?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_leaching_project_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_leaching_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_liberation: {
        Row: {
          au_free_pct: number | null
          au_occluded_pct: number | null
          au_oxides_pct: number | null
          au_preg_rob_pct: number | null
          au_silicates_pct: number | null
          au_sulphides_pct: number | null
          created_at: string | null
          id: string
          p80_um: number | null
          project_id: string
          sample_id: string
        }
        Insert: {
          au_free_pct?: number | null
          au_occluded_pct?: number | null
          au_oxides_pct?: number | null
          au_preg_rob_pct?: number | null
          au_silicates_pct?: number | null
          au_sulphides_pct?: number | null
          created_at?: string | null
          id?: string
          p80_um?: number | null
          project_id: string
          sample_id: string
        }
        Update: {
          au_free_pct?: number | null
          au_occluded_pct?: number | null
          au_oxides_pct?: number | null
          au_preg_rob_pct?: number | null
          au_silicates_pct?: number | null
          au_sulphides_pct?: number | null
          created_at?: string | null
          id?: string
          p80_um?: number | null
          project_id?: string
          sample_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_liberation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_liberation_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_liberation_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_mineralogy: {
        Row: {
          apatite_pct: number | null
          argilite_pct: number | null
          au_free_pct: number | null
          ca_minerals_pct: number | null
          carbonates_pct: number | null
          created_at: string | null
          fe_oxides_pct: number | null
          id: string
          ilmenite_pct: number | null
          k_feldspar_pct: number | null
          k_other_pct: number | null
          k80_um: number | null
          muscovite_pct: number | null
          other_oxides_pct: number | null
          other_pct: number | null
          other_silicates_pct: number | null
          other_sulphides_pct: number | null
          plagioclase_pct: number | null
          project_id: string
          pyrite_pct: number | null
          pyrrhotite_pct: number | null
          quartz_pct: number | null
          sample_id: string
          ti_oxides_pct: number | null
        }
        Insert: {
          apatite_pct?: number | null
          argilite_pct?: number | null
          au_free_pct?: number | null
          ca_minerals_pct?: number | null
          carbonates_pct?: number | null
          created_at?: string | null
          fe_oxides_pct?: number | null
          id?: string
          ilmenite_pct?: number | null
          k_feldspar_pct?: number | null
          k_other_pct?: number | null
          k80_um?: number | null
          muscovite_pct?: number | null
          other_oxides_pct?: number | null
          other_pct?: number | null
          other_silicates_pct?: number | null
          other_sulphides_pct?: number | null
          plagioclase_pct?: number | null
          project_id: string
          pyrite_pct?: number | null
          pyrrhotite_pct?: number | null
          quartz_pct?: number | null
          sample_id: string
          ti_oxides_pct?: number | null
        }
        Update: {
          apatite_pct?: number | null
          argilite_pct?: number | null
          au_free_pct?: number | null
          ca_minerals_pct?: number | null
          carbonates_pct?: number | null
          created_at?: string | null
          fe_oxides_pct?: number | null
          id?: string
          ilmenite_pct?: number | null
          k_feldspar_pct?: number | null
          k_other_pct?: number | null
          k80_um?: number | null
          muscovite_pct?: number | null
          other_oxides_pct?: number | null
          other_pct?: number | null
          other_silicates_pct?: number | null
          other_sulphides_pct?: number | null
          plagioclase_pct?: number | null
          project_id?: string
          pyrite_pct?: number | null
          pyrrhotite_pct?: number | null
          quartz_pct?: number | null
          sample_id?: string
          ti_oxides_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_mineralogy_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_mineralogy_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_mineralogy_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_psd: {
        Row: {
          au_head_g_t: number | null
          au_minus38_g_t: number | null
          au_plus212_g_t: number | null
          au_plus75_g_t: number | null
          created_at: string | null
          d50_um: number | null
          dist_au_minus38_pct: number | null
          dist_au_plus212_pct: number | null
          dist_au_plus75_pct: number | null
          id: string
          minus_38um_pct: number | null
          p80_um: number | null
          plus_106um_pct: number | null
          plus_150um_pct: number | null
          plus_212um_pct: number | null
          plus_38um_pct: number | null
          plus_500um_pct: number | null
          plus_53um_pct: number | null
          plus_75um_pct: number | null
          project_id: string
          sample_id: string
        }
        Insert: {
          au_head_g_t?: number | null
          au_minus38_g_t?: number | null
          au_plus212_g_t?: number | null
          au_plus75_g_t?: number | null
          created_at?: string | null
          d50_um?: number | null
          dist_au_minus38_pct?: number | null
          dist_au_plus212_pct?: number | null
          dist_au_plus75_pct?: number | null
          id?: string
          minus_38um_pct?: number | null
          p80_um?: number | null
          plus_106um_pct?: number | null
          plus_150um_pct?: number | null
          plus_212um_pct?: number | null
          plus_38um_pct?: number | null
          plus_500um_pct?: number | null
          plus_53um_pct?: number | null
          plus_75um_pct?: number | null
          project_id: string
          sample_id: string
        }
        Update: {
          au_head_g_t?: number | null
          au_minus38_g_t?: number | null
          au_plus212_g_t?: number | null
          au_plus75_g_t?: number | null
          created_at?: string | null
          d50_um?: number | null
          dist_au_minus38_pct?: number | null
          dist_au_plus212_pct?: number | null
          dist_au_plus75_pct?: number | null
          id?: string
          minus_38um_pct?: number | null
          p80_um?: number | null
          plus_106um_pct?: number | null
          plus_150um_pct?: number | null
          plus_212um_pct?: number | null
          plus_38um_pct?: number | null
          plus_500um_pct?: number | null
          plus_53um_pct?: number | null
          plus_75um_pct?: number | null
          project_id?: string
          sample_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_psd_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_psd_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_psd_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lims_test_thickening: {
        Row: {
          au_overflow_ppb: number | null
          cn_overflow_ppm: number | null
          created_at: string | null
          flocculant_g_t: number | null
          fsr_m_h: number | null
          id: string
          isr_m_h: number | null
          mass_flux_t_m2_d: number | null
          overflow_turbidity_ntu: number | null
          project_id: string
          sample_id: string
          uf_density_pct: number | null
          uf_density_t_m3: number | null
          uf_viscosity_mpas: number | null
          underflow_density_pct: number | null
          unit_area_m2_t_d: number | null
        }
        Insert: {
          au_overflow_ppb?: number | null
          cn_overflow_ppm?: number | null
          created_at?: string | null
          flocculant_g_t?: number | null
          fsr_m_h?: number | null
          id?: string
          isr_m_h?: number | null
          mass_flux_t_m2_d?: number | null
          overflow_turbidity_ntu?: number | null
          project_id: string
          sample_id: string
          uf_density_pct?: number | null
          uf_density_t_m3?: number | null
          uf_viscosity_mpas?: number | null
          underflow_density_pct?: number | null
          unit_area_m2_t_d?: number | null
        }
        Update: {
          au_overflow_ppb?: number | null
          cn_overflow_ppm?: number | null
          created_at?: string | null
          flocculant_g_t?: number | null
          fsr_m_h?: number | null
          id?: string
          isr_m_h?: number | null
          mass_flux_t_m2_d?: number | null
          overflow_turbidity_ntu?: number | null
          project_id?: string
          sample_id?: string
          uf_density_pct?: number | null
          uf_density_t_m3?: number | null
          uf_viscosity_mpas?: number | null
          underflow_density_pct?: number | null
          unit_area_m2_t_d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_test_thickening_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_thickening_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lims_test_thickening_sample_project_fkey"
            columns: ["sample_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lims_samples"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      mass_balance_streams: {
        Row: {
          au_g_t: number | null
          au_kg_h: number | null
          cn_kg_h: number | null
          created_at: string | null
          energy_kwh_h: number | null
          flowsheet_id: string | null
          from_node_id: string | null
          from_tag: string | null
          id: string
          is_edited: boolean | null
          lime_kg_h: number | null
          mass_tph: number | null
          name: string
          project_id: string
          slurry_m3h: number | null
          solids_pct: number | null
          sort_order: number | null
          stream_no: string
          to_node_id: string | null
          to_tag: string | null
          updated_at: string | null
          water_m3h: number | null
        }
        Insert: {
          au_g_t?: number | null
          au_kg_h?: number | null
          cn_kg_h?: number | null
          created_at?: string | null
          energy_kwh_h?: number | null
          flowsheet_id?: string | null
          from_node_id?: string | null
          from_tag?: string | null
          id?: string
          is_edited?: boolean | null
          lime_kg_h?: number | null
          mass_tph?: number | null
          name?: string
          project_id: string
          slurry_m3h?: number | null
          solids_pct?: number | null
          sort_order?: number | null
          stream_no?: string
          to_node_id?: string | null
          to_tag?: string | null
          updated_at?: string | null
          water_m3h?: number | null
        }
        Update: {
          au_g_t?: number | null
          au_kg_h?: number | null
          cn_kg_h?: number | null
          created_at?: string | null
          energy_kwh_h?: number | null
          flowsheet_id?: string | null
          from_node_id?: string | null
          from_tag?: string | null
          id?: string
          is_edited?: boolean | null
          lime_kg_h?: number | null
          mass_tph?: number | null
          name?: string
          project_id?: string
          slurry_m3h?: number | null
          solids_pct?: number | null
          sort_order?: number | null
          stream_no?: string
          to_node_id?: string | null
          to_tag?: string | null
          updated_at?: string | null
          water_m3h?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mass_balance_streams_flowsheet_id_fkey"
            columns: ["flowsheet_id"]
            isOneToOne: false
            referencedRelation: "project_flowsheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mass_balance_streams_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mine_design_benches: {
        Row: {
          bench_rl: number
          blast_pattern: string | null
          created_at: string | null
          domain: string | null
          explosive_type: string | null
          grade_g_t: number
          id: string
          length_m: number | null
          notes: string | null
          ore_mt: number
          ore_type: string | null
          pit_id: string | null
          powder_factor: number | null
          project_id: string
          waste_mt: number
          width_m: number | null
        }
        Insert: {
          bench_rl: number
          blast_pattern?: string | null
          created_at?: string | null
          domain?: string | null
          explosive_type?: string | null
          grade_g_t?: number
          id?: string
          length_m?: number | null
          notes?: string | null
          ore_mt?: number
          ore_type?: string | null
          pit_id?: string | null
          powder_factor?: number | null
          project_id: string
          waste_mt?: number
          width_m?: number | null
        }
        Update: {
          bench_rl?: number
          blast_pattern?: string | null
          created_at?: string | null
          domain?: string | null
          explosive_type?: string | null
          grade_g_t?: number
          id?: string
          length_m?: number | null
          notes?: string | null
          ore_mt?: number
          ore_type?: string | null
          pit_id?: string | null
          powder_factor?: number | null
          project_id?: string
          waste_mt?: number
          width_m?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mine_design_benches_pit_id_fkey"
            columns: ["pit_id"]
            isOneToOne: false
            referencedRelation: "mine_design_pits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mine_design_benches_pit_project_fkey"
            columns: ["pit_id", "project_id"]
            isOneToOne: false
            referencedRelation: "mine_design_pits"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      mine_design_equipment_schedule: {
        Row: {
          cost_h: number | null
          created_at: string | null
          equipment_name: string
          equipment_type: string
          hours_year: number | null
          id: string
          notes: string | null
          pit_id: string | null
          project_id: string
          quantity: number
          year: number
        }
        Insert: {
          cost_h?: number | null
          created_at?: string | null
          equipment_name: string
          equipment_type: string
          hours_year?: number | null
          id?: string
          notes?: string | null
          pit_id?: string | null
          project_id: string
          quantity?: number
          year: number
        }
        Update: {
          cost_h?: number | null
          created_at?: string | null
          equipment_name?: string
          equipment_type?: string
          hours_year?: number | null
          id?: string
          notes?: string | null
          pit_id?: string | null
          project_id?: string
          quantity?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "mine_design_equipment_pit_project_fkey"
            columns: ["pit_id", "project_id"]
            isOneToOne: false
            referencedRelation: "mine_design_pits"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "mine_design_equipment_schedule_pit_id_fkey"
            columns: ["pit_id"]
            isOneToOne: false
            referencedRelation: "mine_design_pits"
            referencedColumns: ["id"]
          },
        ]
      }
      mine_design_pits: {
        Row: {
          bench_height_m: number
          berm_width_m: number
          color: string
          created_at: string | null
          crest_rl: number | null
          floor_rl: number | null
          grade_g_t: number
          id: string
          name: string
          notes: string | null
          ore_mt: number
          pit_type: string
          project_id: string
          sequence_order: number
          slope_angle_deg: number
          status: string
          strip_ratio: number | null
          updated_at: string | null
          waste_mt: number
        }
        Insert: {
          bench_height_m?: number
          berm_width_m?: number
          color?: string
          created_at?: string | null
          crest_rl?: number | null
          floor_rl?: number | null
          grade_g_t?: number
          id?: string
          name?: string
          notes?: string | null
          ore_mt?: number
          pit_type?: string
          project_id: string
          sequence_order?: number
          slope_angle_deg?: number
          status?: string
          strip_ratio?: number | null
          updated_at?: string | null
          waste_mt?: number
        }
        Update: {
          bench_height_m?: number
          berm_width_m?: number
          color?: string
          created_at?: string | null
          crest_rl?: number | null
          floor_rl?: number | null
          grade_g_t?: number
          id?: string
          name?: string
          notes?: string | null
          ore_mt?: number
          pit_type?: string
          project_id?: string
          sequence_order?: number
          slope_angle_deg?: number
          status?: string
          strip_ratio?: number | null
          updated_at?: string | null
          waste_mt?: number
        }
        Relationships: []
      }
      mine_params: {
        Row: {
          bench_height_m: number | null
          blasting_cost_t: number
          capex_unit_cost_usd_t: number
          created_at: string | null
          cutoff_g_t: number | null
          dilution_pct: number
          discount_rate_pct: number
          drill: string | null
          ga_cost_m: number
          ga_cost_t: number | null
          gold_price_sens: number
          grade_decay_pct_yr: number
          grade_g_t: number | null
          id: string
          lom_years: number | null
          method: string
          mining_cost_t: number | null
          nsr_pct: number
          ore_recovery_pct: number
          process_cost_t: number | null
          project_id: string
          pump_cost_m: number
          ramp_up_y1_pct: number
          ramp_up_y2_pct: number
          reserves_mt: number | null
          royalty_pct: number
          shovel: string | null
          slope_angle_deg: number | null
          stripping_ratio: number | null
          sustaining_capex_m: number
          sustaining_capex_musd_yr: number | null
          trucks: string | null
          updated_at: string | null
        }
        Insert: {
          bench_height_m?: number | null
          blasting_cost_t?: number
          capex_unit_cost_usd_t?: number
          created_at?: string | null
          cutoff_g_t?: number | null
          dilution_pct?: number
          discount_rate_pct?: number
          drill?: string | null
          ga_cost_m?: number
          ga_cost_t?: number | null
          gold_price_sens?: number
          grade_decay_pct_yr?: number
          grade_g_t?: number | null
          id?: string
          lom_years?: number | null
          method?: string
          mining_cost_t?: number | null
          nsr_pct?: number
          ore_recovery_pct?: number
          process_cost_t?: number | null
          project_id: string
          pump_cost_m?: number
          ramp_up_y1_pct?: number
          ramp_up_y2_pct?: number
          reserves_mt?: number | null
          royalty_pct?: number
          shovel?: string | null
          slope_angle_deg?: number | null
          stripping_ratio?: number | null
          sustaining_capex_m?: number
          sustaining_capex_musd_yr?: number | null
          trucks?: string | null
          updated_at?: string | null
        }
        Update: {
          bench_height_m?: number | null
          blasting_cost_t?: number
          capex_unit_cost_usd_t?: number
          created_at?: string | null
          cutoff_g_t?: number | null
          dilution_pct?: number
          discount_rate_pct?: number
          drill?: string | null
          ga_cost_m?: number
          ga_cost_t?: number | null
          gold_price_sens?: number
          grade_decay_pct_yr?: number
          grade_g_t?: number | null
          id?: string
          lom_years?: number | null
          method?: string
          mining_cost_t?: number | null
          nsr_pct?: number
          ore_recovery_pct?: number
          process_cost_t?: number | null
          project_id?: string
          pump_cost_m?: number
          ramp_up_y1_pct?: number
          ramp_up_y2_pct?: number
          reserves_mt?: number | null
          royalty_pct?: number
          shovel?: string | null
          slope_angle_deg?: number | null
          stripping_ratio?: number | null
          sustaining_capex_m?: number
          sustaining_capex_musd_yr?: number | null
          trucks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mine_params_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mine_phases: {
        Row: {
          area: string | null
          color: string | null
          created_at: string | null
          grade_g_t: number | null
          id: string
          name: string
          ore_mt: number | null
          ore_type: string | null
          phase_no: number
          project_id: string
          recovery_pct: number | null
          sort_order: number
          waste_mt: number | null
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          area?: string | null
          color?: string | null
          created_at?: string | null
          grade_g_t?: number | null
          id?: string
          name: string
          ore_mt?: number | null
          ore_type?: string | null
          phase_no: number
          project_id: string
          recovery_pct?: number | null
          sort_order?: number
          waste_mt?: number | null
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          area?: string | null
          color?: string | null
          created_at?: string | null
          grade_g_t?: number | null
          id?: string
          name?: string
          ore_mt?: number | null
          ore_type?: string | null
          phase_no?: number
          project_id?: string
          recovery_pct?: number | null
          sort_order?: number
          waste_mt?: number | null
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mine_phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      module_status: {
        Row: {
          completion_pct: number
          id: string
          is_linked: boolean | null
          last_updated: string | null
          linked_from: string[] | null
          metadata: Json | null
          module_id: string
          project_id: string
          record_count: number
        }
        Insert: {
          completion_pct?: number
          id?: string
          is_linked?: boolean | null
          last_updated?: string | null
          linked_from?: string[] | null
          metadata?: Json | null
          module_id: string
          project_id: string
          record_count?: number
        }
        Update: {
          completion_pct?: number
          id?: string
          is_linked?: boolean | null
          last_updated?: string | null
          linked_from?: string[] | null
          metadata?: Json | null
          module_id?: string
          project_id?: string
          record_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "module_status_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      monte_carlo_configs: {
        Row: {
          bins: number
          distribution_method: string
          id: string
          iterations: number
          project_id: string
          seed: number | null
          updated_at: string | null
        }
        Insert: {
          bins?: number
          distribution_method?: string
          id?: string
          iterations?: number
          project_id: string
          seed?: number | null
          updated_at?: string | null
        }
        Update: {
          bins?: number
          distribution_method?: string
          id?: string
          iterations?: number
          project_id?: string
          seed?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monte_carlo_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ni43101_reports: {
        Row: {
          completion_pct: number | null
          created_at: string | null
          id: string
          project_id: string
          qp_firm: string | null
          qp_name: string | null
          qp_registration: string | null
          report_date: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          completion_pct?: number | null
          created_at?: string | null
          id?: string
          project_id: string
          qp_firm?: string | null
          qp_name?: string | null
          qp_registration?: string | null
          report_date?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Update: {
          completion_pct?: number | null
          created_at?: string | null
          id?: string
          project_id?: string
          qp_firm?: string | null
          qp_name?: string | null
          qp_registration?: string | null
          report_date?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ni43101_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ni43101_sections: {
        Row: {
          auto_generated_content: string | null
          content: string | null
          created_at: string | null
          id: string
          is_validated: boolean | null
          project_id: string
          qp_notes: string | null
          report_id: string
          section_number: string
          section_title: string
          status: string
          updated_at: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          auto_generated_content?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          is_validated?: boolean | null
          project_id: string
          qp_notes?: string | null
          report_id: string
          section_number: string
          section_title: string
          status?: string
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          auto_generated_content?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          is_validated?: boolean | null
          project_id?: string
          qp_notes?: string | null
          report_id?: string
          section_number?: string
          section_title?: string
          status?: string
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ni43101_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ni43101_sections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "ni43101_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ni43101_sections_report_project_fkey"
            columns: ["report_id", "project_id"]
            isOneToOne: false
            referencedRelation: "ni43101_reports"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      opex_lines: {
        Row: {
          category: string
          created_at: string | null
          description: string
          id: string
          notes: string | null
          project_id: string
          sort_order: number | null
          source: string | null
          value_usd_t: number
        }
        Insert: {
          category: string
          created_at?: string | null
          description: string
          id?: string
          notes?: string | null
          project_id: string
          sort_order?: number | null
          source?: string | null
          value_usd_t?: number
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string
          id?: string
          notes?: string | null
          project_id?: string
          sort_order?: number | null
          source?: string | null
          value_usd_t?: number
        }
        Relationships: [
          {
            foreignKeyName: "opex_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      p80_optimization_runs: {
        Row: {
          comment: string | null
          confidence_level: string
          created_at: string | null
          id: string
          inputs: Json
          k_indus: number
          k_indus_mode: string
          p80_lims_um: number | null
          p80_optimal_plant_um: number
          p80_target_lab_um: number
          project_id: string
          results: Json
          scenario_selected: string
          specific_energy_kwh_t: number
          total_power_kw: number | null
        }
        Insert: {
          comment?: string | null
          confidence_level?: string
          created_at?: string | null
          id?: string
          inputs?: Json
          k_indus: number
          k_indus_mode?: string
          p80_lims_um?: number | null
          p80_optimal_plant_um: number
          p80_target_lab_um: number
          project_id: string
          results?: Json
          scenario_selected: string
          specific_energy_kwh_t: number
          total_power_kw?: number | null
        }
        Update: {
          comment?: string | null
          confidence_level?: string
          created_at?: string | null
          id?: string
          inputs?: Json
          k_indus?: number
          k_indus_mode?: string
          p80_lims_um?: number | null
          p80_optimal_plant_um?: number
          p80_target_lab_um?: number
          project_id?: string
          results?: Json
          scenario_selected?: string
          specific_energy_kwh_t?: number
          total_power_kw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "p80_optimization_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      p80_optimum: {
        Row: {
          bwi_kwh_t: number | null
          energy_kwh_t: number | null
          engine_source: string | null
          f80_um: number | null
          id: string
          net_value_usd_t: number | null
          optimal_p80_um: number
          project_id: string
          recovery_pct: number | null
          updated_at: string | null
        }
        Insert: {
          bwi_kwh_t?: number | null
          energy_kwh_t?: number | null
          engine_source?: string | null
          f80_um?: number | null
          id?: string
          net_value_usd_t?: number | null
          optimal_p80_um: number
          project_id: string
          recovery_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          bwi_kwh_t?: number | null
          energy_kwh_t?: number | null
          engine_source?: string | null
          f80_um?: number | null
          id?: string
          net_value_usd_t?: number | null
          optimal_p80_um?: number
          project_id?: string
          recovery_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "p80_optimum_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      process_factors: {
        Row: {
          balls_kg_t: number | null
          cao_kg_t: number | null
          energy_kwh_t: number | null
          equipment_type: string
          id: string
          nacn_kg_t: number | null
          notes: string | null
          project_id: string
          source: string | null
          updated_at: string | null
          water_m3_t: number | null
        }
        Insert: {
          balls_kg_t?: number | null
          cao_kg_t?: number | null
          energy_kwh_t?: number | null
          equipment_type: string
          id?: string
          nacn_kg_t?: number | null
          notes?: string | null
          project_id: string
          source?: string | null
          updated_at?: string | null
          water_m3_t?: number | null
        }
        Update: {
          balls_kg_t?: number | null
          cao_kg_t?: number | null
          energy_kwh_t?: number | null
          equipment_type?: string
          id?: string
          nacn_kg_t?: number | null
          notes?: string | null
          project_id?: string
          source?: string | null
          updated_at?: string | null
          water_m3_t?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "process_factors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_fiscal_selection: {
        Row: {
          project_id: string
          regime_id: string
          updated_at: string | null
        }
        Insert: {
          project_id: string
          regime_id: string
          updated_at?: string | null
        }
        Update: {
          project_id?: string
          regime_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_fiscal_selection_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_fiscal_selection_regime_id_fkey"
            columns: ["regime_id"]
            isOneToOne: false
            referencedRelation: "fiscal_regimes"
            referencedColumns: ["id"]
          },
        ]
      }
      project_flowsheets: {
        Row: {
          created_at: string | null
          edges: Json
          id: string
          name: string
          nodes: Json
          project_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          edges?: Json
          id?: string
          name?: string
          nodes?: Json
          project_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          edges?: Json
          id?: string
          name?: string
          nodes?: Json
          project_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_flowsheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_met_constants: {
        Row: {
          overrides: Json
          project_id: string
          updated_at: string
        }
        Insert: {
          overrides?: Json
          project_id: string
          updated_at?: string
        }
        Update: {
          overrides?: Json
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_met_constants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_metals: {
        Row: {
          created_at: string | null
          grade: number | null
          grade_unit: string
          id: string
          is_payable: boolean
          is_primary: boolean
          name: string | null
          notes: string | null
          payable_pct: number
          price_unit: string
          price_usd: number | null
          project_id: string
          recovery_pct: number | null
          sort_order: number
          symbol: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          grade?: number | null
          grade_unit?: string
          id?: string
          is_payable?: boolean
          is_primary?: boolean
          name?: string | null
          notes?: string | null
          payable_pct?: number
          price_unit?: string
          price_usd?: number | null
          project_id: string
          recovery_pct?: number | null
          sort_order?: number
          symbol: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          grade?: number | null
          grade_unit?: string
          id?: string
          is_payable?: boolean
          is_primary?: boolean
          name?: string | null
          notes?: string | null
          payable_pct?: number
          price_unit?: string
          price_usd?: number | null
          project_id?: string
          recovery_pct?: number | null
          sort_order?: number
          symbol?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_metals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_settings: {
        Row: {
          cao_co2_factor: number | null
          contingency_pct: number | null
          debt_equity_ratio_pct: number | null
          diesel_co2_l: number | null
          discount_rate_pct: number | null
          grid_ef_kg_co2_kwh: number | null
          hours_per_year: number | null
          id: string
          lom_years: number | null
          nacn_co2_factor: number | null
          project_id: string
          refinery_charge_usd_oz: number | null
          royalty_pct: number | null
          smelting_charge_pct: number | null
          sustaining_capex_musd_yr: number | null
          updated_at: string | null
          working_capital_pct: number | null
        }
        Insert: {
          cao_co2_factor?: number | null
          contingency_pct?: number | null
          debt_equity_ratio_pct?: number | null
          diesel_co2_l?: number | null
          discount_rate_pct?: number | null
          grid_ef_kg_co2_kwh?: number | null
          hours_per_year?: number | null
          id?: string
          lom_years?: number | null
          nacn_co2_factor?: number | null
          project_id: string
          refinery_charge_usd_oz?: number | null
          royalty_pct?: number | null
          smelting_charge_pct?: number | null
          sustaining_capex_musd_yr?: number | null
          updated_at?: string | null
          working_capital_pct?: number | null
        }
        Update: {
          cao_co2_factor?: number | null
          contingency_pct?: number | null
          debt_equity_ratio_pct?: number | null
          diesel_co2_l?: number | null
          discount_rate_pct?: number | null
          grid_ef_kg_co2_kwh?: number | null
          hours_per_year?: number | null
          id?: string
          lom_years?: number | null
          nacn_co2_factor?: number | null
          project_id?: string
          refinery_charge_usd_oz?: number | null
          royalty_pct?: number | null
          smelting_charge_pct?: number | null
          sustaining_capex_musd_yr?: number | null
          updated_at?: string | null
          working_capital_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_snapshots: {
        Row: {
          created_at: string | null
          id: string
          kpi_snapshot: Json
          label: string
          note: string | null
          project_id: string
          project_state: Json
          settings_state: Json
        }
        Insert: {
          created_at?: string | null
          id?: string
          kpi_snapshot?: Json
          label: string
          note?: string | null
          project_id: string
          project_state?: Json
          settings_state?: Json
        }
        Update: {
          created_at?: string | null
          id?: string
          kpi_snapshot?: Json
          label?: string
          note?: string | null
          project_id?: string
          project_state?: Json
          settings_state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          annual_tonnes: number | null
          availability_pct: number
          code: string
          country: string
          created_at: string
          gold_grade_g_t: number
          gold_price_usd: number
          id: string
          name: string
          ore_sg: number
          phase: string
          recovery_pct: number
          target_tph: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          annual_tonnes?: number | null
          availability_pct?: number
          code: string
          country?: string
          created_at?: string
          gold_grade_g_t?: number
          gold_price_usd?: number
          id?: string
          name: string
          ore_sg?: number
          phase?: string
          recovery_pct?: number
          target_tph?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          annual_tonnes?: number | null
          availability_pct?: number
          code?: string
          country?: string
          created_at?: string
          gold_grade_g_t?: number
          gold_price_usd?: number
          id?: string
          name?: string
          ore_sg?: number
          phase?: string
          recovery_pct?: number
          target_tph?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      qualified_persons: {
        Row: {
          company: string | null
          created_at: string | null
          designation: string | null
          id: string
          name: string
          project_id: string
          site_visit_date: string | null
          title: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          designation?: string | null
          id?: string
          name: string
          project_id: string
          site_visit_date?: string | null
          title?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string | null
          designation?: string | null
          id?: string
          name?: string
          project_id?: string
          site_visit_date?: string | null
          title?: string | null
        }
        Relationships: []
      }
      report_documents: {
        Row: {
          author_name: string | null
          content_snapshot: Json | null
          created_at: string | null
          generated_at: string | null
          id: string
          pages_estimated: number | null
          project_id: string
          report_type: string
          sections_completed: number | null
          sections_total: number | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          author_name?: string | null
          content_snapshot?: Json | null
          created_at?: string | null
          generated_at?: string | null
          id?: string
          pages_estimated?: number | null
          project_id: string
          report_type: string
          sections_completed?: number | null
          sections_total?: number | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          author_name?: string | null
          content_snapshot?: Json | null
          created_at?: string | null
          generated_at?: string | null
          id?: string
          pages_estimated?: number | null
          project_id?: string
          report_type?: string
          sections_completed?: number | null
          sections_total?: number | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      report_section_signoffs: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          qp_id: string | null
          section_key: string
          signed_on: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          qp_id?: string | null
          section_key: string
          signed_on?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          qp_id?: string | null
          section_key?: string
          signed_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_section_signoffs_qp_id_fkey"
            columns: ["qp_id"]
            isOneToOne: false
            referencedRelation: "qualified_persons"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_estimation_runs: {
        Row: {
          block_x: number
          block_y: number
          block_z: number
          classification: Json | null
          composite_length_m: number
          created_at: string | null
          effective_date: string | null
          element: string
          id: string
          is_effective: boolean
          max_samples: number
          method: string
          min_samples: number
          name: string
          project_id: string
          search_radius_m: number
          summary: Json | null
          variogram: Json | null
        }
        Insert: {
          block_x?: number
          block_y?: number
          block_z?: number
          classification?: Json | null
          composite_length_m?: number
          created_at?: string | null
          effective_date?: string | null
          element?: string
          id?: string
          is_effective?: boolean
          max_samples?: number
          method?: string
          min_samples?: number
          name?: string
          project_id: string
          search_radius_m?: number
          summary?: Json | null
          variogram?: Json | null
        }
        Update: {
          block_x?: number
          block_y?: number
          block_z?: number
          classification?: Json | null
          composite_length_m?: number
          created_at?: string | null
          effective_date?: string | null
          element?: string
          id?: string
          is_effective?: boolean
          max_samples?: number
          method?: string
          min_samples?: number
          name?: string
          project_id?: string
          search_radius_m?: number
          summary?: Json | null
          variogram?: Json | null
        }
        Relationships: []
      }
      risk_auto_sources: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          risk_id: string | null
          source_module: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          risk_id?: string | null
          source_module: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          risk_id?: string | null
          source_module?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_auto_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_auto_sources_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
        ]
      }
      risks: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          impact: number
          mitigation: string | null
          probability: number
          project_id: string
          status: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          id?: string
          impact?: number
          mitigation?: string | null
          probability?: number
          project_id: string
          status?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          impact?: number
          mitigation?: string | null
          probability?: number
          project_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_circuits: {
        Row: {
          blocks: Json
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          project_id: string
          updated_at: string | null
        }
        Insert: {
          blocks?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          project_id: string
          updated_at?: string | null
        }
        Update: {
          blocks?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sim_circuits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_edges: {
        Row: {
          created_at: string | null
          flowsheet_id: string
          id: string
          project_id: string
          results: Json | null
          source_node_id: string
          stream_label: string | null
          stream_type: string
          target_node_id: string
        }
        Insert: {
          created_at?: string | null
          flowsheet_id: string
          id?: string
          project_id: string
          results?: Json | null
          source_node_id: string
          stream_label?: string | null
          stream_type?: string
          target_node_id: string
        }
        Update: {
          created_at?: string | null
          flowsheet_id?: string
          id?: string
          project_id?: string
          results?: Json | null
          source_node_id?: string
          stream_label?: string | null
          stream_type?: string
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sim_edges_flowsheet_id_fkey"
            columns: ["flowsheet_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_edges_flowsheet_project_fkey"
            columns: ["flowsheet_id", "project_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "sim_edges_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_expansion_scenarios: {
        Row: {
          created_at: string | null
          economics: Json | null
          flowsheet_id: string
          id: string
          label: string
          modifications: Json
          project_id: string
          run_id: string | null
          target_increase_pct: number
        }
        Insert: {
          created_at?: string | null
          economics?: Json | null
          flowsheet_id: string
          id?: string
          label: string
          modifications?: Json
          project_id: string
          run_id?: string | null
          target_increase_pct?: number
        }
        Update: {
          created_at?: string | null
          economics?: Json | null
          flowsheet_id?: string
          id?: string
          label?: string
          modifications?: Json
          project_id?: string
          run_id?: string | null
          target_increase_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "sim_expansion_flowsheet_project_fkey"
            columns: ["flowsheet_id", "project_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "sim_expansion_scenarios_flowsheet_id_fkey"
            columns: ["flowsheet_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_expansion_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_feed_link: {
        Row: {
          bwi_kwh_t: number | null
          f80_um: number | null
          gold_grade_g_t: number | null
          id: string
          p80_source: string | null
          p80_um: number | null
          project_id: string
          recovery_pct: number | null
          updated_at: string | null
        }
        Insert: {
          bwi_kwh_t?: number | null
          f80_um?: number | null
          gold_grade_g_t?: number | null
          id?: string
          p80_source?: string | null
          p80_um?: number | null
          project_id: string
          recovery_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          bwi_kwh_t?: number | null
          f80_um?: number | null
          gold_grade_g_t?: number | null
          id?: string
          p80_source?: string | null
          p80_um?: number | null
          project_id?: string
          recovery_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sim_feed_link_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_flowsheets: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          project_id: string
          status: string
          updated_at: string | null
          version: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          project_id: string
          status?: string
          updated_at?: string | null
          version?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          project_id?: string
          status?: string
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sim_flowsheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_nodes: {
        Row: {
          availability_pct: number | null
          created_at: string | null
          design_capacity: number | null
          flowsheet_id: string
          id: string
          label: string
          parameters: Json
          position_x: number
          position_y: number
          project_id: string
          results: Json | null
          unit_type: string
        }
        Insert: {
          availability_pct?: number | null
          created_at?: string | null
          design_capacity?: number | null
          flowsheet_id: string
          id?: string
          label: string
          parameters?: Json
          position_x?: number
          position_y?: number
          project_id: string
          results?: Json | null
          unit_type: string
        }
        Update: {
          availability_pct?: number | null
          created_at?: string | null
          design_capacity?: number | null
          flowsheet_id?: string
          id?: string
          label?: string
          parameters?: Json
          position_x?: number
          position_y?: number
          project_id?: string
          results?: Json | null
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sim_nodes_flowsheet_id_fkey"
            columns: ["flowsheet_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_nodes_flowsheet_project_fkey"
            columns: ["flowsheet_id", "project_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "sim_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_run_results: {
        Row: {
          convergence_error: number | null
          created_at: string | null
          feed_input: Json
          flowsheet_id: string
          global_results: Json | null
          id: string
          iterations: number | null
          mode: string
          node_results: Json | null
          project_id: string
          scenario_label: string | null
          status: string
          stream_results: Json | null
        }
        Insert: {
          convergence_error?: number | null
          created_at?: string | null
          feed_input?: Json
          flowsheet_id: string
          global_results?: Json | null
          id?: string
          iterations?: number | null
          mode?: string
          node_results?: Json | null
          project_id: string
          scenario_label?: string | null
          status?: string
          stream_results?: Json | null
        }
        Update: {
          convergence_error?: number | null
          created_at?: string | null
          feed_input?: Json
          flowsheet_id?: string
          global_results?: Json | null
          id?: string
          iterations?: number | null
          mode?: string
          node_results?: Json | null
          project_id?: string
          scenario_label?: string | null
          status?: string
          stream_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sim_run_results_flowsheet_id_fkey"
            columns: ["flowsheet_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_run_results_flowsheet_project_fkey"
            columns: ["flowsheet_id", "project_id"]
            isOneToOne: false
            referencedRelation: "sim_flowsheets"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "sim_run_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_runs: {
        Row: {
          annual_oz: number | null
          annual_rev_musd: number | null
          cao_kg_t: number | null
          circuit_id: string | null
          created_at: string | null
          energy_kwh_t: number | null
          id: string
          nacn_kg_t: number | null
          notes: string | null
          p80_um: number | null
          params: Json | null
          project_id: string
          reagent_kg_t: number | null
          recovery_pct: number | null
          retention_h: number | null
          scenario_name: string
          status: string
          throughput_tph: number | null
        }
        Insert: {
          annual_oz?: number | null
          annual_rev_musd?: number | null
          cao_kg_t?: number | null
          circuit_id?: string | null
          created_at?: string | null
          energy_kwh_t?: number | null
          id?: string
          nacn_kg_t?: number | null
          notes?: string | null
          p80_um?: number | null
          params?: Json | null
          project_id: string
          reagent_kg_t?: number | null
          recovery_pct?: number | null
          retention_h?: number | null
          scenario_name: string
          status?: string
          throughput_tph?: number | null
        }
        Update: {
          annual_oz?: number | null
          annual_rev_musd?: number | null
          cao_kg_t?: number | null
          circuit_id?: string | null
          created_at?: string | null
          energy_kwh_t?: number | null
          id?: string
          nacn_kg_t?: number | null
          notes?: string | null
          p80_um?: number | null
          params?: Json | null
          project_id?: string
          reagent_kg_t?: number | null
          recovery_pct?: number | null
          retention_h?: number | null
          scenario_name?: string
          status?: string
          throughput_tph?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sim_runs_circuit_id_fkey"
            columns: ["circuit_id"]
            isOneToOne: false
            referencedRelation: "sim_circuits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_gate_items: {
        Row: {
          completed: boolean
          completed_at: string | null
          gate_num: number
          id: string
          item_key: string
          project_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          gate_num: number
          id?: string
          item_key: string
          project_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          gate_num?: number
          id?: string
          item_key?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_gate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
