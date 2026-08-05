/**
 * Ersetzt gerade Zoll-Zeichen durch die typografischen Anführungszeichen der
 * jeweiligen Sprache.
 *
 * Die Modelle liefern durchgängig `"…"` — im Deutschen sind das Zollzeichen und
 * schlicht falsch. Richtig ist „…“ (99-66, unten öffnend), im Englischen “…”,
 * im Französischen «…» mit schmalen geschützten Leerzeichen.
 *
 * BEIM RENDERN statt im Datenbestand: greift damit sofort für alle 220
 * bestehenden Artikel und für jeden künftigen Text, ohne Migration und ohne dass
 * ein Modell-Prompt es zuverlässig einhalten muss. Der Rohtext bleibt
 * unverändert.
 *
 * NUR PAARWEISE: ein einzelnes `"` ohne Partner bleibt stehen. Ein Zoll- oder
 * Sekundenzeichen (`24"`) wird sonst zum öffnenden Anführungszeichen, und in
 * Code-Beispielen wäre die Ersetzung schlicht falsch.
 *
 * ÜBER KNOTENGRENZEN UND MIT NORMALISIERUNG (2026-08-05): beides folgt aus zwei
 * Fehlern, die auf /de/glossary/transformer zu sehen waren — `Titel "Attention
 * Is All You Need„` und `Das “T"`.
 *
 *   1. Der Zustandsautomat lief pro Textknoten, ein Zitat läuft aber über
 *      Knotengrenzen: die Mark-Injektion der Lexikon-Verlinkung teilt einen
 *      Absatz auf, sobald sie einen Begriff im Zitat verlinkt. Öffnendes und
 *      schließendes Zeichen liegen dann in verschiedenen Knoten, und „ist
 *      offen" begann in jedem neu. Die Paare werden deshalb jetzt über den
 *      ganzen BLOCK bestimmt (Absatz, Überschrift, Listenpunkt …), nicht je
 *      Textknoten.
 *   2. Die Modelle liefern schon gemischte Zeichen (`"`, `“`, `„`). Ersetzt
 *      wurden nur die geraden — dadurch entstand die Mischung überhaupt erst.
 *      Vor der Paarbildung wird deshalb auf `"` normalisiert. Das macht die
 *      Ersetzung idempotent: bereits typografischer Text kommt unverändert
 *      heraus, gemischter wird geradegezogen.
 */

export type QuoteLang = 'de' | 'en' | 'fr' | 'cs' | 'nds'

interface QuotePair {
  open: string
  close: string
  singleOpen: string
  singleClose: string
}

