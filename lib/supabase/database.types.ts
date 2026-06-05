export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_system: boolean
          kind: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          kind: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          account_id: string
          column_mapping: Json | null
          created_at: string
          duplicate_count: number
          file_name: string | null
          id: string
          imported_count: number
          row_count: number
          status: string
          storage_path: string | null
        }
        Insert: {
          account_id: string
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          status?: string
          storage_path?: string | null
        }
        Update: {
          account_id?: string
          column_mapping?: Json | null
          created_at?: string
          duplicate_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_profiles: {
        Row: {
          column_mapping: Json
          created_at: string
          date_format: string | null
          decimal_sep: string | null
          delimiter: string | null
          encoding: string | null
          header_signature: string
          id: string
        }
        Insert: {
          column_mapping: Json
          created_at?: string
          date_format?: string | null
          decimal_sep?: string | null
          delimiter?: string | null
          encoding?: string | null
          header_signature: string
          id?: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          date_format?: string | null
          decimal_sep?: string | null
          delimiter?: string | null
          encoding?: string | null
          header_signature?: string
          id?: string
        }
        Relationships: []
      }
      insights: {
        Row: {
          generated_at: string
          id: string
          period_start: string
          period_type: string
          stale: boolean
          stats: Json | null
          summary_md: string | null
        }
        Insert: {
          generated_at?: string
          id?: string
          period_start: string
          period_type: string
          stale?: boolean
          stats?: Json | null
          summary_md?: string | null
        }
        Update: {
          generated_at?: string
          id?: string
          period_start?: string
          period_type?: string
          stale?: boolean
          stats?: Json | null
          summary_md?: string | null
        }
        Relationships: []
      }
      merchant_map: {
        Row: {
          category_id: string
          created_at: string
          hit_count: number
          id: string
          match_type: string
          pattern: string
          source: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          hit_count?: number
          id?: string
          match_type: string
          pattern: string
          source: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          hit_count?: number
          id?: string
          match_type?: string
          pattern?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_map_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_history: {
        Row: {
          answer_md: string | null
          created_at: string
          id: string
          question: string
          tool_calls: Json | null
        }
        Insert: {
          answer_md?: string | null
          created_at?: string
          id?: string
          question: string
          tool_calls?: Json | null
        }
        Update: {
          answer_md?: string | null
          created_at?: string
          id?: string
          question?: string
          tool_calls?: Json | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          ai_confidence: number | null
          amount_minor: number
          booked_at: string
          category_id: string | null
          category_source: string
          counterparty: string | null
          counterparty_account: string | null
          created_at: string
          currency: string
          dedup_hash: string
          id: string
          import_batch_id: string | null
          merchant: string | null
          notes: string | null
          raw_description: string
          title: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          amount_minor: number
          booked_at: string
          category_id?: string | null
          category_source?: string
          counterparty?: string | null
          counterparty_account?: string | null
          created_at?: string
          currency: string
          dedup_hash: string
          id?: string
          import_batch_id?: string | null
          merchant?: string | null
          notes?: string | null
          raw_description: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          amount_minor?: number
          booked_at?: string
          category_id?: string | null
          category_source?: string
          counterparty?: string | null
          counterparty_account?: string | null
          created_at?: string
          currency?: string
          dedup_hash?: string
          id?: string
          import_batch_id?: string | null
          merchant?: string | null
          notes?: string | null
          raw_description?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

