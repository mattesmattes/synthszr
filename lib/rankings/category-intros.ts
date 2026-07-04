import introsRaw from './category-intros.json'

export interface CategoryIntro {
  /** Ein Satz für die Meta-Description (≤155 Zeichen). */
  summary: string
  /** 2 Absätze SEO-Fließtext für die Kategorie-Landingpage. */
  intro: string[]
}

// slug → locale → CategoryIntro (generiert via scripts/generate-category-intros.ts)
const intros = introsRaw as Record<string, Record<string, CategoryIntro>>

/** Intro-Text einer Kategorie in der gewünschten Sprache (Fallback: Deutsch,
 *  dann null wenn die Kategorie keinen Text hat). */
export function getCategoryIntro(slug: string, locale: string): CategoryIntro | null {
  const entry = intros[slug]
  if (!entry) return null
  return entry[locale] ?? entry.de ?? null
}

/** Alle Kategorie-Slugs mit gepflegtem Intro-Text — für die Sitemap
 *  (nur Kategorie-Seiten mit echtem Content aufnehmen, keine Thin Pages). */
export function categorySlugsWithIntro(): string[] {
  return Object.keys(intros)
}
