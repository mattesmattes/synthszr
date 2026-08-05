import { matchNameInText } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const MARK_TYPE = 'glossaryLink'

type Node = Record<string, unknown>

/** walk() liefert bei einem Split ein Array statt eines einzelnen Knotens —
 *  hier auf eine flache Liste normiert, egal welche der beiden Formen kam. */
function asArray(x: unknown): Node[] {
  return Array.isArray(x) ? (x as Node[]) : [x as Node]
}

function hasMark(node: Node, type: string): boolean {
  return Array.isArray(node.marks) &&
    node.marks.some((m) => (m as { type?: string }).type === type)
}

/** Entfernt alle glossaryLink-Marks — Grundlage der Idempotenz. */
function stripMarks(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const o = { ...(node as Node) }
  if (Array.isArray(o.marks)) {
    const kept = o.marks.filter((m) => (m as { type?: string }).type !== MARK_TYPE)
    if (kept.length > 0) o.marks = kept
    else delete o.marks
  }
  if (Array.isArray(o.content)) o.content = o.content.map(stripMarks)
  return o
}

/**
 * Schreibt glossaryLink-Marks für die bestätigten Slugs in das TipTap-JSON.
 *
 * Idempotent: bestehende Marks werden zuerst entfernt und neu gesetzt. Damit
 * ist mehrfaches Speichern unschädlich, und nach einer Übersetzung genügt ein
 * erneuter Lauf mit der übersetzten Begriffsliste — die Marks müssen nicht
 * durch die Übersetzung getragen werden.
 *
 * Pro Begriff wird nur die erste Erwähnung verlinkt, insgesamt maximal
 * beliebig viele Begriffe. Text, der schon eine `link`-Mark trägt
 * (Quellenlink) oder bereits Company-/Produkt-verlinkt ist, wird übersprungen.
 */
