import Link from 'next/link'

export interface RelatedTermItem {
  slug: string
  canonicalName: string
}

/**
 * Arrondierender Block: Begriffe, die der Erklärungstext dieser Seite selbst
 * erwähnt (siehe linkRelatedTerms in lib/glossary/detail.ts — dieselbe
 * Kandidatenmenge, die dort auch die Marks im Text setzt). Kleinere Typo,
 * gedämpfte Farben, keine Konkurrenz zum Haupttext. Rendert null bei leerer
 * Liste — heute der Normalfall bei einem frisch angelegten Begriff.
 */
export function RelatedTerms({
  terms,
  lang,
  heading,
}: {
  terms: RelatedTermItem[]
  lang: string
  heading: string
}) {
  if (terms.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 mb-2">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term.slug}>
            <Link
              href={`/${lang}/glossary/${term.slug}`}
              className="inline-block rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors hover:border-black hover:text-black"
            >
              {term.canonicalName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
