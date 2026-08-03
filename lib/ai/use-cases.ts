/**
 * AI use-case definitions — labels, descriptions, default models.
 *
 * Pure data, no server-only imports. This is the single source of truth
 * for "which use cases exist and what's their default model" — both
 * `lib/ai/model-config.ts` (server-side model lookup) and the admin
 * settings UI (`app/admin/settings/page.tsx`, a client component) import
 * from here. Keep this file free of imports like `@/lib/supabase/admin`
 * so it stays safe to bundle into client code.
 */

export type UseCase =
  | 'ghostwriter'
  | 'article_planning'
  | 'proofreading'
  | 'synthesis_scoring'
  | 'podcast_script'
  | 'edit_analysis'
  | 'pattern_extraction'
  | 'queue_ranking'
  | 'image_generation'
  | 'ranking_extract'
  | 'ranking_attribution_qa'
  | 'ranking_validity_qa'
  | 'subscription_detect'
  | 'glossary_candidate_identification'
  | 'glossary_generation'
  | 'glossary_readability_qa'
  | 'glossary_news_context'
  | 'glossary_product_assignment'

export interface UseCaseInfo {
  label: string
  description: string
  defaultModel: string
  allowedProviders: Array<'anthropic' | 'openai' | 'google'>
}

export const USE_CASE_DEFINITIONS: Record<UseCase, UseCaseInfo> = {
  ghostwriter: {
    label: 'Ghostwriter',
    description: 'Blog-Artikel aus dem Digest generieren',
    defaultModel: 'claude-opus-4-8',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  article_planning: {
    label: 'Artikel-Planung',
    description: 'Struktur, Reihenfolge und Überschriften planen',
    defaultModel: 'gemini-2.5-flash',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  proofreading: {
    label: 'Rechtschreibprüfung',
    description: 'Deutsche Rechtschreib- und Grammatikkorrektur',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  synthesis_scoring: {
    label: 'Bewertung (Scoring)',
    description: 'Artikel nach Originalität und Relevanz bewerten',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_script: {
    label: 'Podcast-Skript',
    description: 'Podcast-Skripte aus Blog-Artikeln generieren',
    defaultModel: 'claude-sonnet-4-6',
    allowedProviders: ['anthropic'],
  },
  edit_analysis: {
    label: 'Edit-Analyse',
    description: 'Manuelle Edits klassifizieren und analysieren',
    defaultModel: 'claude-sonnet-4-6',
    allowedProviders: ['anthropic'],
  },
  pattern_extraction: {
    label: 'Pattern-Extraktion',
    description: 'Muster aus wiederkehrenden Edits extrahieren',
    defaultModel: 'claude-sonnet-4-6',
    allowedProviders: ['anthropic'],
  },
  queue_ranking: {
    label: 'Queue-Ranking',
    description: 'News-Queue-Artikel nach persönlichem Geschmack vorschlagen',
    defaultModel: 'claude-sonnet-4-6',
    allowedProviders: ['anthropic', 'google'],
  },
  image_generation: {
    label: 'Bildgenerierung',
    description: 'Article-Thumbnails und Cover-Bilder',
    defaultModel: 'google/gemini-3-pro-image',
    allowedProviders: ['openai', 'google'],
  },
  ranking_extract: {
    label: 'Rankings — Produkt-Extraktion',
    description: 'AI-Produkte aus News-Items extrahieren (hochvolumig)',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  ranking_attribution_qa: {
    label: 'Rankings — Attribution-QS',
    description: 'Company-Zuordnung von unknown/Fragment-Produkten verifizieren',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  ranking_validity_qa: {
    label: 'Rankings — Produkt-Validität-QS',
    description: 'Kontextbasiert prüfen, ob ein Chart-Produkt wirklich ein Produkt ist (nicht ein gleichnamiges Alltagswort)',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  subscription_detect: {
    label: 'Abo-Erkennung',
    description: 'Kostenpflichtige Newsletter-Abos aus Gmail-Mails klassifizieren',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  glossary_candidate_identification: {
    label: 'Glossar — Begriffs-Erkennung',
    description: 'Erklärungsbedürftige Fachbegriffe in einem Artikeltext finden',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  glossary_generation: {
    label: 'Glossar — Begriffs-Generierung',
    description: 'Lexikontext für einen Fachbegriff schreiben (15-Jähriger als Zielgruppe)',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  glossary_readability_qa: {
    label: 'Glossar — Verständlichkeits-QS',
    description: 'Generierten Lexikontext gegen die Verständlichkeitskriterien prüfen',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  glossary_news_context: {
    label: 'Glossar — News-Einordnung',
    description: 'Einordnungssatz für gematchte News-Titel im wöchentlichen Refresh schreiben (hochvolumig)',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  glossary_product_assignment: {
    label: 'Glossar — Produkt-Zuordnung',
    description: 'Chart-Produkte einem Fachbegriff zuordnen (Relevanz-Bewertung)',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
}
