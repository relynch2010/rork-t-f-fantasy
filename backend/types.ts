/* eslint-disable */
// AUTO-GENERATED — DO NOT EDIT
// Run migrations to regenerate.

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
      athlete_mappings: {
        Row: {
          athlete_id: string | null
          confirmed_by: string | null
          created_at: string
          gender: string | null
          id: string
          league_id: string
          provider: string
          rejected: boolean
          school: string | null
          source_key: string
          source_name: string | null
        }
        Insert: {
          athlete_id?: string | null
          confirmed_by?: string | null
          created_at?: string
          gender?: string | null
          id: string
          league_id: string
          provider: string
          rejected?: boolean
          school?: string | null
          source_key: string
          source_name?: string | null
        }
        Update: {
          athlete_id?: string | null
          confirmed_by?: string | null
          created_at?: string
          gender?: string | null
          id?: string
          league_id?: string
          provider?: string
          rejected?: boolean
          school?: string | null
          source_key?: string
          source_name?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          detail: Json
          id: string
          league_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: Json
          id: string
          league_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: Json
          id?: string
          league_id?: string
        }
        Relationships: []
      }
      meet_results: {
        Row: {
          athlete_id: string | null
          athlete_name: string | null
          athlete_source_id: string | null
          bib: string | null
          completeness: string | null
          event: string | null
          event_name: string | null
          gender: string | null
          grade: string | null
          heat: number | null
          heat_place: number | null
          id: string
          is_demo: boolean
          league_id: string
          mark: string | null
          match_type: string | null
          meet_id: string
          place: number | null
          race_id: string | null
          relevant: boolean
          result_status: string | null
          round: string | null
          school: string | null
          seeded_count: number | null
          source_event_id: string | null
          splits: Json
          updated_at: string
          version: number
        }
        Insert: {
          athlete_id?: string | null
          athlete_name?: string | null
          athlete_source_id?: string | null
          bib?: string | null
          completeness?: string | null
          event?: string | null
          event_name?: string | null
          gender?: string | null
          grade?: string | null
          heat?: number | null
          heat_place?: number | null
          id: string
          is_demo?: boolean
          league_id: string
          mark?: string | null
          match_type?: string | null
          meet_id: string
          place?: number | null
          race_id?: string | null
          relevant?: boolean
          result_status?: string | null
          round?: string | null
          school?: string | null
          seeded_count?: number | null
          source_event_id?: string | null
          splits?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          athlete_id?: string | null
          athlete_name?: string | null
          athlete_source_id?: string | null
          bib?: string | null
          completeness?: string | null
          event?: string | null
          event_name?: string | null
          gender?: string | null
          grade?: string | null
          heat?: number | null
          heat_place?: number | null
          id?: string
          is_demo?: boolean
          league_id?: string
          mark?: string | null
          match_type?: string | null
          meet_id?: string
          place?: number | null
          race_id?: string | null
          relevant?: boolean
          result_status?: string | null
          round?: string | null
          school?: string | null
          seeded_count?: number | null
          source_event_id?: string | null
          splits?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      meets: {
        Row: {
          athletes_matched: number
          created_at: string
          created_by: string | null
          events_url: string | null
          id: string
          is_demo: boolean
          last_error: string | null
          last_synced_at: string | null
          league_id: string
          live: boolean
          meet_date: string | null
          name: string
          provider: string
          results_processed: number
          results_url: string | null
          roster_url: string | null
          status: string
          unmatched: number
          updated_at: string
          week: number
        }
        Insert: {
          athletes_matched?: number
          created_at?: string
          created_by?: string | null
          events_url?: string | null
          id: string
          is_demo?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          league_id: string
          live?: boolean
          meet_date?: string | null
          name: string
          provider?: string
          results_processed?: number
          results_url?: string | null
          roster_url?: string | null
          status?: string
          unmatched?: number
          updated_at?: string
          week: number
        }
        Update: {
          athletes_matched?: number
          created_at?: string
          created_by?: string | null
          events_url?: string | null
          id?: string
          is_demo?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          league_id?: string
          live?: boolean
          meet_date?: string | null
          name?: string
          provider?: string
          results_processed?: number
          results_url?: string | null
          roster_url?: string | null
          status?: string
          unmatched?: number
          updated_at?: string
          week?: number
        }
        Relationships: []
      }
      performance_history: {
        Row: {
          athlete_id: string
          event: string
          id: string
          league_id: string
          lifetime_pb: string | null
          results: Json
          season: number
          season_best: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          event: string
          id: string
          league_id: string
          lifetime_pb?: string | null
          results?: Json
          season: number
          season_best?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          event?: string
          id?: string
          league_id?: string
          lifetime_pb?: string | null
          results?: Json
          season?: number
          season_best?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scoring_events: {
        Row: {
          athlete_id: string
          category: string
          created_at: string
          event: string | null
          explanation: string | null
          fantasy_team_id: string | null
          id: string
          is_demo: boolean
          league_id: string
          matchup_id: string | null
          meet_id: string | null
          points: number
          provisional: boolean
          source_result_id: string | null
          week: number
        }
        Insert: {
          athlete_id: string
          category: string
          created_at?: string
          event?: string | null
          explanation?: string | null
          fantasy_team_id?: string | null
          id: string
          is_demo?: boolean
          league_id: string
          matchup_id?: string | null
          meet_id?: string | null
          points: number
          provisional?: boolean
          source_result_id?: string | null
          week: number
        }
        Update: {
          athlete_id?: string
          category?: string
          created_at?: string
          event?: string | null
          explanation?: string | null
          fantasy_team_id?: string | null
          id?: string
          is_demo?: boolean
          league_id?: string
          matchup_id?: string | null
          meet_id?: string | null
          points?: number
          provisional?: boolean
          source_result_id?: string | null
          week?: number
        }
        Relationships: []
      }
      scoring_standards: {
        Row: {
          active: boolean
          event: string
          gender: string
          id: string
          league_id: string
          points: number
          required_mark: string
          season: number
          standard_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          event: string
          gender: string
          id: string
          league_id: string
          points: number
          required_mark: string
          season: number
          standard_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          event?: string
          gender?: string
          id?: string
          league_id?: string
          points?: number
          required_mark?: string
          season?: number
          standard_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      unmatched_results: {
        Row: {
          bib: string | null
          candidates: Json
          created_at: string
          event_name: string | null
          gender: string | null
          id: string
          kind: string
          league_id: string
          meet_id: string
          resolved_at: string | null
          resolved_athlete_id: string | null
          resolved_by: string | null
          result: string | null
          school: string | null
          source_name: string | null
          status: string
        }
        Insert: {
          bib?: string | null
          candidates?: Json
          created_at?: string
          event_name?: string | null
          gender?: string | null
          id: string
          kind?: string
          league_id: string
          meet_id: string
          resolved_at?: string | null
          resolved_athlete_id?: string | null
          resolved_by?: string | null
          result?: string | null
          school?: string | null
          source_name?: string | null
          status?: string
        }
        Update: {
          bib?: string | null
          candidates?: Json
          created_at?: string
          event_name?: string | null
          gender?: string | null
          id?: string
          kind?: string
          league_id?: string
          meet_id?: string
          resolved_at?: string | null
          resolved_athlete_id?: string | null
          resolved_by?: string | null
          result?: string | null
          school?: string | null
          source_name?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      td_claim: { Args: { p_secret: string }; Returns: boolean }
      td_count: { Args: { p_league: string; p_secret: string }; Returns: Json }
      td_delete: {
        Args: { p_ids: string[]; p_secret: string; p_table: string }
        Returns: number
      }
      td_replace: {
        Args: {
          p_league: string
          p_rows: Json
          p_secret: string
          p_table: string
        }
        Returns: number
      }
      td_select: {
        Args: {
          p_league: string
          p_limit?: number
          p_secret: string
          p_table: string
        }
        Returns: Json
      }
      td_upsert: {
        Args: { p_rows: Json; p_secret: string; p_table: string }
        Returns: number
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
