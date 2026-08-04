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
 * Passt das Sprachsegment eines intern gespeicherten Pfads an die gerenderte
 * Sprache an.
 *
 * `glossary_term_news.source_url` speichert `/de/posts/<slug>` (news.ts,
 * DEFAULT_LOCALE). Sprachneutral speichern ist keine Option: middleware.ts
 * antwortet auf `/posts/<slug>` je Cookie/Geo mit 307 — auf einer englischen
 * Seite würde der Leser dann unvermittelt auf der deutschen Fassung landen.
 * Externe URLs (http…) bleiben unangetastet, damit Altbestand nicht bricht.
 */
function localizePath(url: string, lang: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return url.replace(/^\/[a-z]{2,3}(?=\/)/, `/${lang}`)
}

/**
 * Aktuelle Berichterstattung zu diesem Begriff — EIGENE Artikel, per
 * match_generated_posts auf das Begriffs-Embedding gematcht (2026-08-04; vorher
 * externe daily_repo-Quellen).
 *
 * Deshalb interne Links ohne target=_blank: ein Lexikonbegriff soll in die
 * eigene Berichterstattung führen und den Leser im Angebot halten. Der
 * Einordnungssatz bleibt eigener Text statt Fremdzitat (Design-Spec §F).
 *
 * Rendert null bei leerer Liste.
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
        {news.map((item, i) => {
          const href = localizePath(item.sourceUrl, lang)
          const isExternal = /^https?:\/\//i.test(href)
          return (
            <li key={i} className="text-sm">
              <a
                href={href}
                {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
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
          )
        })}
      </ul>
    </section>
  )
}
