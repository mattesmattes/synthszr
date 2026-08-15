/**
 * Welche `{lex:}`-Tags im fertigen Artikel bleiben.
 *
 * BETREIBER-BEFUND 2026-08-15 an einem echten Post: 24 Tags, obwohl der Prompt
 * höchstens fünf erlaubt — darunter ein kaputter (`{lex:"}`, ein
 * Anführungszeichen als „Begriff") und viel Wirtschaftsvokabular
 * (Go-to-Market, Underwriting, Restricted Stock Units).
 *
 * Gefehlt hat ausgerechnet „SAO", der Name eines RL-Verfahrens — genau die
 * Sorte Begriff, für die das Lexikon da ist. Das ist kein Zufall: Wenn die
 * Obergrenze nicht greift, markiert das Modell BREIT statt gezielt und trifft
 * dabei die naheliegenden Wörter statt der erklärungsbedürftigen.
 *
 * DESHALB WIRD PRIORISIERT, NICHT NUR GEKAPPT. Eine Kappung auf die ersten fünf
 * hätte hier die falschen behalten und SAO trotzdem verworfen.
 */

/** Wie viele Tags ein Artikel höchstens trägt — dieselbe Zahl wie im Prompt. */
export const MAX_LEX_TAGS = 5

/**
 * Wörter, die im Artikel vorkommen, aber nicht ins KI-Lexikon gehören.
 *
 * Bewusst kurz und auf das beschränkt, was tatsächlich auftrat: Eine lange
 * Liste erzeugt mehr Fehlurteile, als sie verhindert — und die eigentliche
 * Filterung leistet ohnehin der Kandidaten-Filter beim Anlegen des Begriffs
 * (lib/glossary/candidate-filter.ts). Hier geht es nur um die RANGFOLGE, wenn
 * mehr Tags gesetzt sind als erlaubt.
 */
const BUSINESS_VOCAB = [
  'go-to-market', 'underwriting', 'restricted stock units', 'shadowban',
  'onboarding', 'due diligence', 'burn rate', 'runway', 'cap table',
  'churn', 'compliance', 'roadmap', 'stakeholder',
]

/**
 * Wie gut taugt ein Begriff fürs Lexikon?
 *
 * Höher ist besser. Die Signale kommen aus dem, was einen Fachterminus im
 * Fließtext ausmacht — nicht aus einer Themenliste, die bei jedem neuen
 * Verfahren nachgepflegt werden müsste:
 *
 * - GROSSBUCHSTABEN („SAO", „RLHF"): eine Abkürzung, die niemand kennt, ist der
 *   Musterfall für einen Lexikoneintrag.
 * - BinnenGroßschreibung („IndexShare"): Eigennamen von Verfahren, Frameworks
 *   und Modellen.
 * - Bindestrich-Komposita mit Fachanteil („Post-Training").
 *
 * Wirtschaftsvokabular wird abgestuft, nicht verworfen: Steht sonst nichts zur
 * Wahl, ist ein erklärter Begriff besser als keiner.
 */
export function lexTagScore(name: string): number {
  const n = name.trim()
  if (!n) return 0
  let score = 1

  if (BUSINESS_VOCAB.includes(n.toLowerCase())) score -= 3

  // Reine Abkürzung: mindestens zwei Großbuchstaben, keine Kleinbuchstaben.
  if (/^[A-Z][A-Z0-9-]{1,7}$/.test(n)) score += 4

  // BinnenGroßschreibung — „IndexShare", „PyTorch", „LoRA".
  else if (/^[A-Z][a-z0-9]*[A-Z]/.test(n)) score += 3

  // Fachliches Kompositum mit Bindestrich („Post-Training", „Fine-Tuning").
  if (/-/.test(n) && !BUSINESS_VOCAB.includes(n.toLowerCase())) score += 1

  // Sehr lange Mehrwortbegriffe sind selten Lexikonstoff, meist Beschreibungen.
  if (n.split(/\s+/).length >= 3) score -= 1

  return score
}

/** Sieht der Inhalt eines Tags überhaupt nach einem Begriff aus? */
function isPlausible(name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || n.length > 60) return false
  // Muss einen Buchstaben enthalten — „{lex:"}" und „{lex:,}" fallen hier raus.
  if (!/\p{L}/u.test(n)) return false
  // Anführungszeichen und Klammern zeigen an, dass der Tag den Text zerschnitten
  // hat statt einen Begriff zu fassen.
  if (/["»«(){}[\]]/.test(n)) return false
  return true
}

/**
 * Kaputte Tags entfernen und auf {@link MAX_LEX_TAGS} begrenzen.
 *
 * Was wegfällt, verliert nur seine Markierung — der Text bleibt stehen. Ein
 * entfernter Tag heißt also nicht, dass ein Wort verschwindet.
 */
export function sanitizeLexTags(markdown: string, max = MAX_LEX_TAGS): string {
  const re = /\{lex:([^}]*)\}/g
  const treffer = [...markdown.matchAll(re)]
  if (treffer.length === 0) return markdown

  const gueltig = treffer.filter((m) => isPlausible(m[1]))

  // Die Besten bestimmen — bei Gleichstand entscheidet die Reihenfolge im Text,
  // damit das Ergebnis stabil bleibt und nicht bei jedem Lauf anders ausfällt.
  const behalten = new Set(
    gueltig
      .map((m, i) => ({ name: m[1], i, score: lexTagScore(m[1]) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, max)
      .map((x) => x.i),
  )

  let index = -1
  let gueltigIndex = -1
  return markdown.replace(re, (ganz, name: string) => {
    index++
    if (!isPlausible(name)) return name.trim()
    gueltigIndex++
    return behalten.has(gueltigIndex) ? ganz : name
  })
}