export function injectGlossaryMarks(
  content: unknown,
  slugs: string[],
  terms: GlossaryMatcherTerm[],
  opts: { reserved?: string[] } = {},
): unknown {
  const cleaned = stripMarks(content)
  // `reserved` sind Company- und Chart-Produktnamen. Die Kollisionsregel kann
  // NICHT über eine bestehende Mark geprüft werden: die Produkt- und
  // Company-Verlinkung läuft client-seitig im DOM, im gespeicherten JSON
  // existiert dafür keine Mark. Also wird die Namensliste übergeben. Gefiltert
  // wird unten pro Name, nicht hier pro Begriff — ein Begriff bleibt über
  // seinen unproblematischen kanonischen Namen verlinkbar, auch wenn einer
  // seiner Aliasse reserviert ist.
  const reserved = new Set((opts.reserved ?? []).map((n) => n.toLowerCase()))
  // KEINE OBERGRENZE (Betreiber-Entscheidung 2026-08-05): jeder erkannte Begriff
  // wird verlinkt.
  //
  // Zur Geschichte, weil hier zwei Fehler übereinander lagen: ursprünglich stand
  // .slice(0, GLOSSARY_MAX_PER_ARTICLE) an dieser Stelle — der Deckel griff also
  // auf die AUSWAHL statt auf das Ergebnis. Solange `slugs` die bestätigten
  // Kandidaten EINES Artikels waren, fiel das nicht auf; der
  // Nachverlinkungs-Lauf übergibt aber den ganzen Bestand, und dann schnitt der
  // Deckel die ersten acht Begriffe in DB-Reihenfolge heraus. Bei 101 Begriffen
  // war keiner davon im Artikel: null Marks, ohne Fehler und ohne Log. Der
  // Zwischenfix zählte die gesetzten Marks; jetzt ist der Deckel ganz raus.
  //
  // GLOSSARY_MAX_PER_ARTICLE bleibt in lib/glossary/detail.ts in Gebrauch — dort
  // begrenzt es die Länge der Sidebar-Liste und hat einen anderen Zweck.
  const wanted = terms.filter((t) => slugs.includes(t.slug))
  if (wanted.length === 0) return cleaned

  // MEHRDEUTIGE ALIASSE ausschliessen (Prod-Befund 2026-08-05): "Benchmarking"
  // steht als Alias bei "Evaluation" UND bei "Benchmark". Verlinkt wurde, wer in
  // der DB-Reihenfolge zufaellig vorne stand — im Artikel fuehrte "Benchmarking"
  // auf /glossary/evaluation. Bei Mehrdeutigkeit ist kein Link besser als der
  // falsche; der KANONISCHE Name bleibt unberuehrt, er ist eindeutig zugeordnet.
  const aliasOwners = new Map<string, number>()
  for (const t of wanted) {
    for (const a of t.aliases) {
      const key = a.toLowerCase()
      aliasOwners.set(key, (aliasOwners.get(key) ?? 0) + 1)
    }
  }
  const ambiguous = new Set([...aliasOwners.entries()].filter(([, n]) => n > 1).map(([k]) => k))

  const done = new Set<string>()

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const o = node as Node

    // UEBERSCHRIFTEN UEBERSPRINGEN, samt Teilbaum. Zwei Gruende, der zweite ist
    // der wichtigere: ein Link in der Ueberschrift stoert die Typografie, UND weil
    // jeder Begriff nur EINMAL verlinkt wird, war er danach fuer den Fliesstext
    // verbraucht — die Erwaehnung im Text, wo der Leser sie braucht, blieb ohne
    // Link. `done` bleibt hier unberuehrt, der Begriff ist also weiterhin frei.
    if ((o as { type?: string }).type === 'heading') return o

    if (typeof o.text === 'string') {
      // Quellenlinks gewinnen — in einen bestehenden <a> darf kein zweiter
      // Link geschachtelt werden.
      if (hasMark(o, 'link')) return o

      for (const term of wanted) {
        if (done.has(term.slug)) continue
        // Reservierte Namen fallen einzeln raus, nicht der ganze Begriff —
        // ein Alias-Kollision mit einer Company/einem Produkt darf den
        // kanonischen Namen desselben Begriffs nicht mitblockieren.
        const names = [term.canonicalName, ...term.aliases]
          .filter((n) => !reserved.has(n.toLowerCase()))
          // Mehrdeutige Aliasse fallen einzeln raus, der kanonische Name bleibt.
          .filter((n) => n === term.canonicalName || !ambiguous.has(n.toLowerCase()))
          .sort((a, b) => b.length - a.length)
        if (names.length === 0) continue
        for (const name of names) {
          const pos = matchNameInText(o.text as string, name)
          if (!pos) continue
          done.add(term.slug)
          const before = (o.text as string).slice(0, pos.start)
          const hit = (o.text as string).slice(pos.start, pos.end)
          const after = (o.text as string).slice(pos.end)
          const baseMarks = Array.isArray(o.marks) ? o.marks : []
          const parts: Node[] = []
          // Beide Seiten rekursiv weiterwalken, nicht nur `after`: die
          // Term-Schleife läuft in Array-Reihenfolge (Reihenfolge aus der
          // DB), nicht in Textreihenfolge. Ein anderer bestätigter Begriff
          // kann vor dem aktuellen Treffer im Text stehen und würde sonst
          // unbemerkt im `before`-Teil verschwinden. `walk()` kann bei einem
          // Split ein Array zurückgeben — asArray()+spread hält `parts` in
          // jedem Fall flach (gleiche Technik wie beim `after`-Fix).
          if (before) parts.push(...asArray(walk({ ...o, text: before })))
          parts.push({
            ...o,
            text: hit,
            marks: [...baseMarks, { type: MARK_TYPE, attrs: { slug: term.slug } }],
          })
          if (after) parts.push(...asArray(walk({ ...o, text: after })))
          return parts
        }
      }
      return o
    }

    if (Array.isArray(o.content)) {
      // flat(), weil ein Textknoten zu mehreren Knoten aufgeteilt werden kann.
      return { ...o, content: o.content.map(walk).flat() }
    }
    return o
  }

  return walk(cleaned)
}
