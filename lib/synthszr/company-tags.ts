/**
 * {Company}-Tags im Artikeltext → API-Namen bekannter Firmen (2026-10-19).
 * Bis dahin lebte die Funktion in app/admin/create-article/page.tsx und lief im
 * Browser, der nach der Generierung die Ratings vorwärmte. Seit der Artikel-Job
 * im Hintergrund fertig wird (Phase lexicon, Schritt „Assets“), braucht der
 * Server dieselbe Erkennung — eine Kopie in beiden Welten triftet auseinander.
 */
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

export interface CompanyTags {
  /** API-Namen für /api/stock-synthszr bzw. stock_synthszr_cache.company */
  public: string[]
  /** API-Namen für glitch.green (Premarket) */
  premarket: string[]
}

/** `{Firma}`-Muster im Klartext, case-insensitiv gegen die Anzeigenamen, jede Firma einmal. */
export function extractCompanyTags(content: string): CompanyTags {
  const publicCompanies: string[] = []
  const premarketCompanies: string[] = []
  const tagRegex = /\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(content)) !== null) {
    const companyName = match[1].trim().toLowerCase()
    let foundPublic = false
    for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
      if (displayName.toLowerCase() === companyName) {
        if (!publicCompanies.includes(apiName)) publicCompanies.push(apiName)
        foundPublic = true
        break
      }
    }
    if (foundPublic) continue
    for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
      if (displayName.toLowerCase() === companyName) {
        if (!premarketCompanies.includes(apiName)) premarketCompanies.push(apiName)
        break
      }
    }
  }
  return { public: publicCompanies, premarket: premarketCompanies }
}

interface TextNode { text?: string; content?: unknown[] }

/** Klartext eines TipTap-Dokuments — die Tag-Regex arbeitet auf Text, nicht auf JSON. */
export function collectTiptapText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as TextNode
  const self = n.text ?? ''
  const kids = Array.isArray(n.content) ? n.content.map((c) => collectTiptapText(c)).join(' ') : ''
  return `${self} ${kids}`
}
