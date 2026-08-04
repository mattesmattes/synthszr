/**
 * Strukturierte Daten der Lexikonseiten.
 *
 * Vorher stand nur ein DefinedTerm im Markup. An Prod gemessen (2026-08-04)
 * fehlten damit zwei Signale, die für Lexikonseiten besonders zählen:
 *
 *   - dateModified: Suchmaschinen UND Sprachmodelle bevorzugen datierte Inhalte.
 *     Ein Glossar ohne Aktualitätsangabe wirkt wie ein Altbestand.
 *   - BreadcrumbList: „Startseite → Lexikon → Begriff" ist eine echte Hierarchie
 *     und wird in den Suchergebnissen angezeigt.
 *
 * Als ARRAY, nicht als @graph: mehrere Top-Level-Blöcke sind für Google
 * gleichwertig, aber ein Array bleibt lesbar und lässt sich einzeln testen.
 */
import { SITE_URL } from '@/lib/seo/site'

interface GlossaryJsonLdInput {
  name: string
  summary: string
  slug: string
  lang: string
  /** Anzeigename des Begriffssets, z.B. „Synthszr Lexikon" / „Synthszr Glossary". */
  setName: string
  /** Beschriftung der Lexikon-Stufe im Breadcrumb, lokalisiert. */
  indexLabel: string
  /** ISO-Zeitstempel der letzten Änderung, oder null. */
  updatedAt: string | null
}

export function buildGlossaryJsonLd({
  name,
  summary,
  slug,
  lang,
  setName,
  indexLabel,
  updatedAt,
}: GlossaryJsonLdInput): Array<Record<string, unknown>> {
  const termUrl = `${SITE_URL}/${lang}/glossary/${slug}`
  const indexUrl = `${SITE_URL}/${lang}/glossary`

  const publisher = {
    '@type': 'Organization',
    name: 'Synthszr',
    url: SITE_URL,
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      '@context': 'https://schema.org',
      '@type': 'DefinedTerm',
      name,
      description: summary,
      url: termUrl,
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        name: setName,
        url: indexUrl,
      },
      publisher,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${lang}` },
        { '@type': 'ListItem', position: 2, name: indexLabel, item: indexUrl },
        // Das letzte Element bekommt bewusst KEIN item: es ist die aktuelle Seite,
        // und Google erwartet den Selbstverweis dort nicht.
        { '@type': 'ListItem', position: 3, name },
      ],
    },
  ]

  // WebPage nur MIT Datum. Ein Block ohne dateModified trägt kein Signal, und ein
  // leeres Feld wertet Google als Fehler in den strukturierten Daten.
  if (updatedAt) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: termUrl,
      name,
      dateModified: updatedAt,
      inLanguage: lang,
      publisher,
    })
  }

  return blocks
}
