/**
 * Ersetzt gerade Zoll-Zeichen durch die typografischen Anführungszeichen der
 * jeweiligen Sprache.
 *
 * Die Modelle liefern durchgängig `"…"` — im Deutschen sind das Zollzeichen und
 * schlicht falsch. Richtig ist „…" (99-66, unten öffnend), im Englischen “…”,
 * im Französischen «…» mit schmalen geschützten Leerzeichen.
 *
 * BEIM RENDERN statt im Datenbestand: greift damit sofort für alle 220
 * bestehenden Artikel und für jeden künftigen Text, ohne Migration und ohne dass
 * ein Modell-Prompt es zuverlässig einhalten muss. Der Rohtext bleibt
 * unverändert — das ist auch der Grund, warum hier nichts "korrigiert" wird, was
 * schon typografisch ist.
 *
 * NUR PAARWEISE: ein einzelnes `"` ohne Partner bleibt stehen. Ein Zoll- oder
 * Sekundenzeichen (`24"`) wird sonst zum öffnenden Anführungszeichen, und in
 * Code-Beispielen wäre die Ersetzung schlicht falsch.
 */

export type QuoteLang = 'de' | 'en' | 'fr' | 'cs' | 'nds'

interface QuotePair {
  open: string
  close: string
  singleOpen: string
  singleClose: string
}

/** Deutsch und Niederdeutsch: „…" (99-66). Tschechisch verwendet dieselbe Form.
 *  Französisch: «…» mit schmalem geschütztem Leerzeichen (U+202F) innen. */
const PAIRS: Record<QuoteLang, QuotePair> = {
  de: { open: '„', close: '“', singleOpen: '‚', singleClose: '‘' },
  nds: { open: '„', close: '“', singleOpen: '‚', singleClose: '‘' },
  cs: { open: '„', close: '“', singleOpen: '‚', singleClose: '‘' },
  en: { open: '“', close: '”', singleOpen: '‘', singleClose: '’' },
  fr: { open: '« ', close: ' »', singleOpen: '‹ ', singleClose: ' ›' },
}

function pairFor(lang: string): QuotePair {
  return PAIRS[(lang as QuoteLang)] ?? PAIRS.de
}

/**
 * Setzt typografische Anführungszeichen in einem Textstück.
 *
 * Arbeitet paarweise über einen einfachen Zustand: das erste `"` öffnet, das
 * nächste schließt. Bleibt am Ende eines Textes ein offenes Zeichen übrig, wird
 * es zurückgenommen — ein unpaariges `"` ist eher ein Zollzeichen als ein
 * Zitatbeginn.
 */
export function typographicQuotes(text: string, lang: string): string {
  if (!text.includes('"') && !text.includes("'")) return text
  const p = pairFor(lang)

  let out = ''
  let openIndex = -1
  let insideDouble = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (insideDouble) {
        out += p.close
        insideDouble = false
        openIndex = -1
      } else {
        openIndex = out.length
        out += p.open
        insideDouble = true
      }
      continue
    }
    out += ch
  }

  // Unpaarig geöffnet? Zurücknehmen — vermutlich ein Zoll- oder Zollzeichen.
  if (insideDouble && openIndex >= 0) {
    out = out.slice(0, openIndex) + '"' + out.slice(openIndex + p.open.length)
  }

  // Apostroph: nur der typografische ist richtig, und er ist nie paarig.
  // Zwischen Buchstaben (don't, Nvidia's) immer ’ — außerhalb unangetastet,
  // damit ein einfaches Zitat ('so') nicht zerstört wird.
  out = out.replace(/(\p{L})'(\p{L})/gu, `$1’$2`)

  return out
}

/**
 * Wendet typographicQuotes auf alle Textknoten eines TipTap-Dokuments an.
 *
 * AUF DEM JSON, NICHT AUF DEM HTML: im gerenderten Markup stehen
 * Anführungszeichen in Attributen (`href="…"`, `class="…"`). Eine Ersetzung dort
 * würde das HTML zerstören. Textknoten sind die einzige Stelle, an der ein `"`
 * zuverlässig Inhalt ist.
 */
export function applyTypographicQuotes(content: unknown, lang: string): unknown {
  if (!content || typeof content !== 'object') return content
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const o = node as Record<string, unknown>
    const next: Record<string, unknown> = { ...o }
    if (typeof o.text === 'string') next.text = typographicQuotes(o.text, lang)
    if (Array.isArray(o.content)) next.content = o.content.map(walk)
    return next
  }
  return walk(content)
}
