/** Kanonischer Host der Site (www, nie apex) — einzige Quelle für absolute URLs
 *  in Metadata, JSON-LD, Sitemap und Feeds. */
export const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.synthszr.com'

/** JSON für <script>-Einbettung: escapt '<' als <, damit '</script>' in Daten
 *  nie den Script-Kontext verlassen kann. */
export function safeJsonLd(x: unknown): string {
  return JSON.stringify(x).replace(/</g, '\\u003c')
}