/** Deutsch und Niederdeutsch: „…“ (99-66). Tschechisch verwendet dieselbe Form.
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

/** Zeichen, bei denen überhaupt etwas zu tun ist — sonst früher Ausstieg. */
const RELEVANT = /["„“”‟«»']/

/**
 * Zieht alle Zitatzeichen auf das gerade `"` zurück, damit die Paarbildung eine
 * einheitliche Ausgangslage hat.
 *
 * Bei den Guillemets wird das INNERE Leerzeichen mitgenommen (schmal, geschützt
 * oder normal), sonst verdoppelt es sich beim Neusetzen: aus « Bonjour » würde
 * sonst «  Bonjour  ». Das Leerzeichen VOR einem öffnenden « bleibt dagegen
 * stehen, es gehört zum vorangehenden Wort.
 *
 * Einfache Anführungszeichen bleiben unangetastet: `’` ist in der Regel ein
 * Apostroph (don’t, Nvidia’s), kein Zitatende.
 */
function normalizeQuoteChars(text: string): string {
  return text
    .replace(/«[   ]?/g, '"')
    .replace(/[   ]?»/g, '"')
    .replace(/[„“”‟]/g, '"')
}

/**
 * Setzt die Anführungszeichen für eine FOLGE von Textstücken, die zusammen einen
 * Block bilden.
 *
 * Der Zustand läuft über alle Stücke hinweg, die Ersetzungen werden danach auf
 * die Stücke zurückverteilt. Bewusst nicht über Zeichen-Offsets: `« ` ist
 * zwei Zeichen für eines, die Positionen verschieben sich also. Stattdessen wird
 * für das n-te Vorkommen von `"` im Block entschieden, was es wird — das ist
 * unabhängig von der Länge des Ersatzes.
 *
 * Bleibt am Ende ein Zeichen offen, wird es zurückgenommen: ein unpaariges `"`
 * ist eher ein Zollzeichen als ein Zitatbeginn.
 */
function distributeQuotes(texts: string[], lang: string): string[] {
  if (!texts.some((t) => RELEVANT.test(t))) return texts

  const p = pairFor(lang)
  const normalized = texts.map(normalizeQuoteChars)

  // Erst entscheiden: was wird aus dem 1., 2., 3. … Vorkommen im ganzen Block?
  const replacements: string[] = []
  let insideDouble = false
  let lastOpen = -1
  for (const t of normalized) {
    for (const ch of t) {
      if (ch !== '"') continue
      if (insideDouble) {
        replacements.push(p.close)
        insideDouble = false
        lastOpen = -1
      } else {
        lastOpen = replacements.length
        replacements.push(p.open)
        insideDouble = true
      }
    }
  }
  if (insideDouble && lastOpen >= 0) replacements[lastOpen] = '"'

  // Dann zurückverteilen, in derselben Reihenfolge.
  let n = 0
  return normalized.map((t) => {
    let out = ''
    for (const ch of t) out += ch === '"' ? replacements[n++] : ch
    // Apostroph: nur der typografische ist richtig, und er ist nie paarig.
    // Zwischen Buchstaben (don't, Nvidia's) immer ’ — außerhalb unangetastet,
    // damit ein einfaches Zitat ('so') nicht zerstört wird.
    return out.replace(/(\p{L})'(\p{L})/gu, '$1’$2')
  })
}

/**
 * Setzt typografische Anführungszeichen in einem einzelnen Textstück.
 *
 * Läuft über dieselbe Implementierung wie die Blockvariante, damit beide Wege
 * nicht auseinanderlaufen können — ein einzelner Text ist ein Block aus einem
 * Stück.
 */
export function typographicQuotes(text: string, lang: string): string {
  return distributeQuotes([text], lang)[0]
}

/**
 * Wendet die Ersetzung auf ein TipTap-Dokument an, blockweise.
 *
 * AUF DEM JSON, NICHT AUF DEM HTML: im gerenderten Markup stehen
 * Anführungszeichen in Attributen (`href="…"`, `class="…"`). Eine Ersetzung dort
 * würde das HTML zerstören. Textknoten sind die einzige Stelle, an der ein `"`
 * zuverlässig Inhalt ist.
 *
 * Die Einheit ist jeder Knoten mit direkten Textkindern — bei TipTap also
 * Absatz, Überschrift, Listenpunkt, Tabellenzelle. Genau auf dieser Ebene
 * zerlegt die Mark-Injektion einen Text in mehrere Knoten, und genau deshalb
 * muss der Zustand hier laufen und nicht tiefer. Absätze bleiben getrennt: ein
 * offenes Zeichen zieht kein Zitat über den nächsten Absatz.
 */
export function applyTypographicQuotes(content: unknown, lang: string): unknown {
  if (!content || typeof content !== 'object') return content

  const isTextNode = (n: unknown): boolean =>
    !!n && typeof n === 'object' && typeof (n as Record<string, unknown>).text === 'string'

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const o = node as Record<string, unknown>
    const next: Record<string, unknown> = { ...o }
    if (!Array.isArray(o.content)) return next

    const kids = o.content
    const textIdx: number[] = []
    kids.forEach((k, i) => {
      if (isTextNode(k)) textIdx.push(i)
    })

    if (textIdx.length === 0) {
      next.content = kids.map(walk)
      return next
    }

    const replaced = distributeQuotes(
      textIdx.map((i) => (kids[i] as Record<string, unknown>).text as string),
      lang
    )
    // Nicht-Textkinder (hardBreak, verschachtelte Blöcke) laufen weiter durch
    // die Rekursion; die Textkinder bekommen ihr Ergebnis aus dem Block.
    const newKids = kids.map((k) => (isTextNode(k) ? k : walk(k)))
    textIdx.forEach((idx, n) => {
      newKids[idx] = { ...(kids[idx] as Record<string, unknown>), text: replaced[n] }
    })
    next.content = newKids
    return next
  }

  return walk(content)
}
