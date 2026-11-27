export type SupportedLang = 'de' | 'en'
export type LanguageMode = 'auto' | SupportedLang
export type HighlightStyle = 'underline' | 'subtle-bg'

export interface ExtensionGlossaryTerm {
  s: string
  n: string
  a?: string[]
  d: string
  amb?: 1
}

export interface StoredGlossaryCache {
  version: string
  lang: SupportedLang
  count: number
  generatedAt: string
  fetchedAt: number
  items: ExtensionGlossaryTerm[]
}

export interface TermDetailRelated {
  slug: string
  canonicalName: string
}

export interface TermDetailResponse {
  slug: string
  lang: SupportedLang
  canonicalName: string
  aliases: string[]
  summary: string
  paragraphs: string[]
  relatedTerms: TermDetailRelated[]
  products: TermDetailRelated[]
  url: string
  updatedAt: string | null
}

export interface ExtensionSettings {
  enabled: boolean
  languageMode: LanguageMode
  highlightStyle: HighlightStyle
  excludedDomains: string[]
}

export const DEFAULT_EXCLUDED_DOMAINS: string[] = [
  'synthszr.com',
  'www.synthszr.com',
  'synthszr.vercel.app',
  'localhost',
  '127.0.0.1',
  'mail.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'notion.so',
  'figma.com',
  'miro.com',
]

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  languageMode: 'auto',
  highlightStyle: 'underline',
  excludedDomains: [...DEFAULT_EXCLUDED_DOMAINS],
}

export const STORAGE_KEYS = {
  SETTINGS: 'synthszr_settings_v1',
  INDEX_DE: 'synthszr_index_de_v1',
  INDEX_EN: 'synthszr_index_en_v1',
  LAST_SYNC_ERROR: 'synthszr_last_sync_error_v1',
} as const

export type BackgroundRequest =
  | { type: 'GET_GLOSSARY_INDEX'; lang: SupportedLang }
  | { type: 'SYNC_NOW'; lang?: SupportedLang }
  | { type: 'GET_TERM_DETAIL'; slug: string; lang: SupportedLang }
  | { type: 'GET_STATUS' }
  | { type: 'OPEN_URL'; url: string }

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface ExtensionStatus {
  de: { count: number; version: string; fetchedAt: number } | null
  en: { count: number; version: string; fetchedAt: number } | null
  lastError: string | null
}
