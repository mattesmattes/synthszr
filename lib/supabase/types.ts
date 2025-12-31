// Supabase Database Types for Newsletter Aggregator

export interface NewsletterSource {
  id: string
  email: string
  name: string | null
  enabled: boolean
  created_at: string
}

export interface DailyRepoItem {
  id: string
  source_type: 'newsletter' | 'article' | 'pdf'
  source_email: string | null
  source_url: string | null
  title: string | null
  content: string | null
  raw_html: string | null
  source_language: string
  collected_at: string
  newsletter_date: string
  processed: boolean
  newsletter_source_id: string | null
}

export interface PaywallCredential {
  id: string
  domain: string
  username: string
  password_encrypted: string
  cookie_data: Record<string, unknown> | null
  notes: string | null
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface AnalysisPrompt {
  id: string
  name: string
  prompt_text: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DailyDigest {
  id: string
  digest_date: string
  prompt_id: string | null
  analysis_content: string
  sources_used: string[]
  word_count: number | null
  created_at: string
}

export interface Setting {
  key: string
  value: unknown
  updated_at: string
}

export interface GmailToken {
  id: string
  access_token: string | null
  refresh_token: string
  token_expiry: string | null
  email: string | null
  created_at: string
  updated_at: string
}

// Insert types (without auto-generated fields)
export type NewsletterSourceInsert = Omit<NewsletterSource, 'id' | 'created_at'>
export type DailyRepoItemInsert = Omit<DailyRepoItem, 'id' | 'collected_at'>
export type PaywallCredentialInsert = Omit<PaywallCredential, 'id' | 'created_at' | 'updated_at' | 'last_used_at'>
export type AnalysisPromptInsert = Omit<AnalysisPrompt, 'id' | 'created_at' | 'updated_at'>
export type DailyDigestInsert = Omit<DailyDigest, 'id' | 'created_at'>

// Database schema type for Supabase client
export interface Database {
  public: {
    Tables: {
      newsletter_sources: {
        Row: NewsletterSource
        Insert: NewsletterSourceInsert
        Update: Partial<NewsletterSourceInsert>
      }
      daily_repo: {
        Row: DailyRepoItem
        Insert: DailyRepoItemInsert
        Update: Partial<DailyRepoItemInsert>
      }
      paywall_credentials: {
        Row: PaywallCredential
        Insert: PaywallCredentialInsert
        Update: Partial<PaywallCredentialInsert>
      }
      analysis_prompts: {
        Row: AnalysisPrompt
        Insert: AnalysisPromptInsert
        Update: Partial<AnalysisPromptInsert>
      }
      daily_digests: {
        Row: DailyDigest
        Insert: DailyDigestInsert
        Update: Partial<DailyDigestInsert>
      }
      settings: {
        Row: Setting
        Insert: Setting
        Update: Partial<Setting>
      }
      gmail_tokens: {
        Row: GmailToken
        Insert: Omit<GmailToken, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<GmailToken, 'id' | 'created_at'>>
      }
    }
    Views: {
      todays_unprocessed: {
        Row: DailyRepoItem
      }
      active_sources: {
        Row: NewsletterSource
      }
    }
  }
}
