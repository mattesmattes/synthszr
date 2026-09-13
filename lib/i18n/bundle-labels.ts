import type { LanguageCode } from '@/lib/types'

/**
 * Aufschrift über einem gebündelten Abschnitt. „Deep Dive" kam 2026-08-13
 * hinzu (Betreiber-Wunsch): gleiche Mechanik und Länge wie „Thema des Tages",
 * nur eine andere Aufschrift, die im Editor umgestellt werden kann.
 *
 * „Cover Story" kam 2026-09-13 hinzu (Betreiber-Wunsch): gleiche Mechanik,
 * aber der Abschnitt darf doppelt so lang werden wie „Thema des Tages" — s.
 * BUNDLE_MAX_SENTENCES in ghostwriter-pipeline.ts. Der Synthszr Take bleibt
 * unverändert kurz (Bündel-Regel gilt für alle Typen gleich).
 */
export type BundleType = 'topic' | 'recap' | 'deep_dive' | 'cover_story'

/**
 * Visible label for a bundled article section ("Thema des Tages" / "Nachlese"),
 * shown above the section heading by both renderers (web + email). Covers the
 * PUBLIC_LOCALES set (lib/i18n/config.ts) — the locales with real, reachable
 * content. Falls back to English for anything else.
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
