import { createAnonClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'
import { DEFAULT_LOCALE } from './config'

/**
 * Default German translations (fallback)
 * These are used when:
 * 1. The locale is 'de' (no DB lookup needed)
 * 2. A translation is missing for another locale
 */
export const defaultTranslations: Record<string, string> = {
  // Meta
  'meta.description': 'Synthszr ist die tägliche News-Synthese zu KI: Business, Design und Technologie — mit Newsletter, AI-Produkt-Charts und Company-Analysen.',

  // Navigation
  'nav.home': 'Home',
  'nav.archive': 'Archiv',
  'nav.why': 'Warum Synthszr',

  // Footer
  'footer.imprint': 'Impressum',
  'footer.privacy': 'Datenschutz',
  'footer.newsletter': 'Newsletter',

  // Home page
  'home.tagline': 'Die News Synthese zum Start in den Tag.',
  'home.last_7_days': 'Letzte 7 Tage',
  'home.all_articles': 'Alle Artikel',
  'home.no_posts': 'Noch keine Artikel veröffentlicht.',

  // Why page
  'why.title': 'Feed the Soul. Run the System. | Synthszr',
  'why.description': 'Die News Synthese zum Start in den Tag.',
  'why.default_content': 'Die News Synthese zum Start in den Tag.',

  // Privacy page
  'privacy.title': 'Datenschutz | Synthszr',
  'privacy.description': 'Datenschutzerklärung und Informationen zur Datenverarbeitung',
  'privacy.heading': 'Datenschutzerklärung',

  // Imprint page
  'imprint.title': 'Impressum | Synthszr',
  'imprint.description': 'Impressum und rechtliche Informationen',
  'imprint.heading': 'Impressum',

  // Newsletter signup
  'newsletter.title': 'Stay Updated',
  'newsletter.description': 'Die morgendliche Tagessynthese per Mail.',
  'newsletter.email_placeholder': 'E-Mail Adresse',
  'newsletter.submit': 'Anmelden',
  'newsletter.success': 'Fast geschafft! Bitte bestätige deine E-Mail.',
  'newsletter.error': 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.',

  // Newsletter confirmation
  'newsletter.confirm.title': 'E-Mail bestätigt',
  'newsletter.confirm.success': 'Deine E-Mail wurde erfolgreich bestätigt.',
  'newsletter.confirm.error': 'Der Bestätigungslink ist ungültig oder abgelaufen.',

  // Newsletter unsubscribe
  'newsletter.unsubscribe.title': 'Abgemeldet',
  'newsletter.unsubscribe.success': 'Du wurdest erfolgreich abgemeldet.',
  'newsletter.unsubscribe.error': 'Ein Fehler ist aufgetreten.',

  // Newsletter preferences
  'newsletter.preferences.title': 'Newsletter-Einstellungen',
  'newsletter.preferences.language': 'Sprache',
  'newsletter.preferences.save': 'Speichern',
  'newsletter.preferences.saved': 'Einstellungen gespeichert',

  // Posts
  'posts.read_more': 'Weiterlesen',
  'posts.category': 'Kategorie',
  'posts.published': 'Veröffentlicht',
  'posts.synthszr_vote': 'Synthszr Vote',

  // Archive
  'archive.title': 'Archiv',
  'archive.description': 'Alle Artikel chronologisch sortiert',
  'archive.count': 'Alle {count} Artikel chronologisch sortiert',
  'archive.empty': 'Noch keine Artikel vorhanden.',
  'archive.back_home': 'Zurück zu Synthszr',

  // Companies
  'companies.title': 'Unternehmen',
  'companies.description': '{count} Unternehmen in unseren Artikeln erwähnt. Klicke auf den Badge für die AI-Analyse.',
  'companies.empty': 'Noch keine Unternehmen gefunden. Publiziere Artikel mit Unternehmens-Erwähnungen.',
  'companies.back': 'Zurück',
  'companies.back_home': 'Zurück zu Synthszr',
  'companies.all_companies': 'Alle Unternehmen',
  'companies.back_to_companies': 'Zurück zu Unternehmen',
  'companies.articles_count_singular': '{count} Artikel erwähnt {company}',
  'companies.articles_count_plural': '{count} Artikel erwähnen {company}',
  'companies.premarket_label': 'Pre-IPO Unternehmen',
  'companies.article': 'Artikel',
  'companies.articles': 'Artikel',
  'companies.analyse': 'Analyse',
  'companies.premarket': 'Premarket',
  'companies.detailed_analysis': 'Ausführliche Analyse hier →',

  // Rankings / Charts
  'rankings.subtitle': 'Welche AI-Produkte gerade <b>rocken</b> — täglich aus tausenden News ausgewertet.',
  'rankings.all': 'Alle',
  'rankings.footer': 'Score = Momentum (Erwähnungen, recency-gewichtet, Halbwertszeit 14 Tage). Sparkline = Verlauf 90 Tage. Nur Produkte mit ≥2 Erwähnungen. Pinne Produkte (📌) für den Vergleich.',
  'rankings.empty': 'Noch keine Produkte mit genügend Erwähnungen.',
  'rankings.breadcrumb_all': 'Alle Rankings',
  'rankings.rank_in': 'in',
  'rankings.momentum': 'Momentum',
  'rankings.momentum_history': 'Momentum-Verlauf',
  'rankings.features': 'Features',
  'rankings.evidence': 'Belege',
  'rankings.no_evidence': 'Keine Belege.',
  'rankings.other_source': 'Sonstige',
  'rankings.to_original': 'Zum Original-Artikel',
  'rankings.days': 'Tage',
  'rankings.footer_product': 'Score = Momentum (recency-gewichtete Erwähnungen). Specs/Beschreibung aus News-Belegen.',
  'rankings.pin': 'Zum Vergleich pinnen',
  'rankings.unpin': 'Aus Vergleich entfernen',
  'rankings.pinned': 'gepinnt',
  'rankings.compare': 'Vergleichen',
  'rankings.compare_title': 'Produktvergleich',
  'rankings.compare_products': 'Produkte',
  'rankings.compare_feature': 'Feature',
  'rankings.compare_vendor': 'Hersteller',
  'rankings.compare_release': 'Release',
  'rankings.compare_empty': 'Keine Produkte gepinnt. Pinne Produkte über das Pin-Symbol im Ranking.',
  // Kategorie-Namen
  'rankings.cat.language-models': 'Sprachmodelle',
  'rankings.cat.coding-tools': 'Coding-Tools',
  'rankings.cat.image-generation': 'Bildgeneratoren',
  'rankings.cat.video-generation': 'Videogeneratoren',
  'rankings.cat.audio-voice': 'Audio & Stimme',
  'rankings.cat.agents-platforms': 'Agenten & Plattformen',
  'rankings.cat.search-research': 'Suche & Research',
  'rankings.cat.other': 'Sonstige',
  'rankings.meta.title': 'Synthszr Charts — das tägliche AI-Produkt-Ranking',
  'rankings.meta.description': 'Tägliches Momentum-Ranking der AI-Produkte, automatisch aus tausenden News- und Newsletter-Quellen ausgewertet — versions-granular und nach Kategorien.',
  'rankings.h1': 'Synthszr Charts — das tägliche AI-Produkt-Ranking',
  'rankings.intro': 'Die Synthszr Charts ranken AI-Produkte nach Momentum: Erwähnungen aus tausenden News- und Newsletter-Quellen, recency-gewichtet (Halbwertszeit 14 Tage), versions-granular und täglich aktualisiert.',
  'rankings.related': 'Weitere Produkte in dieser Kategorie',
  'rankings.show_all': 'Alle anzeigen',
  'rankings.company_products': 'Produkte in den Synthszr Charts',
  'rankings.since': 'seit',
  'rankings.last_seen': 'zuletzt',
  'post.mentioned_products': 'Im Artikel erwähnte Chart-Produkte',

  // Common
  'common.loading': 'Laden...',
  'common.error': 'Ein Fehler ist aufgetreten.',
  'common.back': 'Zurück',
  'common.home': 'Startseite',
  'common.back_home': 'Zurück zur Startseite',
}

/**
 * Loads UI translations for a given locale
 * Returns default German translations merged with DB translations
 */
export async function getTranslations(locale: LanguageCode): Promise<Record<string, string>> {
  // For default locale, return German translations directly
  if (locale === DEFAULT_LOCALE) {
    return defaultTranslations
  }

  try {
    const supabase = createAnonClient()

    const { data, error } = await supabase
      .from('ui_translations')
      .select('key, value')
      .eq('language_code', locale)

    if (error) {
      console.error('Error loading translations:', error)
      return defaultTranslations
    }

    // Merge: DB translations override defaults
    const translations = { ...defaultTranslations }
    data?.forEach(row => {
      translations[row.key] = row.value
    })

    return translations
  } catch (error) {
    console.error('Error loading translations:', error)
    return defaultTranslations
  }
}

/**
 * Get a single translation (server-side)
 */
export async function t(locale: LanguageCode, key: string, fallback?: string): Promise<string> {
  const translations = await getTranslations(locale)
  return translations[key] ?? fallback ?? key
}
