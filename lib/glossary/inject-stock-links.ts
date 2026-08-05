/**
 * Verlinkt Firmennamen im Lexikon-Erklärtext auf ihre Stocks-Seite
 * (/[lang]/stocks/[ticker]).
 *
 * WARUM SERVERSEITIG: in Artikeln laufen Company- und Produktverlinkung
 * client-seitig über DOM-Prozessoren (s. Kommentar in inject-marks.ts) — im
 * gespeicherten TipTap-JSON existiert dafür keine Mark. Die Lexikonseite rendert
 * ihren Text aber über renderStaticArticleHtml, ohne Client-Renderer: dort käme
 * ein DOM-Prozessor nie zum Zug. Deshalb wird die Mark hier ins JSON injiziert,
 * bevor gerendert wird.
 *
 * NUR BÖRSENNOTIERTE FIRMEN: verlinkt wird ausschließlich, was einen Ticker in
 * COMPANY_TICKERS hat — für alles andere existiert die Zielseite nicht (sie
 * antwortet mit notFound()). Ein Link ins Leere ist schlechter als keiner.
 *
 * Reihenfolge im Loader: NACH injectGlossaryMarks. Beide überspringen Text, der
 * schon eine Mark trägt, aber die Kollisionsregel des Projekts lautet
 * Company > Chart-Produkt > Lexikonbegriff — und injectGlossaryMarks setzt
 * Company-Namen ohnehin auf seine reserved-Liste, verlinkt sie also nie als
 * Begriff. Die beiden Injektionen können sich damit nicht überschreiben.
 */
import { KNOWN_COMPANIES } from '@/lib/data/companies'
import { COMPANY_TICKERS } from '@/lib/data/company-tickers'
import { EXCLUDED_COMPANY_NAMES } from '@/lib/data/company-exclusions'
import { matchWholeWordInText } from '@/lib/glossary/mentions'

/** Höchstens so viele Firmen pro Erklärtext verlinken. Ein Lexikoneintrag soll
 *  einen Begriff erklären, nicht zur Linkliste werden — dieselbe Erwägung wie
 *  GLOSSARY_MAX_PER_ARTICLE bei den Begriffen. */
const MAX_STOCK_LINKS = 6

interface LinkableCompany {
  /** Anzeigename, wie er im Text vorkommt (z.B. "Nvidia"). */
  name: string
  /** Kleingeschriebener Schlüssel aus KNOWN_COMPANIES (z.B. "nvidia"). */
  key: string
  ticker: string
}

/**
 * Börsennotierte Firmen, absteigend nach Namenslänge.
 *
 * Die Länge entscheidet: „Alphabet" muss vor „Alpha" geprüft werden, sonst
 * verlinkt der kürzere Name die Hälfte des längeren und der Rest bleibt als
 * Textfragment stehen.
 */
function linkableCompanies(): LinkableCompany[] {
  const out: LinkableCompany[] = []
  for (const [name, key] of Object.entries(KNOWN_COMPANIES)) {
    // Ausschlussliste respektieren: dort stehen Allerweltswörter, die zufällig
    // wie Firmennamen aussehen ("Insider", "Experte") — verlinkte man sie,
    // entstünden Links auf willkürlichen Wörtern.
    if (EXCLUDED_COMPANY_NAMES.has(name)) continue
    const entry = COMPANY_TICKERS[key]
    if (!entry) continue // nicht börsennotiert → keine Zielseite
    out.push({ name, key, ticker: entry.symbol })
  }
  return out.sort((a, b) => b.name.length - a.name.length)
}

/** Trägt dieser Textknoten schon eine Mark, die einen Link bedeutet? */
function hasLinkMark(node: { marks?: Array<{ type?: string }> }): boolean {
  return (node.marks ?? []).some((m) => m.type === 'link' || m.type === 'glossaryLink')
}

/**
 * Setzt link-Marks auf Firmennamen im Dokument.
 *
 * Verwendet die normale `link`-Mark statt einer eigenen: sie ist in allen
 * Renderpfaden schon registriert (Editor, statisches HTML, E-Mail), eine neue
 * Mark hätte in jedem davon nachgezogen werden müssen — genau die Vervielfachung,
 * die beim glossaryLink vier Stellen gekostet hat.
 *
 * Jede Firma wird höchstens EINMAL verlinkt (erste Fundstelle). Ein Begriff, der
 * „Nvidia" fünfmal nennt, bekommt sonst fünf identische Links.
 */
export function injectStockLinks(content: unknown, lang: string): unknown {
  if (!content || typeof content !== 'object') return content
  const companies = linkableCompanies()
  if (companies.length === 0) return content

  const linked = new Set<string>()

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const n = node as Record<string, unknown>

    if (Array.isArray(n.content)) {
      return { ...n, content: n.content.flatMap((child) => {
        const result = walk(child)
        return Array.isArray(result) ? result : [result]
      }) }
    }

    if (typeof n.text !== 'string' || hasLinkMark(n as { marks?: Array<{ type?: string }> })) return n
    if (linked.size >= MAX_STOCK_LINKS) return n

    const text = n.text
    for (const company of companies) {
      if (linked.has(company.key)) continue
      // matchWholeWordInText, NICHT matchNameInText: Firmennamen duerfen nicht
      // in Komposita treffen. "Intel" in "Intelligenz" war genau dieser Fehler.
      const hit = matchWholeWordInText(text, company.name)
      if (!hit) continue
      linked.add(company.key)

      const before = text.slice(0, hit.start)
      const after = text.slice(hit.end)
      const marks = Array.isArray(n.marks) ? n.marks : []
      const linkNode = {
        ...n,
        text: hit.matched,
        marks: [...marks, {
          type: 'link',
          attrs: { href: `/${lang}/stocks/${company.ticker.toLowerCase()}`, target: null },
        }],
      }
      // Der Rest hinter dem Treffer wird weiter durchsucht (rekursiv), der Teil
      // davor ebenfalls — sonst bliebe eine zweite Firma im selben Textknoten
      // unverlinkt, je nachdem auf welcher Seite sie steht. Truthy-Checks halten
      // leere Textknoten aus dem Ergebnis (ungültiges TipTap-JSON).
      const parts: unknown[] = []
      if (before) parts.push(...[walk({ ...n, text: before })].flat())
      parts.push(linkNode)
      if (after) parts.push(...[walk({ ...n, text: after })].flat())
      return parts
    }
    return n
  }

  const result = walk(content)
  return Array.isArray(result) ? { ...(content as object), content: result } : result
}
