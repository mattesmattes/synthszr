import { LOCALE_STRINGS } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'

export interface TermNewsItem {
  title: string
  sourceName: string | null
  sourceUrl: string
  publishedAt: string | null
  contextSentence: string | null
}

function fmtDate(d: string | null, lang: string): string {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString(LOCALE_STRINGS[lang as LanguageCode] ?? 'de-DE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

/**
 * Arrondierender Block: externe News, die per RPC (match_glossary_news) auf
 * diesen Begriff gematcht wurden — Titel, Quelle, Datum, Link, plus ein
 * eigener Einordnungssatz statt Fremd-Volltextzitat (urheberrechtlich
 * sauber, s. Design-Spec §F). Links sind extern (target=_blank). Rendert
 * null bei leerer Liste — der News-Cron befüllt glossary_term_news erst in
 * Task 15.
 */
export function TermNews({
  news,
  lang,
  heading,
}: {
  news: TermNewsItem[]
  lang: string
  heading: string
}) {
  if (news.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 mb-2">{heading}</h2>
      <ul className="space-y-3">
        {news.map((item, i) => (
          <li key={i} className="text-sm">
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-gray-700 hover:text-black hover:underline"
            >
              {item.title}
            </a>
            <div className="text-xs text-gray-400 mt-0.5">
              {[item.sourceName, fmtDate(item.publishedAt, lang)].filter(Boolean).join(' · ')}
            </div>
            {item.contextSentence && (
              <p className="text-xs text-gray-500 mt-1">{item.contextSentence}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
