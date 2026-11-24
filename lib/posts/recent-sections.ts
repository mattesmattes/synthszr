/**
 * Abschnitts-basiertes 3-Tage-Retrieval über bereits veröffentlichte Posts.
 *
 * WARUM NICHT `historical-retrieval.ts` oder `semantic-dedup.ts`:
 * - `historical-retrieval.ts` liefert nur Post-Titel + 220-Zeichen-Excerpt über
 *   alle Zeiträume (für optionale Callback-Zitate, zu grob für Aspekt-Reduktion).
 * - `semantic-dedup.ts` unterdrückt ganze Items (`recentCoverageDays: 3`) — wir
 *   wollen laufende Themen aber NICHT droppen, sondern wiederholte Vorgeschichte
 *   streichen und das tägliche Delta (was heute neu ist) herausarbeiten.
 * - `published_units` trägt für aktuelle Posts in Produktion oft 0 Zeilen; daher
 *   lesen wir die veröffentlichten `generated_posts` der letzten 3 Tage direkt
 *   aus dem TipTap-Dokument je H2-Abschnitt (Bericht + Synthszr Take).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddings,
  prepareTextForEmbedding,
} from '@/lib/embeddings/generator'

export const RECENT_COVERAGE_DAYS = 3
export const DEFAULT_RECENT_SECTION_THRESHOLD = 0.68
export const DEFAULT_RECENT_SECTION_LIMIT = 3

export interface RecentPublishedSection {
  postId: string
  postTitle: string
  publishedAt: string
  heading: string
  summary: string
  take: string
}

export interface EmbeddedRecentSection extends RecentPublishedSection {
  embedding: number[]
}

export interface RecentSectionMatch {
  section: RecentPublishedSection
  similarity: number
}

const TAKE_RE = /^\s*(?:\*\*)?Synthszr Take:(?:\*\*)?\s*([\s\S]*)$/i
const STANDALONE_TAG_RE = /^(\{(?!lex:)[^}]+\}\s*)+(→.*)?$/
const INLINE_TAG_TAIL_RE = /\s*(?:\{(?!lex:)[^}\n]+\}\s*)+(?:→.*)?$/

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  const own = typeof n.text === 'string' ? n.text : ''
  const kids = Array.isArray(n.content) ? n.content.map(textOf).join('') : ''
  return own + kids
}

function formatDeDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso.slice(0, 10)
  try {
    return new Date(ms).toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Extrahiert alle H2-News-Abschnitte (Überschrift, Fließtext-Zusammenfassung
 * ohne Company-/Quellenzeile und Synthszr Take) aus einem TipTap-Dokument.
 */
export function extractSectionsFromTiptap(
  doc: unknown,
  meta: { postId: string; postTitle: string; publishedAt: string },
): RecentPublishedSection[] {
  let parsed = doc
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const content = (parsed as { content?: unknown[] }).content
  if (!Array.isArray(content)) return []

  const out: RecentPublishedSection[] = []
  let current: { heading: string; paras: string[]; take: string } | null = null

  const flush = () => {
    if (!current) return
    const heading = current.heading.trim()
    const summary = current.paras.join('\n\n').trim()
    if (heading && summary) {
      out.push({
        postId: meta.postId,
        postTitle: meta.postTitle,
        publishedAt: meta.publishedAt,
        heading,
        summary,
        take: current.take.trim(),
      })
    }
  }

  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as { type?: string; attrs?: { level?: number } }
    if (node.type === 'heading' && node.attrs?.level === 2) {
      flush()
      current = { heading: textOf(node).trim(), paras: [], take: '' }
      continue
    }
    if (!current || node.type !== 'paragraph') continue
    const rawText = textOf(node).trim()
    if (!rawText) continue

    const takeMatch = rawText.match(TAKE_RE)
    if (takeMatch) {
      current.take = takeMatch[1].trim()
      continue
    }

    if (STANDALONE_TAG_RE.test(rawText) || /^→\s*/.test(rawText)) continue
    const cleaned = rawText.replace(INLINE_TAG_TAIL_RE, '').trim()
    if (cleaned) current.paras.push(cleaned)
  }

  flush()
  return out
}

