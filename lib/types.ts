export interface Post {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  category: string
  published: boolean
  created_at: string
  updated_at: string
}

// ============================================
// i18n Types
// ============================================

/** Supported language codes */
export type LanguageCode = 'de' | 'en' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'pl'

/** Language configuration */
export interface Language {
  code: LanguageCode
  name: string
  native_name: string | null
  is_active: boolean
  is_default: boolean
  llm_model: string | null
  backfill_from_date: string | null
  created_at: string
  updated_at: string
}

/** Translation status for content and queue items */
export type TranslationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped' | 'cancelled'

/** Content type for translation queue */
export type TranslationContentType = 'generated_post' | 'static_page' | 'ui'

/** Translated content (article or static page) */
export interface ContentTranslation {
  id: string
  generated_post_id: string | null
  static_page_id: string | null
  language_code: LanguageCode
  title: string | null
  slug: string | null
  excerpt: string | null
  content: Record<string, unknown> | null
  translation_status: TranslationStatus
  is_manually_edited: boolean
  error_log: string | null
  source_updated_at: string | null
  translated_at: string | null
  created_at: string
  updated_at: string
}

/** UI translation (navigation, labels, buttons) */
export interface UITranslation {
  id: string
  key: string
  language_code: LanguageCode
  value: string
  is_manually_edited: boolean
  created_at: string
  updated_at: string
}

/** Translation queue item */
export interface TranslationQueueItem {
  id: string
  content_type: TranslationContentType
  content_id: string | null
  ui_key: string | null
  target_language: LanguageCode
  priority: number
  status: TranslationStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

/** Subscriber language preferences (stored in subscribers.preferences) */
export interface SubscriberPreferences {
  language?: LanguageCode
  [key: string]: unknown
}

/** Preference token for newsletter language change */
export interface SubscriberPreferenceToken {
  id: string
  subscriber_id: string
  token: string
  expires_at: string
  used_at: string | null
  created_at: string
}
