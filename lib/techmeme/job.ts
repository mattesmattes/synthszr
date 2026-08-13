/**
 * Der Techmeme-Lauf: Startseite lesen, KI-Meldungen behalten, deren Quellen in
 * die News-Queue schreiben.
 *
 * ZUSTANDSLOS, UND DAS MIT ABSICHT. Naheliegend wäre ein fortsetzbarer Job wie
 * bei den Lexikon-Läufen (Zwischenstand speichern, nächster Tick macht weiter).
 * Hier ist das unnötig: Jeder Lauf gleicht die gefundenen Adressen gegen die
 * bereits vorhandenen Queue-Einträge ab. Was der vorige Lauf geschafft hat,
 * fällt dadurch von selbst weg — der nächste macht genau dort weiter, ohne dass
 * irgendwo ein Zwischenstand gepflegt werden müsste.
 *
 * Das ist auch selbstheilend: Ein abgebrochener Lauf hinterlässt keinen
 * halbfertigen Zustand, der aufgeräumt werden müsste.
 *
 * ZEITBUDGET STATT VOLLSTÄNDIGKEIT: Bis zu 13 Stories mal 10 Quellen sind 130
 * Abrufe, überwiegend Crawls. Das passt nicht zuverlässig in ein
 * Funktionszeitfenster. Der Lauf hört auf, wenn das Budget aufgebraucht ist,
 * und meldet, was liegen blieb — der nächste Lauf holt es nach.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchTopStories, selectSources, SOURCES_PER_STORY, type TechmemeStory } from '@/lib/techmeme/client'
import { filterRelevantStories } from '@/lib/techmeme/relevance'
import { loadFeedCache, persistFeedCache, hostOf } from '@/lib/techmeme/feed-discovery'
import { fetchSourceText, type FetchContext } from '@/lib/techmeme/fetch-text'
import { buildQueueItem, filterKnownSources, storyKeyFor, type TechmemeQueueItem } from '@/lib/techmeme/queue-items'
import { addToQueue } from '@/lib/news-queue/service'
import { pickTopicStories, TOPIC_STORY_LIMIT } from '@/lib/techmeme/topic-selection'

type AdminClient = ReturnType<typeof createAdminClient>

/** Wie weit zurück nach schon bekannten Adressen gesucht wird. */
const KNOWN_URL_DAYS = 7

/** Gleichzeitige Abrufe. Vier fremde Server parallel ist zügig und höflich. */
const CONCURRENCY = 4

/** Standard-Zeitbudget. Die Funktion darf 300s, der Rest ist Sicherheitsabstand. */
const DEFAULT_BUDGET_MS = 240_000

export interface TechmemeRunResult {
  stories: number
  relevant: number
  /** Adressen, die nach dem Abgleich übrig blieben. */
  kandidaten: number
  verarbeitet: number
  hinzugefuegt: number
  /** Kein brauchbarer Text zu holen — weder Feed noch Crawl. */
  ohneText: number
  /** Wegen Zeitbudget liegen geblieben. */
  offen: number
  modi: Record<string, number>
  /** Wie viele Stories als „Thema des Tages" laufen. */
  themen: number
  fehler: string[]
}

/**
 * Adressen, die schon in der Queue stehen.
 *
 * MIT range(): PostgREST kappt ohne Bereichsangabe stillschweigend bei 1000
 * Zeilen. Das hat in diesem Projekt schon dreimal zugeschlagen — zuletzt beim
 * Begriffs-Abgleich, wo die 60 neuesten Einträge unsichtbar blieben. Wird die
 * Liste hier gekappt, legt der Job Artikel doppelt an.
 *
 * ZEITSTEMPEL IST `queued_at`, NICHT `created_at`. Beim ersten Trockenlauf
 * (2026-08-13) meldete der Abgleich „0 bekannte Adressen" bei 75.859 Zeilen in
 * der Tabelle — die Spalte gibt es dort schlicht nicht, und PostgREST antwortet
 * mit einem Fehler statt mit Zeilen.
 *
 * UND DESHALB WIRFT DIESE FUNKTION. Ein Fehler beim Relevanzfilter darf
 * durchgehen — schlimmstenfalls kommen ein paar Stories zu viel durch. Beim
 * Dedup ist dasselbe Verhalten fatal: „nichts ist bekannt" heißt „lege alles
 * erneut an". Lieber kein Lauf als ein Lauf, der die Queue verdoppelt.
 */
