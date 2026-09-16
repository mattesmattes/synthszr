import { matchNameInText } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'
import { waehrungFuerSlug } from '@/lib/currency/currencies'
import { betragVorFundstelle, betragFuerUrl } from '@/lib/currency/amounts'
import { filterMentionsByContext, type MentionContextCandidate } from '@/lib/glossary/mention-context-qa'
import { createAdminClient } from '@/lib/supabase/admin'

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
 * Findet, ohne zu verändern, die ERSTE unverlinkte Fundstelle je Begriff —
 * dieselbe Logik (Heading-Skip, Link-Skip, reservierte/mehrdeutige Namen,
 * Namens-Prioritaet) wie die anwendende Walk-Funktion unten, aber rein lesend.
 * Liefert pro gefundenem Begriff den vollen Text seines Knotens als Kontext
 * fuer die Erwaehnungs-QS (s. mention-context-qa.ts).
 */
function collectCandidateExcerpts(
  node: unknown,
  wanted: GlossaryMatcherTerm[],
  reserved: Set<string>,
  ambiguous: Set<string>,
  lang: string,
  done: Set<string>,
  out: Map<string, string>,
): void {
  if (!node || typeof node !== 'object') return
  const o = node as Node
  if ((o as { type?: string }).type === 'heading') return

  if (typeof o.text === 'string') {
    if (hasMark(o, 'link')) return
    for (const term of wanted) {
      if (done.has(term.slug)) continue
      const names = [term.canonicalName, ...term.aliases]
        .filter((n) => !reserved.has(n.toLowerCase()))
        .filter((n) => n === term.canonicalName || !ambiguous.has(n.toLowerCase()))
        .sort((a, b) => b.length - a.length)
      for (const name of names) {
        const pos = matchNameInText(o.text as string, name, lang)
        if (!pos) continue
        done.add(term.slug)
        out.set(term.slug, o.text as string)
        break
      }
    }
    return
  }

  if (Array.isArray(o.content)) {
    for (const child of o.content) collectCandidateExcerpts(child, wanted, reserved, ambiguous, lang, done, out)
  }
}

/**
 * Fragt für die übergebenen Slugs die Kurzbeschreibung ab — NUR für die, die
 * tatsächlich als Kandidat im Artikel gefunden wurden (typischerweise wenige
 * Dutzend), nicht für den gesamten Begriffsbestand. GlossaryMatcherTerm trägt
 * bewusst kein summary-Feld (schmale, gecachte Begriffsliste, s. types.ts) —
 * dieser gezielte Zusatz-Read bleibt deshalb hier lokal statt die geteilte
 * Liste aufzublähen.
 */