/**
 * Vergleicht ein Query-Embedding gegen alle vorbereiteten Abschnitts-Embeddings
 * der letzten Tage (gefiltert ab `threshold`, absteigend nach Ähnlichkeit, max `limit`).
 */
export function matchRecentSections(
  queryEmbedding: number[],
  candidates: EmbeddedRecentSection[],
  options: { threshold?: number; limit?: number } = {},
): RecentSectionMatch[] {
  if (!queryEmbedding || queryEmbedding.length === 0 || candidates.length === 0) return []
  const threshold = options.threshold ?? DEFAULT_RECENT_SECTION_THRESHOLD
  const limit = options.limit ?? DEFAULT_RECENT_SECTION_LIMIT

  const scored: RecentSectionMatch[] = []
  for (const c of candidates) {
    if (!c.embedding || c.embedding.length !== queryEmbedding.length) continue
    const similarity = cosineSimilarity(queryEmbedding, c.embedding)
    if (similarity >= threshold) {
      scored.push({
        section: {
          postId: c.postId,
          postTitle: c.postTitle,
          publishedAt: c.publishedAt,
          heading: c.heading,
          summary: c.summary,
          take: c.take,
        },
        similarity,
      })
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Kompakter Prompt-Block für Pre-Write & Delta-Pass: zeigt dem Modell konkret,
 * welche Fakten/Argumente in den letzten 3 Tagen bereits erschienen sind.
 */
export function formatRecentCoverageForPrompt(matches: RecentSectionMatch[]): string {
  if (matches.length === 0) return ''

  const entries = matches.map(({ section }, i) => {
    const lines = [
      `[${i + 1}] „${section.heading}" (${formatDeDate(section.publishedAt)})`,
      `Bericht: ${section.summary.replace(/\s+/g, ' ').trim().slice(0, 900)}`,
    ]
    if (section.take) {
      lines.push(`Bisheriger Take: ${section.take.replace(/\s+/g, ' ').trim().slice(0, 450)}`)
    }
    return lines.join('\n')
  })

  return [
    'BEREITS IN DEN LETZTEN 3 TAGEN BERICHTET (nicht erneut nacherzählen — Fokus auf NEUE Aspekte):',
    ...entries,
    'DELTA-REGELN:\n'
      + '- Wiederhole KEINE bereits oben berichteten Fakten, Zahlen, Zitate oder allgemeine Vorgeschichte in voller Breite.\n'
      + '- Baue den Bericht rund um das HEUTIGE DELTA auf: neue Ereignisse, neue Zahlen, neue Akteure, neue Wendungen oder Reaktionen.\n'
      + '- Belasse nur so viel Kontext (höchstens ein knapper Einordnungs-Halbsatz / kurzer Rückbezug), dass ein heutiger Leser den neuen Stand sofort versteht.\n'
      + '- Der Synthszr Take darf NICHT das Argument eines früheren Takes wiederholen — spitze ihn auf die neue Entwicklung zu.\n'
      + '- KEIN Erfinden: Bietet das heutige Quellmaterial nur wenig Neues, bleibe ehrlich knapp und präzise statt neue Aspekte hinzuzudichten.',
  ].join('\n\n')
}

/**
 * Kompakter Take-Hinweis für `applyTakePass`, damit der nachgelagerte
 * Take-Durchgang kein Argument der letzten 3 Tage wiederholt.
 */
export function formatRecentTakesForPrompt(matches: RecentSectionMatch[]): string {
  const withTake = matches.filter((m) => m.section.take.trim().length > 0)
  if (withTake.length === 0) return ''

  const blocks = withTake.map(({ section }, i) => {
    const takeText = section.take.replace(/\s+/g, ' ').trim().slice(0, 450)
    return `[${i + 1}] „${section.heading}" (${formatDeDate(section.publishedAt)}): ${takeText}`
  })

  return [
    'BISHERIGE SYNTHSZR TAKES DER LETZTEN 3 TAGE ZU DIESEM THEMA (wiederhole dieses Argument NICHT — spitze auf das heutige Delta zu):',
    ...blocks,
  ].join('\n\n')
}

interface PublishedPostRow {
  id: string
  title: string | null
  created_at: string
  published_at: string | null
  content: unknown
}

/**
 * Lädt alle Abschnitte veröffentlichter Posts der letzten `days` (Default 3) Tage
 * und bettet sie einmal pro Pipeline-Lauf in einem Batch ein. Fail-open (`[]`).
 */
export async function loadRecentPublishedSections(
  options: {
    days?: number
    now?: number
    supabase?: ReturnType<typeof createAdminClient>
    embed?: (texts: string[]) => Promise<number[][]>
  } = {},
): Promise<EmbeddedRecentSection[]> {
  const days = options.days ?? RECENT_COVERAGE_DAYS
  const now = options.now ?? Date.now()
  const cutoffMs = now - days * 86_400_000
  const sinceIso = new Date(cutoffMs).toISOString()

  try {
    const supabase = options.supabase ?? createAdminClient()
    const { data, error } = await supabase
      .from('generated_posts')
      .select('id, title, created_at, published_at, content')
      .eq('status', 'published')
      .or(`published_at.gte.${sinceIso},and(published_at.is.null,created_at.gte.${sinceIso})`)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(20)

    if (error) {
      console.warn('[RecentSections] Laden veröffentlichter Posts fehlgeschlagen (fail-open):', error.message)
      return []
    }

    const sections: RecentPublishedSection[] = []
    for (const row of (data ?? []) as PublishedPostRow[]) {
      const effectiveAt = row.published_at || row.created_at
      const ts = Date.parse(effectiveAt)
      if (!Number.isFinite(ts) || ts < cutoffMs) continue
      sections.push(
        ...extractSectionsFromTiptap(row.content, {
          postId: row.id,
          postTitle: row.title || '',
          publishedAt: effectiveAt,
        }),
      )
    }

    if (sections.length === 0) return []

    const embedFn = options.embed ?? ((texts: string[]) => generateEmbeddings(texts, { batchSize: 16, delayMs: 50 }))
    const texts = sections.map((s) =>
      prepareTextForEmbedding(s.heading, s.summary, { maxContentLength: 1200 }),
    )
    const embeddings = await embedFn(texts)

    const out: EmbeddedRecentSection[] = []
    for (let i = 0; i < sections.length; i++) {
      const emb = embeddings[i]
      if (Array.isArray(emb) && emb.length > 0) {
        out.push({ ...sections[i], embedding: emb })
      }
    }
    return out
  } catch (err) {
    console.warn('[RecentSections] Retrieval fehlgeschlagen (fail-open):', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Findet je zu schreibendem Abschnitt die semantisch passenden Vorberichte der
 * letzten 3 Tage. Fail-open (`[]`).
 */
export async function findMatchingRecentSections(
  queryText: string,
  index: EmbeddedRecentSection[],
  options: {
    threshold?: number
    limit?: number
    embedOne?: (text: string) => Promise<number[]>
  } = {},
): Promise<RecentSectionMatch[]> {
  if (index.length === 0 || !queryText || !queryText.trim()) return []
  try {
    const embedOne = options.embedOne ?? generateEmbedding
    const queryEmbedding = await embedOne(queryText.trim())
    return matchRecentSections(queryEmbedding, index, {
      threshold: options.threshold,
      limit: options.limit,
    })
  } catch (err) {
    console.warn('[RecentSections] Query-Embedding fehlgeschlagen (fail-open):', err instanceof Error ? err.message : err)
    return []
  }
}