async function loadKnownUrls(supabase: AdminClient): Promise<string[]> {
  const seit = new Date(Date.now() - KNOWN_URL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const PAGE = 1000
  const out: string[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('source_url')
      .not('source_url', 'is', null)
      .gte('queued_at', seit)
      .range(from, from + PAGE - 1)

    if (error) {
      throw new Error(`Abgleich mit vorhandenen Queue-Eintraegen nicht moeglich: ${error.message}`)
    }
    const seite = (data ?? []) as Array<{ source_url: string | null }>
    out.push(...seite.map((r) => r.source_url).filter((u): u is string => Boolean(u)))
    if (seite.length < PAGE) break
  }
  return out
}

/**
 * Wie viele Einträge je Techmeme-Story schon in der Queue stehen.
 *
 * NÖTIG, WEIL DIE OBERGRENZE SONST NUR JE LAUF GILT: Techmeme nimmt im Lauf des
 * Tages neue Quellen in eine Story auf. Die rücken in die vorderen zehn vor, und
 * über mehrere Durchgänge summierte sich das — am 2026-08-13 auf zwölf Einträge
 * bei einer Story, obwohl SOURCES_PER_STORY zehn erlaubt. Bei einer Meldung, die
 * zwei Tage auf der Startseite steht, liefe das immer weiter auf.
 */
async function loadStoryCounts(supabase: AdminClient): Promise<Map<string, number>> {
  const seit = new Date(Date.now() - KNOWN_URL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const PAGE = 1000
  const counts = new Map<string, number>()

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('metadata')
      .gte('queued_at', seit)
      .range(from, from + PAGE - 1)

    if (error) {
      throw new Error(`Story-Belegung nicht lesbar: ${error.message}`)
    }
    const seite = (data ?? []) as Array<{ metadata: Record<string, unknown> | null }>
    for (const zeile of seite) {
      const key = zeile.metadata?.techmeme_story
      if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (seite.length < PAGE) break
  }
  return counts
}

/**
 * Story-Schlüssel, die bereits als Thema des Tages vorgemerkt sind.
 *
 * Ohne diese Zählung markierte jeder Lauf erneut „die obersten fünf" — nach
 * sechs Läufen am Tag stünden bis zu dreißig Leitartikel im Post, jeder bis zu
 * 25 Sätze lang.
 */
async function loadActiveTopicStories(supabase: AdminClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('news_queue')
    .select('metadata')
    .eq('status', 'selected')
    .eq('bundle_type', 'topic')
    .range(0, 999)

  if (error) {
    throw new Error(`Vorgemerkte Themen nicht lesbar: ${error.message}`)
  }
  const keys = new Set<string>()
  for (const zeile of (data ?? []) as Array<{ metadata: Record<string, unknown> | null }>) {
    const key = zeile.metadata?.techmeme_story
    if (typeof key === 'string') keys.add(key)
  }
  return keys
}

interface Aufgabe {
  story: TechmemeStory
  source: { url: string; publication: string }
  rank: number
  /** Position der Story auf der Startseite — Techmemes Haupturteil. */
  storyIndex: number
  totalStories: number
  /** Gehört zu den Themen des Tages (Bündel-Abschnitt statt Einzelmeldung). */
  istThema: boolean
}

/** Arbeitet die Liste mit fester Parallelität ab und hält das Zeitbudget ein. */
async function abarbeiten(
  aufgaben: Aufgabe[],
  ctx: FetchContext,
  deadline: number,
  ergebnis: TechmemeRunResult,
): Promise<TechmemeQueueItem[]> {
  const fertig: TechmemeQueueItem[] = []
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      if (Date.now() > deadline) return
      const i = next++
      if (i >= aufgaben.length) return
      const { story, source, rank, storyIndex, totalStories, istThema } = aufgaben[i]

      try {
        const text = await fetchSourceText(ctx, source.url)
        ergebnis.verarbeitet++
        if (!text) {
          ergebnis.ohneText++
          continue
        }
        ergebnis.modi[text.mode] = (ergebnis.modi[text.mode] ?? 0) + 1
        fertig.push(buildQueueItem({
          story, source, rank, storyIndex, totalStories, istThema,
          text: text.text,
          title: text.title,
          mode: text.mode,
          publishedAt: text.publishedAt,
        }))
      } catch (err) {
        ergebnis.verarbeitet++
        ergebnis.fehler.push(`${hostOf(source.url)}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  ergebnis.offen = Math.max(0, aufgaben.length - next)
  return fertig
}

export async function runTechmemeJob(
  supabase: AdminClient,
  opts: { budgetMs?: number; maxStories?: number } = {},
): Promise<TechmemeRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS)
  const ergebnis: TechmemeRunResult = {
    stories: 0, relevant: 0, kandidaten: 0, verarbeitet: 0,
    hinzugefuegt: 0, ohneText: 0, offen: 0, modi: {}, themen: 0, fehler: [],
  }

  const stories = await fetchTopStories(opts.maxStories ?? 20)
  ergebnis.stories = stories.length
  if (stories.length === 0) return ergebnis

  const relevanz = await filterRelevantStories(stories.map((s) => s.headline))
  const relevante = relevanz.keepIndices.map((i) => stories[i])
  ergebnis.relevant = relevante.length
  if (!relevanz.filtered) {
    console.warn('[Techmeme] Relevanzpruefung lief nicht — alle Stories gelten als relevant')
  }

  const bekannt = await loadKnownUrls(supabase)
  const storyCounts = await loadStoryCounts(supabase)

  // Die obersten Stories werden „Thema des Tages" — ein gebündelter Leitartikel
  // je Story, der alle ihre Quellen zusammenführt (Betreiber-Vorgabe).
  const themen = pickTopicStories(
    relevante.map((s) => storyKeyFor(s)),
    await loadActiveTopicStories(supabase),
  )
  ergebnis.themen = Math.min(themen.size, TOPIC_STORY_LIMIT)

  // Techmemes Reihenfolge bleibt erhalten: Rang 0 ist die Hauptmeldung. Der
  // Rang wird VOR dem Abgleich vergeben, damit er die Position bei Techmeme
  // beschreibt und nicht die in unserer Restliste.
  //
  // Der STORY-INDEX ist Techmemes Position auf der Startseite, nicht die
  // Position in unserer gefilterten Liste: Er ist das redaktionelle Urteil,
  // das wir uebernehmen wollen. Wuerde er nach dem Relevanzfilter neu vergeben,
  // rueckte jede Story auf, sobald davor eine als nicht KI-relevant wegfaellt —
  // und aus Platz 12 wuerde Platz 3.
  const aufgaben: Aufgabe[] = []
  for (const [reihe, story] of relevante.entries()) {
    const storyIndex = relevanz.keepIndices[reihe] ?? reihe
    const gewaehlt = selectSources(story.sources)

    // Die Obergrenze gilt JE STORY, nicht je Lauf: Was frühere Durchgänge schon
    // angelegt haben, zählt mit.
    const storyKey = storyKeyFor(story)
    const belegt = storyCounts.get(storyKey) ?? 0
    const frei = Math.max(0, SOURCES_PER_STORY - belegt)
    if (frei === 0) continue

    const frisch = filterKnownSources(gewaehlt, bekannt).slice(0, frei)
    for (const source of frisch) {
      aufgaben.push({
        story, source, rank: gewaehlt.indexOf(source), storyIndex,
        totalStories: stories.length,
        istThema: themen.has(storyKey),
      })
    }
  }
  ergebnis.kandidaten = aufgaben.length
  if (aufgaben.length === 0) return ergebnis

  const ctx: FetchContext = {
    supabase,
    feedCache: await loadFeedCache(supabase),
    bodies: new Map(),
  }

  const items = await abarbeiten(aufgaben, ctx, deadline, ergebnis)
  await persistFeedCache(supabase, ctx.feedCache)

  if (items.length > 0) {
    const res = await addToQueue(items)
    ergebnis.hinzugefuegt = res.added
    ergebnis.fehler.push(...res.errors.slice(0, 5))
  }

  return ergebnis
}