async function fetchSummaries(slugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (slugs.length === 0) return out
  try {
    const { data, error } = await createAdminClient()
      .from('glossary_terms')
      .select('slug, summary')
      .in('slug', slugs)
    if (error) {
      console.error('[Glossary] fetchSummaries:', error.message)
      return out
    }
    for (const row of (data ?? []) as Array<{ slug: string; summary: string | null }>) {
      if (row.summary) out.set(row.slug, row.summary)
    }
  } catch (err) {
    console.error('[Glossary] fetchSummaries failed:', err)
  }
  return out
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
 *
 * ERWÄHNUNGS-KONTEXT-QS (Betreiber-Vorgabe 2026-09-14, opt-in seit 2026-09-16):
 * Manche Begriffsnamen sind zugleich Allgemeinwörter ("Environment" = Alias
 * von "Trainingsumgebung", kollidiert zufällig mit dem Firmennamen
 * "Environmental Protection Network"). Eine kuratierte Ausnahmeliste wäre
 * hier falsch — der Begriff ist im richtigen Kontext ein legitimer Treffer,
 * nur diese eine Erwähnung nicht. Mit `opts.checkContext: true` wird JEDE
 * gefundene Fundstelle einzeln per LLM gegen die Begriffs-Definition geprüft
 * (mention-context-qa.ts), BEVOR die Marks geschrieben werden.
 *
 * PROD-BEFUND 2026-09-16, 200-400€/Tag: Default war zunächst AN für alle
 * Aufrufer. `linkPostContent` (backfill.ts) läuft aber über den taeglichen
 * `relink`-Job endlos im Ein-Minuten-Cron-Takt durch den GESAMTEN
 * Artikelbestand (Cursor setzt sich am Ende zurück, s. relinkNextBatch in
 * crawl.ts) — laut eigenem Kommentar dort AUSDRÜCKLICH "kein Kostenrisiko:
 * macht keine Modell-Aufrufe". Ohne Opt-in bekam jede bereits korrekt
 * verlinkte Fundstelle bei JEDEM Zyklus erneut einen LLM-Aufruf, unbegrenzt
 * oft am Tag. Jetzt Standard AUS; nur der Freigabe-Pfad (confirm.ts, eine
 * bewusste Operator-Aktion je Artikel) schaltet es ein.
 */
export async function injectGlossaryMarks(
  content: unknown,
  slugs: string[],
  terms: GlossaryMatcherTerm[],
  // `lang` steuert die Kompositum-Regel: nur im Deutschen darf ein Begriff im
  // Wortinneren treffen (s. matchNameInText). Default 'de', weil die Artikel
  // im Original deutsch sind — die Uebersetzungspfade reichen ihre Zielsprache
  // durch.
  opts: { reserved?: string[]; lang?: string; checkContext?: boolean } = {},
): Promise<unknown> {
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

  // PHASE 1+2: nur mit ausdruecklichem Opt-in (s. Funktions-Kommentar oben —
  // sonst zahlt jeder Aufrufer, auch endlos laufende Cron-Batches, fuer LLM-
  // Aufrufe, die er nie angefordert hat).
  let rejected: Set<string> = new Set()
  if (opts.checkContext) {
    // PHASE 1: Fundstellen sammeln, ohne zu schreiben.
    const excerptBySlug = new Map<string, string>()
    collectCandidateExcerpts(cleaned, wanted, reserved, ambiguous, opts.lang ?? 'de', new Set(), excerptBySlug)

    // PHASE 2: Kontext-QS — nur für Slugs mit einer Fundstelle UND einer
    // Kurzbeschreibung. Fehlt die Beschreibung (Zusatz-Read fehlgeschlagen) oder
    // gab es gar keine Fundstelle, bleibt der Begriff unangetastet und verhält
    // sich wie vor diesem Umbau (fail-open, s. Modul-Kommentar).
    const summaries = excerptBySlug.size > 0 ? await fetchSummaries([...excerptBySlug.keys()]) : new Map<string, string>()
    const candidates: MentionContextCandidate[] = []
    const termBySlug = new Map(wanted.map((t) => [t.slug, t]))
    for (const [slug, excerpt] of excerptBySlug) {
      const summary = summaries.get(slug)
      const term = termBySlug.get(slug)
      if (!summary || !term) continue
      candidates.push({ slug, name: term.canonicalName, summary, excerpt })
    }
    if (candidates.length > 0) {
      const approved = await filterMentionsByContext(candidates)
      rejected = new Set(candidates.map((c) => c.slug).filter((s) => !approved.has(s)))
    }
  }
  const linkable = rejected.size === 0 ? wanted : wanted.filter((t) => !rejected.has(t.slug))
  if (linkable.length === 0) return cleaned

  // PHASE 3: wie zuvor, nur mit den kontext-geprüften Begriffen.
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

      for (const term of linkable) {
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
          const pos = matchNameInText(o.text as string, name, opts.lang ?? 'de')
          if (!pos) continue
          done.add(term.slug)

          // WÄHRUNGEN NEHMEN IHREN BETRAG MIT (Betreiber-Wunsch 2026-08-15).
          // Steht vor der Währung eine Zahl, beginnt die Verlinkung bei der
          // Zahl statt beim Wort: aus „Yuan" wird „123 Millionen Yuan". Der
          // Betrag wandert zusätzlich als Attribut in die Mark und von dort in
          // den href — der Umrechner im Lexikon hat ihn dann schon stehen.
          //
          // Die Erweiterung greift NUR nach vorn. Nach hinten wäre sie falsch:
          // dort steht die Fortsetzung des Satzes, nicht der Betrag.
          let markStart = pos.start
          let betrag: number | null = null
          if (waehrungFuerSlug(term.slug)) {
            const fund = betragVorFundstelle(o.text as string, pos.start)
            if (fund) {
              markStart = fund.start
              betrag = fund.betrag
            }
          }

          const before = (o.text as string).slice(0, markStart)
          const hit = (o.text as string).slice(markStart, pos.end)
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
            marks: [...baseMarks, {
              type: MARK_TYPE,
              attrs: betrag === null
                ? { slug: term.slug }
                : { slug: term.slug, betrag: betragFuerUrl(betrag) },
            }],
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
