import { createClient } from '@/lib/supabase/server'
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
  'meta.description': 'Die Schnittstelle von Business, Design und Technologie im Zeitalter der KI.',

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
    const supabase = await createClient()

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
