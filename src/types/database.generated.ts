// GENERATED FILE. DO NOT EDIT BY HAND.
// Generated on 2026-11-12 with the Supabase type generator.
// Source: the live Supabase project, schema `public`.
// To regenerate, follow docs/supabase-types.md.
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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      creator_follows: {
        Row: { follower: string; creator: string; at: string }
        Insert: { follower: string; creator: string; at?: string }
        Update: { follower?: string; creator?: string; at?: string }
        Relationships: [
          { foreignKeyName: "creator_follows_follower_fkey"; columns: ["follower"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "creator_follows_creator_fkey"; columns: ["creator"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      creator_posts: {
        Row: { id: string; creator: string; url: string; kind: string; pub_id: string; day_index: number | null; caption: string | null; created_at: string }
        Insert: { creator: string; url: string; kind: string; pub_id: string; day_index?: number | null; caption?: string | null }
        Update: { caption?: string | null }
        Relationships: [
          { foreignKeyName: "creator_posts_creator_fkey"; columns: ["creator"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "creator_posts_pub_id_fkey"; columns: ["pub_id"]; isOneToOne: false; referencedRelation: "published_itineraries"; referencedColumns: ["id"] },
        ]
      }
      activity: {
        Row: {
          actor_id: string
          at: number
          id: string
          target: string | null
          trip_id: string
          verb: string
        }
        Insert: {
          actor_id: string
          at?: number
          id?: string
          target?: string | null
          trip_id: string
          verb?: string
        }
        Update: {
          actor_id?: string
          at?: number
          id?: string
          target?: string | null
          trip_id?: string
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit: {
        Row: {
          action: string
          actor_id: string
          at: number
          detail: Json
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id: string
          at?: number
          detail?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          at?: number
          detail?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collab_commands: {
        Row: {
          actor_id: string
          applied_at: number
          command_hash: string
          command_id: string
          receipt: Json
          trip_id: string
        }
        Insert: {
          actor_id: string
          applied_at?: number
          command_hash: string
          command_id: string
          receipt?: Json
          trip_id: string
        }
        Update: {
          actor_id?: string
          applied_at?: number
          command_hash?: string
          command_id?: string
          receipt?: Json
          trip_id?: string
        }
        Relationships: []
      }
      create_funnel_events: {
        Row: {
          at: string
          event: string
          id: string
          meta: Json | null
          phase: string | null
          session_id: string
          trip_id: string | null
          user_id: string | null
        }
        Insert: {
          at?: string
          event: string
          id?: string
          meta?: Json | null
          phase?: string | null
          session_id: string
          trip_id?: string | null
          user_id?: string | null
        }
        Update: {
          at?: string
          event?: string
          id?: string
          meta?: Json | null
          phase?: string | null
          session_id?: string
          trip_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "create_funnel_events_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "create_funnel_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          comments: Json
          context: string | null
          created_at: number
          id: string
          options: Json
          question: string
          raised_by: string
          resolved_at: number | null
          resolved_option_id: string | null
          resolved_stop_id: string | null
          status: string
          trip_id: string
          votes_by_user_id: Json
        }
        Insert: {
          comments?: Json
          context?: string | null
          created_at?: number
          id?: string
          options?: Json
          question?: string
          raised_by: string
          resolved_at?: number | null
          resolved_option_id?: string | null
          resolved_stop_id?: string | null
          status?: string
          trip_id: string
          votes_by_user_id?: Json
        }
        Update: {
          comments?: Json
          context?: string | null
          created_at?: number
          id?: string
          options?: Json
          question?: string
          raised_by?: string
          resolved_at?: number | null
          resolved_option_id?: string | null
          resolved_stop_id?: string | null
          status?: string
          trip_id?: string
          votes_by_user_id?: Json
        }
        Relationships: [
          {
            foreignKeyName: "decisions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          amount_paid_inr: number
          granted_at: string
          id: string
          order_id: string
          pub_id: string
          user_id: string | null
        }
        Insert: {
          amount_paid_inr: number
          granted_at?: string
          id?: string
          order_id: string
          pub_id: string
          user_id?: string | null
        }
        Update: {
          amount_paid_inr?: number
          granted_at?: string
          id?: string
          order_id?: string
          pub_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_pub_id_fkey"
            columns: ["pub_id"]
            isOneToOne: false
            referencedRelation: "published_itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          at: number
          id: string
          read: boolean
          text: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          at?: number
          id?: string
          read?: boolean
          text?: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          at?: number
          id?: string
          read?: boolean
          text?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_cards: {
        Row: {
          featured_pub_id: string | null
          planning_notes: Json | null
          avatar_url: string | null
          creator_available: boolean
          creator_bio: string | null
          id: string
          is_creator: boolean
          name: string
          social_links: Json
        }
        Insert: {
          featured_pub_id?: string | null
          planning_notes?: Json | null
          avatar_url?: string | null
          creator_available?: boolean
          creator_bio?: string | null
          id: string
          is_creator?: boolean
          name?: string
          social_links?: Json
        }
        Update: {
          featured_pub_id?: string | null
          planning_notes?: Json | null
          avatar_url?: string | null
          creator_available?: boolean
          creator_bio?: string | null
          id?: string
          is_creator?: boolean
          name?: string
          social_links?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profile_cards_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          featured_pub_id: string | null
          planning_notes: Json | null
          avatar_url: string | null
          created_at: number
          creator_bio: string | null
          email: string
          home_city: string | null
          id: string
          is_creator: boolean
          is_disabled: boolean
          languages: Json
          name: string
          social_links: Json | null
          travel_styles: Json
        }
        Insert: {
          featured_pub_id?: string | null
          planning_notes?: Json | null
          avatar_url?: string | null
          created_at?: number
          creator_bio?: string | null
          email: string
          home_city?: string | null
          id: string
          is_creator?: boolean
          is_disabled?: boolean
          languages?: Json
          name?: string
          social_links?: Json | null
          travel_styles?: Json
        }
        Update: {
          featured_pub_id?: string | null
          planning_notes?: Json | null
          avatar_url?: string | null
          created_at?: number
          creator_bio?: string | null
          email?: string
          home_city?: string | null
          id?: string
          is_creator?: boolean
          is_disabled?: boolean
          languages?: Json
          name?: string
          social_links?: Json | null
          travel_styles?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profiles_featured_pub_fkey"
            columns: ["featured_pub_id"]
            isOneToOne: false
            referencedRelation: "published_itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      pub_events: {
        Row: {
          at: string
          campaign_id: string | null
          id: number
          kind: string
          pub_id: string
          source: string | null
        }
        Insert: {
          at?: string
          campaign_id?: string | null
          id?: never
          kind: string
          pub_id: string
          source?: string | null
        }
        Update: {
          at?: string
          campaign_id?: string | null
          id?: never
          kind?: string
          pub_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pub_events_pub_id_fkey"
            columns: ["pub_id"]
            isOneToOne: false
            referencedRelation: "published_itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      published_itineraries: {
        Row: {
          planned_km: number | null
          best_months: number | null
          reviewed_at: string | null
          reviewed_scope: string | null
          best_season: string | null
          copies: number
          cover_image_url: string | null
          creator_id: string
          duration_days: number
          estimated_budget_per_person_inr: number
          free_day_indexes: Json
          id: string
          premium_price_inr: number | null
          published_at: number
          refreshed_at: number | null
          route_summary: Json
          subscriber_cta: string | null
          tagline: string | null
          title: string
          travel_style: string | null
          travel_tips: Json
          trip_id: string
          unpublished_at: number | null
          views: number
          warnings_and_assumptions: Json
        }
        Insert: {
          planned_km?: number | null
          best_months?: number | null
          reviewed_at?: string | null
          reviewed_scope?: string | null
          best_season?: string | null
          copies?: number
          cover_image_url?: string | null
          creator_id: string
          duration_days?: number
          estimated_budget_per_person_inr?: number
          free_day_indexes?: Json
          id: string
          premium_price_inr?: number | null
          published_at?: number
          refreshed_at?: number | null
          route_summary?: Json
          subscriber_cta?: string | null
          tagline?: string | null
          title?: string
          travel_style?: string | null
          travel_tips?: Json
          trip_id: string
          unpublished_at?: number | null
          views?: number
          warnings_and_assumptions?: Json
        }
        Update: {
          planned_km?: number | null
          best_months?: number | null
          reviewed_at?: string | null
          reviewed_scope?: string | null
          best_season?: string | null
          copies?: number
          cover_image_url?: string | null
          creator_id?: string
          duration_days?: number
          estimated_budget_per_person_inr?: number
          free_day_indexes?: Json
          id?: string
          premium_price_inr?: number | null
          published_at?: number
          refreshed_at?: number | null
          route_summary?: Json
          subscriber_cta?: string | null
          tagline?: string | null
          title?: string
          travel_style?: string | null
          travel_tips?: Json
          trip_id?: string
          unpublished_at?: number | null
          views?: number
          warnings_and_assumptions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "published_itineraries_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_itineraries_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount_inr: number
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          price_snapshot_inr: number
          pub_id: string
          razorpay_order_id: string
          razorpay_payment_id: string | null
          refunded_paise: number
          status: string
          user_id: string
        }
        Insert: {
          amount_inr: number
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          price_snapshot_inr: number
          pub_id: string
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          refunded_paise?: number
          status?: string
          user_id: string
        }
        Update: {
          amount_inr?: number
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          price_snapshot_inr?: number
          pub_id?: string
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          refunded_paise?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_pub_id_fkey"
            columns: ["pub_id"]
            isOneToOne: false
            referencedRelation: "published_itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          accepted_stop_id: string | null
          category: string | null
          comments: Json
          created_at: number
          day_id: string | null
          day_index: number
          description: string | null
          estimated_entry_fee_inr: number
          estimated_transport_inr: number
          id: string
          lat: number | null
          lng: number | null
          location_name: string | null
          place: Json | null
          proposed_by: string
          status: string
          title: string
          trip_id: string
          visit_minutes: number
          votes: Json
        }
        Insert: {
          accepted_stop_id?: string | null
          category?: string | null
          comments?: Json
          created_at?: number
          day_id?: string | null
          day_index?: number
          description?: string | null
          estimated_entry_fee_inr?: number
          estimated_transport_inr?: number
          id?: string
          lat?: number | null
          lng?: number | null
          location_name?: string | null
          place?: Json | null
          proposed_by: string
          status?: string
          title?: string
          trip_id: string
          visit_minutes?: number
          votes?: Json
        }
        Update: {
          accepted_stop_id?: string | null
          category?: string | null
          comments?: Json
          created_at?: number
          day_id?: string | null
          day_index?: number
          description?: string | null
          estimated_entry_fee_inr?: number
          estimated_transport_inr?: number
          id?: string
          lat?: number | null
          lng?: number | null
          location_name?: string | null
          place?: Json | null
          proposed_by?: string
          status?: string
          title?: string
          trip_id?: string
          visit_minutes?: number
          votes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_contribution_restore_events: {
        Row: {
          activity: Json
          decisions: Json
          deleted_at: number
          id: string
          notifications: Json
          owner_id: string
          restore_until: string
          restored_at: number | null
          suggestions: Json
          trip_id: string
        }
        Insert: {
          activity: Json
          decisions: Json
          deleted_at?: number
          id?: string
          notifications: Json
          owner_id: string
          restore_until?: string
          restored_at?: number | null
          suggestions: Json
          trip_id: string
        }
        Update: {
          activity?: Json
          decisions?: Json
          deleted_at?: number
          id?: string
          notifications?: Json
          owner_id?: string
          restore_until?: string
          restored_at?: number | null
          suggestions?: Json
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_contribution_restore_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_members: {
        Row: {
          joined_at: number
          role: string
          trip_id: string
          user_id: string
        }
        Insert: {
          joined_at?: number
          role?: string
          trip_id: string
          user_id: string
        }
        Update: {
          joined_at?: number
          role?: string
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_members_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          budget_per_person_inr: number
          campaign_id: string | null
          cover_emoji: string
          cover_image_url: string | null
          created_at: number
          creation_kind: string | null
          days: Json
          deleted_at: string | null
          destination_coords: Json | null
          destinations: Json
          drive_after_dinner_min: number | null
          driver_count: number | null
          drives_part: boolean | null
          end_date: string
          expenses: Json
          fixed_commitments: Json
          flights: Json | null
          fuel_economy_km_per_l: number | null
          fuel_price_per_l: number | null
          has_vulnerable: boolean | null
          id: string
          invite_code: string | null
          local_train: boolean | null
          name: string
          owner_id: string
          ref: string | null
          rent_per_day_inr: number | null
          round_trip: boolean | null
          source_pub_id: string | null
          start_date: string
          start_location: string
          start_location_coords: Json | null
          stay_style: string | null
          tank_l: number | null
          transport_mode: string
          travel_style: string
          travellers: number
          updated_at: number
          vehicle_profile: Json | null
          visibility: string
          write_version: number
        }
        Insert: {
          budget_per_person_inr?: number
          campaign_id?: string | null
          cover_emoji?: string
          cover_image_url?: string | null
          created_at?: number
          creation_kind?: string | null
          days?: Json
          deleted_at?: string | null
          destination_coords?: Json | null
          destinations?: Json
          drive_after_dinner_min?: number | null
          driver_count?: number | null
          drives_part?: boolean | null
          end_date?: string
          expenses?: Json
          fixed_commitments?: Json
          flights?: Json | null
          fuel_economy_km_per_l?: number | null
          fuel_price_per_l?: number | null
          has_vulnerable?: boolean | null
          id?: string
          invite_code?: string | null
          local_train?: boolean | null
          name: string
          owner_id: string
          ref?: string | null
          rent_per_day_inr?: number | null
          round_trip?: boolean | null
          source_pub_id?: string | null
          start_date?: string
          start_location?: string
          start_location_coords?: Json | null
          stay_style?: string | null
          tank_l?: number | null
          transport_mode?: string
          travel_style?: string
          travellers?: number
          updated_at?: number
          vehicle_profile?: Json | null
          visibility?: string
          write_version?: number
        }
        Update: {
          budget_per_person_inr?: number
          campaign_id?: string | null
          cover_emoji?: string
          cover_image_url?: string | null
          created_at?: number
          creation_kind?: string | null
          days?: Json
          deleted_at?: string | null
          destination_coords?: Json | null
          destinations?: Json
          drive_after_dinner_min?: number | null
          driver_count?: number | null
          drives_part?: boolean | null
          end_date?: string
          expenses?: Json
          fixed_commitments?: Json
          flights?: Json | null
          fuel_economy_km_per_l?: number | null
          fuel_price_per_l?: number | null
          has_vulnerable?: boolean | null
          id?: string
          invite_code?: string | null
          local_train?: boolean | null
          name?: string
          owner_id?: string
          ref?: string | null
          rent_per_day_inr?: number | null
          round_trip?: boolean | null
          source_pub_id?: string | null
          start_date?: string
          start_location?: string
          start_location_coords?: Json | null
          stay_style?: string | null
          tank_l?: number | null
          transport_mode?: string
          travel_style?: string
          travellers?: number
          updated_at?: number
          vehicle_profile?: Json | null
          visibility?: string
          write_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trips_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dna: {
        Row: {
          log: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          log?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          log?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dna_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_trip: { Args: { p_trip_id: string }; Returns: undefined }
      admin_delete_user: {
        Args: { p_force?: boolean; p_user_id: string }
        Returns: undefined
      }
      admin_remove_member: {
        Args: { p_trip_id: string; p_user_id: string }
        Returns: undefined
      }
      admin_revenue: {
        Args: { p_limit?: number; p_since?: string }
        Returns: {
          amount_paid_inr: number
          creator_id: string
          granted_at: string
          pub_id: string
        }[]
      }
      admin_set_creator: {
        Args: { p_is_creator: boolean; p_user_id: string }
        Returns: undefined
      }
      admin_set_disabled: {
        Args: { p_disabled: boolean; p_user_id: string }
        Returns: undefined
      }
      admin_set_trip_visibility: {
        Args: { p_trip_id: string; p_visibility: string }
        Returns: undefined
      }
      admin_share_attribution: {
        Args: { p_days?: number }
        Returns: {
          forks: number
          last_at: string
          source: string
          views: number
        }[]
      }
      admin_unpublish: { Args: { p_trip_id: string }; Returns: undefined }
      apply_order_refund: {
        Args: {
          p_amount_captured_paise: number
          p_amount_refunded_paise: number
          p_razorpay_order_id: string
        }
        Returns: string
      }
      bump_creator_page_view: {
        Args: { p_creator: string; p_source?: string; p_post?: string }
        Returns: undefined
      }
      bump_published_stats: {
        Args: {
          p_campaign?: string
          p_id: string
          p_kind: string
          p_source?: string
        }
        Returns: undefined
      }
      claim_paid_order: {
        Args: { p_razorpay_order_id: string }
        Returns: string
      }
      collab_same_visit_place: {
        Args: { p_stop: Json; p_suggestion: Json }
        Returns: boolean
      }
      collab_valid_decision_place: { Args: { p_place: Json }; Returns: boolean }
      collab_valid_place_identity: {
        Args: { p_identity: Json }
        Returns: boolean
      }
      get_creator_funnel: {
        Args: { p_days?: number }
        Returns: {
          day: string
          forks: number
          pub_id: string
          views: number
        }[]
      }
      get_creator_page_views: {
        Args: { p_days?: number }
        Returns: {
          day: string
          source: string
          visits: number
        }[]
      }
      get_creator_sales: {
        Args: never
        Returns: {
          amount_paid_inr: number
          granted_at: string
          id: string
          order_id: string
          pub_id: string
          user_id: string
        }[]
      }
      get_creator_share_sources: {
        Args: { p_days?: number }
        Returns: {
          forks: number
          source: string
          views: number
        }[]
      }
      get_invite_trip: {
        Args: { p_trip_id: string }
        Returns: {
          budget_per_person_inr: number
          campaign_id: string | null
          cover_emoji: string
          cover_image_url: string | null
          created_at: number
          creation_kind: string | null
          days: Json
          deleted_at: string | null
          destination_coords: Json | null
          destinations: Json
          drive_after_dinner_min: number | null
          driver_count: number | null
          drives_part: boolean | null
          end_date: string
          expenses: Json
          fixed_commitments: Json
          flights: Json | null
          fuel_economy_km_per_l: number | null
          fuel_price_per_l: number | null
          has_vulnerable: boolean | null
          id: string
          invite_code: string | null
          local_train: boolean | null
          name: string
          owner_id: string
          ref: string | null
          rent_per_day_inr: number | null
          round_trip: boolean | null
          source_pub_id: string | null
          start_date: string
          start_location: string
          start_location_coords: Json | null
          stay_style: string | null
          tank_l: number | null
          transport_mode: string
          travel_style: string
          travellers: number
          updated_at: number
          vehicle_profile: Json | null
          visibility: string
          write_version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_creator_post_visits: {
        Args: { p_days?: number }
        Returns: { post_id: string; visits: number }[]
      }
      get_creator_follower_count: {
        Args: { p_creator: string }
        Returns: number
      }
      valid_planning_notes: {
        Args: { p_notes: Json }
        Returns: boolean
      }
      get_public_profile_cards: {
        Args: { p_ids?: string[] }
        Returns: {
          featured_pub_id: string | null
          planning_notes: Json | null
          avatar_url: string | null
          creator_available: boolean
          creator_bio: string | null
          id: string
          is_creator: boolean
          name: string
          social_links: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "profile_cards"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_trip: {
        Args: { p_pub_id: string }
        Returns: {
          budget_per_person_inr: number
          campaign_id: string | null
          cover_emoji: string
          cover_image_url: string | null
          created_at: number
          creation_kind: string | null
          days: Json
          deleted_at: string | null
          destination_coords: Json | null
          destinations: Json
          drive_after_dinner_min: number | null
          driver_count: number | null
          drives_part: boolean | null
          end_date: string
          expenses: Json
          fixed_commitments: Json
          flights: Json | null
          fuel_economy_km_per_l: number | null
          fuel_price_per_l: number | null
          has_vulnerable: boolean | null
          id: string
          invite_code: string | null
          local_train: boolean | null
          name: string
          owner_id: string
          ref: string | null
          rent_per_day_inr: number | null
          round_trip: boolean | null
          source_pub_id: string | null
          start_date: string
          start_location: string
          start_location_coords: Json | null
          stay_style: string | null
          tank_l: number | null
          transport_mode: string
          travel_style: string
          travellers: number
          updated_at: number
          vehicle_profile: Json | null
          visibility: string
          write_version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_trashed_trips: {
        Args: never
        Returns: {
          budget_per_person_inr: number
          campaign_id: string | null
          cover_emoji: string
          cover_image_url: string | null
          created_at: number
          creation_kind: string | null
          days: Json
          deleted_at: string | null
          destination_coords: Json | null
          destinations: Json
          drive_after_dinner_min: number | null
          driver_count: number | null
          drives_part: boolean | null
          end_date: string
          expenses: Json
          fixed_commitments: Json
          flights: Json | null
          fuel_economy_km_per_l: number | null
          fuel_price_per_l: number | null
          has_vulnerable: boolean | null
          id: string
          invite_code: string | null
          local_train: boolean | null
          name: string
          owner_id: string
          ref: string | null
          rent_per_day_inr: number | null
          round_trip: boolean | null
          source_pub_id: string | null
          start_date: string
          start_location: string
          start_location_coords: Json | null
          stay_style: string | null
          tank_l: number | null
          transport_mode: string
          travel_style: string
          travellers: number
          updated_at: number
          vehicle_profile: Json | null
          visibility: string
          write_version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_trip_by_invite_code: {
        Args: { p_code: string }
        Returns: {
          budget_per_person_inr: number
          campaign_id: string | null
          cover_emoji: string
          cover_image_url: string | null
          created_at: number
          creation_kind: string | null
          days: Json
          deleted_at: string | null
          destination_coords: Json | null
          destinations: Json
          drive_after_dinner_min: number | null
          driver_count: number | null
          drives_part: boolean | null
          end_date: string
          expenses: Json
          fixed_commitments: Json
          flights: Json | null
          fuel_economy_km_per_l: number | null
          fuel_price_per_l: number | null
          has_vulnerable: boolean | null
          id: string
          invite_code: string | null
          local_train: boolean | null
          name: string
          owner_id: string
          ref: string | null
          rent_per_day_inr: number | null
          round_trip: boolean | null
          source_pub_id: string | null
          start_date: string
          start_location: string
          start_location_coords: Json | null
          stay_style: string | null
          tank_l: number | null
          transport_mode: string
          travel_style: string
          travellers: number
          updated_at: number
          vehicle_profile: Json | null
          visibility: string
          write_version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      grant_paid_order: {
        Args: { p_razorpay_order_id: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_disabled: { Args: never; Returns: boolean }
      is_editor: { Args: { trip: string }; Returns: boolean }
      is_member: { Args: { trip: string }; Returns: boolean }
      is_pilot_campaign: { Args: { p_id: string }; Returns: boolean }
      join_trip: { Args: { p_code: string }; Returns: string }
      owns_publication: {
        Args: { p_entitlement: string; p_pub_id: string }
        Returns: boolean
      }
      prune_create_funnel_events: {
        Args: { p_keep_days?: number }
        Returns: number
      }
      prune_pub_events: { Args: { p_keep_days?: number }; Returns: number }
      prune_trip_contribution_restore_events: { Args: never; Returns: number }
      purge_trashed_trip: { Args: { p_trip_id: string }; Returns: undefined }
      purge_trashed_trips: { Args: never; Returns: number }
      restore_trashed_trip: { Args: { p_trip_id: string }; Returns: undefined }
      restore_trip_contributions: { Args: { p_trip_id: string }; Returns: Json }
      revoke_refunded_entitlement: {
        Args: { p_razorpay_order_id: string }
        Returns: boolean
      }
      safe_social_links: { Args: { p_links: Json }; Returns: Json }
      submit_collab_command: {
        Args: { p_command: Json; p_command_id: string; p_trip_id: string }
        Returns: Json
      }
      trip_has_publication_money: { Args: { p_trip: string }; Returns: boolean }
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
