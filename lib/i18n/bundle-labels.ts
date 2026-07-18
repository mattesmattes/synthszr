import type { LanguageCode } from '@/lib/types'

export type BundleType = 'topic' | 'recap'

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
  recap: {
    de: 'Nachlese',
    en: 'Recap',
    fr: 'Résumé',
    cs: 'Shrnutí',
    nds: 'Torüchblick',
  },
}

export function bundleLabel(type: BundleType, locale: string): string {
  return BUNDLE_LABELS[type][locale as LanguageCode] ?? BUNDLE_LABELS[type].en!
}
