import type { LanguageCode } from '@/lib/types'

/**
 * Aufschrift über einem gebündelten Abschnitt. „Deep Dive" kam 2026-08-13
 * hinzu (Betreiber-Wunsch): gleiche Mechanik und Länge wie „Thema des Tages",
 * nur eine andere Aufschrift, die im Editor umgestellt werden kann.
 *
 * „Cover Story" kam 2026-09-13 hinzu (Betreiber-Wunsch): gleiche Mechanik,
 * aber der Abschnitt darf doppelt so lang werden wie „Thema des Tages" — s.
 * BUNDLE_LENGTH_RULES in ghostwriter-pipeline.ts.
 *
 * „Long Read" kam 2026-11-23 hinzu (Betreiber-Wunsch): gleiche Mechanik wie
 * „Thema des Tages", aber mit einer Ziellänge und Obergrenze von 5.000 Zeichen
 * für die Zusammenfassung (s. BUNDLE_LENGTH_RULES / capSummaryChars). Der
 * Synthszr Take bleibt unverändert kurz (Bündel-Regel gilt für alle Typen gleich).
 */
export const BUNDLE_TYPES = ['cover_story', 'topic', 'deep_dive', 'long_read', 'recap'] as const
export type BundleType = (typeof BUNDLE_TYPES)[number]

export function isBundleType(value: unknown): value is BundleType {
  return typeof value === 'string' && (BUNDLE_TYPES as readonly string[]).includes(value)
}

/**
 * Visible label for a bundled article section ("Cover Story" / "Thema des Tages" /
 * "Deep Dive" / "Long Read" / "Nachlese"), shown above the section heading by both
 * renderers (web + email). Covers the PUBLIC_LOCALES set (lib/i18n/config.ts) —
 * the locales with real, reachable content. Falls back to English for anything else.
 */
const BUNDLE_LABELS: Record<BundleType, Partial<Record<LanguageCode, string>>> = {
  topic: {
    de: 'Thema des Tages',
    en: 'Topic of the Day',
    fr: 'Sujet du jour',
    cs: 'Téma dne',
    nds: "Thema vun'n Dag",
  },
  deep_dive: {
    // Als Anglizismus in allen Sprachen gebräuchlich und als Format-Aufschrift
    // wiedererkennbar — eine Übersetzung („Tiefenbohrung") träfe es nicht.
    de: 'Deep Dive',
    en: 'Deep Dive',
    fr: 'Deep Dive',
    cs: 'Deep Dive',
    nds: 'Deep Dive',
  },
  long_read: {
    // Wie „Deep Dive" und „Cover Story": als Format-Aufschrift international
    // gebräuchlich und wiedererkennbar.
    de: 'Long Read',
    en: 'Long Read',
    fr: 'Long Read',
    cs: 'Long Read',
    nds: 'Long Read',
  },
  recap: {
    de: 'Nachlese',
    en: 'Recap',
    fr: 'Résumé',
    cs: 'Shrnutí',
    nds: 'Torüchblick',
  },
  cover_story: {
    // Wie „Deep Dive": als Format-Aufschrift international gebräuchlich,
    // eine Übersetzung („Titelgeschichte") wäre hier ungewohnt.
    de: 'Cover Story',
    en: 'Cover Story',
    fr: 'Cover Story',
    cs: 'Cover Story',
    nds: 'Cover Story',
  },
}

export function bundleLabel(type: BundleType, locale: string): string {
  return BUNDLE_LABELS[type][locale as LanguageCode] ?? BUNDLE_LABELS[type].en!
}
