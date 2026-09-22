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
  | 'enrich'
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
  | 'glossary_mention_context_qa'
  | 'glossary_product_assignment'
  | 'glossary_review'
  | 'glossary_translation'
  | 'ghostwriter_take'
  | 'wrapup'
  | 'comment_moderation'
  | 'search_rerank'
  | 'techmeme_relevance'
  | 'ranking_categorize'
  | 'ranking_enrich'
  | 'ranking_research'
  | 'ranking_distill'
  | 'podcast_modes'
  | 'podcast_show_notes'
  | 'podcast_intermezzo'
  | 'podcast_memory'
  | 'podcast_episode'
  | 'podcast_metadata_translation'

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
  enrich: {
    label: 'Enrich',
    description: 'Ausgewählte Artikel-Abschnitte nachrecherchieren, sprachlich verfeinern und den Synthszr Take schärfen',
    defaultModel: 'claude-sonnet-5',
    // Web-Recherche (Nachrecherche) laeuft nur mit dem nativen Anthropic
    // web_search-Tool (s. app/api/enrich/route.ts) — bei openai/google faellt
    // dieser Teil des Enrich-Passes weg, der Rest (Fluessigkeit, Take-Schaerfe)
    // funktioniert trotzdem, deshalb bleiben alle drei Provider waehlbar.
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
  glossary_mention_context_qa: {
    label: 'Glossar — Erwähnungs-Kontext-QS',
    description: 'Pro Fundstelle prüfen, ob ein Begriffsname wirklich das Lexikon-Konzept meint (nicht ein gleichnamiges Alltagswort, z.B. "Environment" in "Environmental") — hochvolumig, läuft bei jeder Verlinkung',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  glossary_product_assignment: {
    label: 'Glossar — Produkt-Zuordnung',
    description: 'Chart-Produkte einem Fachbegriff zuordnen (Relevanz-Bewertung)',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  glossary_review: {
    label: 'Glossar — Aktualitätsprüfung',
    description: 'Prüft anhand aktueller News, ob ein Lexikoneintrag noch stimmt, und schreibt bei Bedarf eine Revision',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  glossary_translation: {
    label: 'Glossar — Übersetzung',
    description: 'Lexikoneintrag (Name, Aliasse, Summary, Erklärungstext) in eine Zielsprache übersetzen',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  // Ab hier: Use Cases, die bis 2026-09-22 keinen eigenen Modell-Schalter hatten
  // — entweder fest verdrahtet (Konstante/Literal im Code) oder heimlich an
  // das Modell eines fachlich anderen Use Case gekoppelt (z.B. techmeme_relevance
  // an glossary_candidate_identification). defaultModel entspricht bewusst dem
  // bisherigen tatsaechlichen Verhalten — kein Modellwechsel, nur ein eigener
  // Schalter dafuer (Betreiber-Wunsch 2026-09-22: "granularer auf Basis der Jobs").
  ghostwriter_take: {
    label: 'Ghostwriter — Synthszr Take',
    description: 'Abschliessender Meinungsabsatz eines Artikels (bisher am Ghostwriter-Modell mitgehangen)',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  wrapup: {
    label: 'Wochenrückblick',
    description: 'Wochenrückblick-Artikel aus den Wochenthemen generieren',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  comment_moderation: {
    label: 'Kommentare — Moderation',
    description: 'Nutzer-Kommentare auf problematische Inhalte pruefen',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  search_rerank: {
    label: 'Suche — Neu-Sortierung',
    description: 'Suchergebnisse nach inhaltlicher Relevanz neu ordnen',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  techmeme_relevance: {
    label: 'Techmeme — Relevanz-Filter',
    description: 'Themen von der Techmeme-Startseite auf KI-/Tech-Relevanz pruefen',
    defaultModel: 'claude-sonnet-4-5-20250929',
    allowedProviders: ['anthropic'],
  },
  ranking_categorize: {
    label: 'Rankings — Kategorisierung',
    description: 'Chart-Produkte einer der 50 Produktkategorien zuordnen',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  ranking_enrich: {
    label: 'Rankings — Merkmal-Anreicherung',
    description: 'Sentiment und Vergleichsmerkmale aus Belegstellen eines Produkts extrahieren',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  ranking_research: {
    label: 'Rankings — Produkt-Recherche',
    description: 'Produktbeschreibung und Hintergrund fuer die Produktseite recherchieren',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  ranking_distill: {
    label: 'Rankings — Dimensionen-Destillation',
    description: 'Die 5-8 wichtigsten Vergleichsdimensionen einer Kategorie aus den Produktbelegen destillieren',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_modes: {
    label: 'Podcast — Intro/Outro-Modi',
    description: 'Woechentlich neue Einstiegs- und Schlussarten fuer den Podcast generieren',
    defaultModel: 'claude-opus-5',
    allowedProviders: ['anthropic'],
  },
  podcast_show_notes: {
    label: 'Podcast — Shownotes',
    description: 'Shownotes zu einer Podcast-Folge schreiben',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_intermezzo: {
    label: 'Podcast — Intermezzo',
    description: 'Reflektierendes Zwischenstueck der Podcast-Persona schreiben',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
  podcast_memory: {
    label: 'Podcast — Gedaechtnis-Extraktion',
    description: 'Erinnerungswuerdige Details aus einer Folge fuer kuenftige Episoden extrahieren',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_episode: {
    label: 'Podcast — Episoden-Text (Persona)',
    description: 'Persona-basiertes Skript mit Gedaechtnis- und Beziehungskontext generieren',
    defaultModel: 'claude-sonnet-4-20250514',
    allowedProviders: ['anthropic'],
  },
  podcast_metadata_translation: {
    label: 'Podcast — Metadaten-Übersetzung',
    description: 'Podcast-Titel und -Beschreibung in eine Zielsprache uebersetzen',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
}
