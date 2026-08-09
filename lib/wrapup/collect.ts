/**
 * Sammelt die Themen der Woche für den Wrap-up.
 *
 * QUELLE SIND DIE FERTIGEN ARTIKEL-ABSCHNITTE, nicht die Roh-Items der
 * news_queue (Betreiber-Entscheidung 2026-08-09). Sie sind redigiert,
 * freigegeben und tragen die Original-Headline.
 *
 * DER BERICHT WIRD 1:1 ÜBERNOMMEN, nicht neu formuliert (Korrektur vom selben
 * Tag). Der Grund sind die Marks: Quellenlinks stecken ausschließlich in den
 * `link`-Marks der Original-Knoten, ihre URLs wären nach einer Neuformulierung
 * unwiederbringlich. Lexikon-Verlinkungen ließen sich zwar neu injizieren, die
 * Quellen nicht — und beide gehören zum Erscheinungsbild eines Newsartikels.
 *
 * Neu geschrieben wird deshalb nur, was es im Original nicht gibt: der Vorlauf
 * der Woche, die gekürzten Takes und dort, wo es sie gibt, ein Bezugs-Absatz.
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WrapupTopic {
  /** "Montag" … "Sonnabend" */
  weekday: string
  /** "YYYY-MM-DD" in Berliner Zeit */
  date: string
  headline: string
  /** Volltext des Berichts — nur als KONTEXT für das Modell, nicht für die
   *  Ausgabe. Der Bericht selbst wird über `bodyNodes` übernommen. */
  body: string
  /** Der Original-Take als Text. Kontext für die gekürzte Neufassung. */
  takeText: string
  /** Der Heading-Knoten des Originals, samt queueItemId und bundleType. */
  headingNode: Record<string, unknown> | null
  /** Die Bericht-Absätze als ROHE TipTap-Knoten — mit allen Marks.
   *
   *  DAS IST DER KERN DER KORREKTUR vom 2026-08-09: Quellenlinks stecken
   *  ausschließlich in den `link`-Marks dieser Knoten. Würde das Modell den
   *  Bericht neu formulieren, wären ihre URLs unwiederbringlich weg — die
   *  Lexikon-Verlinkung ließe sich neu injizieren, die Quellen nicht. */
  bodyNodes: Record<string, unknown>[]
  postSlug: string
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Sonnabend']

function textOf(node: unknown): string {
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (!n) return ''
  if (n.type === 'text') return n.text ?? ''
  return (n.content ?? []).map(textOf).join('')
}

/**
 * Wählt aus einem Artikel-Content den Abschnitt für den Wrap-up.
 *
 * Reihenfolge: `bundleType === 'topic'`, sonst der ERSTE Abschnitt. Der Fallback
 * ist kein Randfall — an Prod hatte Dienstag der 04.08.2026 keinen
 * topic-Abschnitt, in der ersten geprüften Woche überhaupt.
 *
 * Der Abschnitt endet an der nächsten Überschrift. Ohne diese Grenze zöge der
 * Wrap-up den halben Artikel mit und das Modell bekäme Material, das gar nicht
 * zum Thema des Tages gehört.
 */
export function pickTopicFromPost(content: unknown): {
  headline: string
  body: string
  takeText: string
  headingNode: Record<string, unknown> | null
  bodyNodes: Record<string, unknown>[]
} | null {
  // generated_posts.content kommt je nach Schreibpfad als String oder als
  // Objekt — dasselbe Muster wie in der Edit-Page.
  const parsed = typeof content === 'string'
    ? (() => { try { return JSON.parse(content) } catch { return null } })()
    : content
  const nodes = (parsed as { content?: unknown[] } | null)?.content
  if (!Array.isArray(nodes)) return null

  const headings = nodes
    .map((n, i) => ({ node: n as Record<string, unknown>, i }))
    .filter((x) => x.node.type === 'heading')
  if (headings.length === 0) return null

  const topic = headings.find(
    (x) => ((x.node.attrs ?? {}) as Record<string, unknown>).bundleType === 'topic',
  )
  const chosen = topic ?? headings[0]

  const nextHeadingPos = headings.find((x) => x.i > chosen.i)?.i ?? nodes.length
  const sectionNodes = nodes.slice(chosen.i + 1, nextHeadingPos) as Record<string, unknown>[]

  // Take vom Bericht trennen. Der Take ist im Tagesartikel ein eigener Absatz,
  // der mit „Synthszr Take:" beginnt — er wird im Wrap-up durch eine gekürzte
  // Fassung ersetzt, der Bericht dagegen unverändert übernommen.
  const takeIdx = sectionNodes.findIndex((n) => textOf(n).trimStart().startsWith('Synthszr Take:'))
  const bodyNodes = takeIdx === -1 ? sectionNodes : sectionNodes.slice(0, takeIdx)
  const takeText = takeIdx === -1 ? '' : textOf(sectionNodes[takeIdx]).trim()

  const body = bodyNodes
    .map(textOf)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')

  return {
    headline: textOf(chosen.node).trim(),
    body,
    takeText,
    headingNode: chosen.node,
    bodyNodes,
  }
}

/**
 * Die Themen der Woche, chronologisch Montag → Sonnabend.
 *
 * Ein Tag ohne veröffentlichten Artikel entfällt ersatzlos — deshalb „bis zu
 * sechs" und nicht „genau sechs".
 */
export async function collectWeekTopics(
  supabase: AdminClient,
  mondayIso: string,
  saturdayEndIso: string,
): Promise<WrapupTopic[]> {
  const { data, error } = await supabase
    .from('generated_posts')
    .select('slug, created_at, content')
    .eq('status', 'published')
    .gte('created_at', mondayIso)
    .lt('created_at', saturdayEndIso)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Artikel der Woche nicht ladbar: ${error.message}`)

  const out: WrapupTopic[] = []
  const seenDays = new Set<string>()
  for (const row of (data ?? []) as Array<{ slug: string; created_at: string; content: unknown }>) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })
      .format(new Date(row.created_at))
    // Ein Tag, ein Thema. Erscheinen an einem Tag zwei Artikel, zählt der
    // frühere — die Sortierung oben ist aufsteigend.
    if (seenDays.has(date)) continue
    const picked = pickTopicFromPost(row.content)
    if (!picked) continue
    seenDays.add(date)
    const [y, m, d] = date.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
    out.push({
      weekday: WEEKDAYS[dow],
      date,
      headline: picked.headline,
      body: picked.body,
      takeText: picked.takeText,
      headingNode: picked.headingNode,
      bodyNodes: picked.bodyNodes,
      postSlug: row.slug,
    })
  }
  return out
}
