/**
 * Bausteine des published_units-Backfills (scripts/build-published-units.ts).
 *
 * WARUM eigene Datei statt alles im Script: das Script ruft main() beim
 * Import auf und ist damit nicht testbar. Die sicherheitsrelevanten Zweige —
 * kaputter content wird NICHT bereinigt, NULL-content wird bereinigt, ein
 * Embedding-Fehler lässt den alten Stand stehen, 3 Fehler in Folge brechen ab,
 * Flag ohne Wert ist ungültig — laufen sonst zum ersten Mal im
 * [FREIGABE]-Lauf gegen Prod (BEFUND 2026-10-06, Prüferlauf). Supabase-Client
 * und Embedding-Funktion kommen als Parameter (Vertrag 0), damit die Tests
 * ohne vi.mock und ohne Gemini-Key laufen.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { extractPublishedUnits, type PublishedUnit } from './taste-ground-truth'

export type SupabaseAdmin = ReturnType<typeof createAdminClient>

/** Texte → Vektoren in gleicher Reihenfolge; das Script reicht generateEmbeddings durch. */
export type EmbedTexts = (texts: string[]) => Promise<number[][]>

export interface BuildArgs {
  dryRun: boolean
  since?: string
  limit?: number
}

/**
 * Wert eines Flags in beiden Schreibweisen: `--since 2026-09-01` und
 * `--since=2026-09-01`. `undefined` = Flag fehlt. Flag als letztes Argument
 * ohne Wert → '' (ungültig) — WARUM: `argv[idx + 1]` wäre undefined, und
 * parseBuildArgs läse „… --since" dann wie „nicht gesetzt" → stiller Volllauf.
 */
export function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (idx < 0) return undefined
  const a = argv[idx]
  if (a.length > flag.length) return a.slice(flag.length + 1)
  return argv[idx + 1] ?? ''
}

/** `null` = Flag vorhanden, aber ungültig (Abbruch statt stillem Volllauf — wie backfill-taste-features.ts:45-65). */
export function parseBuildArgs(argv: string[]): BuildArgs | null {
  const dryRun = argv.includes('--dry-run')
  const since = argValue(argv, '--since')
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null
  const limitRaw = argValue(argv, '--limit')
  let limit: number | undefined
  if (limitRaw !== undefined) {
    const n = Number(limitRaw)
    if (!Number.isFinite(n) || n < 1) return null
    limit = Math.floor(n)
  }
  return { dryRun, since, limit }
}

export type ParsedContent = { broken: true } | { broken: false; value: unknown }

/**
 * content genau einmal parsen. `broken` = TEXT-Spalte mit unparsebarem JSON
 * (Vertrag 0: zählen und überspringen; alter Stand bleibt). Nicht-String
 * (NULL oder schon Objekt) wird durchgereicht — parseTipTapContent in
 * extractPublishedUnits macht aus NULL ein leeres Doc: 0 Einheiten, der Post
 * wird bereinigt. WARUM nicht parseTipTapContent hier: das liefert bei
 * kaputtem JSON stumm ein leeres Doc, und ein kaputter Post darf NICHT
 * bereinigt werden.
 */
export function parseContent(content: unknown): ParsedContent {
  if (typeof content !== 'string') return { broken: false, value: content }
  try {
    return { broken: false, value: JSON.parse(content) }
  } catch {
    return { broken: true }
  }
}

export interface PostRow {
  id: string
  content: unknown
  published_at: string | null
}

export type PostOutcome =
  | { kind: 'broken' }
  | { kind: 'dry_run'; units: PublishedUnit[] }
  | { kind: 'written'; units: PublishedUnit[]; embedded: number }
  | { kind: 'embed_failed'; units: PublishedUnit[]; error: string }

/**
 * Einen Post verarbeiten: parsen, Einheiten ziehen, embedden, delete + insert
 * (idempotent je post_id).
 *
 * - broken: kein DB-Zugriff, kein Embedding — der alte Stand bleibt.
 * - dry_run: kein DB-Zugriff, kein Embedding (kostet).
 * - embed_failed: VOR dem delete abgebrochen — ein halber Post ohne
 *   Embeddings wäre für Similarity-Lookups (Task 11/12) schlechter als der
 *   alte Stand; der nächste Lauf holt ihn nach.
 * - written mit 0 Einheiten: nur delete — Abschnitte, die nachträglich aus dem
 *   Post gelöscht wurden, verschwinden auch aus published_units.
 * DB-Fehler werfen: das ist kein Einzelfall, sondern ein kaputter Zugang.
 */
export async function processPost(
  supabase: SupabaseAdmin,
  embed: EmbedTexts,
  post: PostRow,
  dryRun: boolean,
): Promise<PostOutcome> {
  const parsed = parseContent(post.content)
  if (parsed.broken) return { kind: 'broken' }
  const units = extractPublishedUnits(parsed.value)
  if (dryRun) return { kind: 'dry_run', units }

  let embeddings: number[][] = []
  if (units.length > 0) {
    try {
      // Backfill-Variante OHNE Quelle (lib/embeddings/backfill.ts:82), damit
      // Similarities zu daily_repo.embedding vergleichbar bleiben (Vertrag 0;
      // BEFUND 2026-10-06, Karte D Fallstrick 7: dedupeByTopic embeddet MIT
      // Quelle, das wäre hier die falsche Vorlage).
      embeddings = await embed(units.map((u) => prepareTextForEmbedding(u.heading, u.firstParagraph)))
    } catch (err) {
      return { kind: 'embed_failed', units, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const rows = units.map((u, i) => ({
    post_id: post.id,
    position: u.position,
    heading: u.heading,
    bundle_type: u.bundleType,
    member_ids: u.memberIds,
    published_at: post.published_at,
    // pgvector-Schreibformat wie lib/embeddings/backfill.ts:90. Leerer Text
    // (Heading UND Absatz leer) liefert [] aus generateEmbeddings → NULL.
    embedding: embeddings[i] && embeddings[i].length > 0 ? `[${embeddings[i].join(',')}]` : null,
  }))

  const { error: delError } = await supabase.from('published_units').delete().eq('post_id', post.id)
  if (delError) throw new Error(`published_units delete (${post.id}): ${delError.message}`)
  if (rows.length > 0) {
    const { error: insError } = await supabase.from('published_units').insert(rows)
    if (insError) throw new Error(`published_units insert (${post.id}): ${insError.message}`)
  }
  return { kind: 'written', units, embedded: rows.filter((r) => r.embedding !== null).length }
}

export const MAX_CONSECUTIVE_EMBED_FAILS = 3

/**
 * Zählt Embedding-Fehler IN FOLGE; `record` liefert true = abbrechen.
 * WARUM: fehlt GOOGLE_GENERATIVE_AI_API_KEY (generator.ts:11-20 wirft) oder
 * ist Gemini down, scheitert JEDER Post — ohne Schwelle liefe das Script über
 * alle Posts, lüde jede content-Zeile und endete mit Exit 0. Nur ein echter
 * Embedding-Erfolg (written mit ≥ 1 Einheit) setzt zurück; kaputte Posts und
 * Posts ohne Einheit haben gar nicht embeddet und beweisen nichts.
 */
export function createEmbedFailGuard(max = MAX_CONSECUTIVE_EMBED_FAILS): {
  record: (outcome: PostOutcome) => boolean
  consecutive: () => number
} {
  let consecutive = 0
  return {
    record(outcome) {
      if (outcome.kind === 'embed_failed') consecutive++
      else if (outcome.kind === 'written' && outcome.units.length > 0) consecutive = 0
      return consecutive >= max
    },
    consecutive: () => consecutive,
  }
}
