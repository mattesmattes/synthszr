import Link from 'next/link'
import type { CompanyMentionRef } from '@/lib/companies/recent-posts'

/**
 * Die Unternehmen, die in diesem Artikel vorkommen — unter dem Artikel, über der
 * Newsletter-Box.
 *
 * BEIDE TYPEN, nicht nur die börsennotierten: für premarket-Firmen existiert
 * dieselbe öffentliche Seite unter /[lang]/companies/[slug], die Daten liegen
 * also nicht ungenutzt herum. Der Typ steuert nur das Label.
 *
 * Textlinks statt Pills — dieselbe Entscheidung wie bei den verwandten Begriffen
 * im Lexikon: Firmennamen sind unterschiedlich lang, Pills brechen dabei
 * unruhig, und eine Kapsel suggeriert einen Filter, den es hier nicht gibt.
 *
 * Rendert null bei leerer Liste.
 */
export function PostCompanies({
  companies,
  lang,
  heading,
  premarketLabel,
}: {
  companies: CompanyMentionRef[]
  lang: string
  heading: string
  premarketLabel: string
}) {
  if (companies.length === 0) return null

  return (
    <section className="mt-10 border-t border-border pt-6">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {companies.map((company) => (
          <li key={company.slug} className="text-sm">
            <Link
              href={`/${lang}/companies/${company.slug}`}
              className="text-foreground/80 hover:text-foreground hover:underline"
            >
              {company.name}
            </Link>
            {company.type === 'premarket' && (
              <span className="ml-1.5 font-mono text-[10px] uppercase text-muted-foreground">
                {premarketLabel}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
