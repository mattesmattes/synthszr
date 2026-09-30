/**
 * Von Hand markierte Meldungen der passenden Techmeme-Story zuordnen.
 *
 * WARUM (Betreiber-Vorgabe 2026-09-30): Techmeme labelt jede Story automatisch
 * als „Thema des Tages" (lib/techmeme/job.ts) — technisch dasselbe Label wie die
 * Handmarkierung. Die Regel „ein Label, ein Abschnitt" (2026-09-28) verschmolz
 * dadurch ALLE Stories zu einem Abschnitt: Der Nachtlauf vom 2026-09-30 machte
 * aus fünf Stories (OpenAI Astra, Anthropic-IPO, Instinct, Sonnet 5.5, AMD/World
 * Labs) einen einzigen. Seitdem gilt wieder: je Story ein Abschnitt.
 *
 * Das Problem, das die Regel vom 28.09. lösen sollte, bleibt aber real: Eine von
 * Hand als „Thema des Tages" markierte Meldung zur SELBEN Sache wie ein
 * Techmeme-Bündel lief als zweiter Abschnitt daneben (Benedict Evans zum
 * DNS-Vorfall bei OpenAI). Deshalb wandert eine Handmarkierung ohne Story in die
 * Story DESSELBEN Labels, deren Quellen ihr am ähnlichsten sind — sofern die
 * Ähnlichkeit die Themen-Dedup-Schwelle erreicht. Sonst bilden alle
 * Handmarkierungen eines Labels zusammen einen Abschnitt.
 *
 * Der frühere Workaround (bundle-type-Route bis 2026-09-28) griff nur, wenn es
 * GENAU EINE aktive Story gab — bei fünf Stories nie.
 *
 * Die Zuordnung ist nur im Speicher und wird nicht in die Queue geschrieben: Sie
 * gilt für diesen Lauf. Aufgerufen wird sie NACH capByUnits, damit die
 * Handmarkierung dort noch als eigene Gruppe zählt und nicht der Top-5-Grenze
 * der Story zum Opfer fällt.
 */
import { cosineSimilarity, prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { DEFAULT_DEDUP_THRESHOLD } from '@/lib/news-queue/semantic-dedup'
import { bundleKeyOf } from './queue-article'

interface Zuordenbar {
  id: string
  title: string
  content: string | null
  bundle_type?: string | null
  metadata?: Record<string, unknown> | null
}

/** Handmarkierung = gelabelt, aber ohne Techmeme-Story. */
function istHandmarkierung(item: Zuordenbar): boolean {
  return !!item.bundle_type && !bundleKeyOf(item.metadata)
}

/**
 * Pure Zuordnung: `embeddings` ist parallel zu `items`. Eine Handmarkierung
 * bekommt den Story-Schlüssel der Story desselben Labels mit der höchsten
 * Ähnlichkeit zu IRGENDEINER ihrer Quellen, wenn diese ≥ `threshold` ist.
 * Leere Embeddings werden übersprungen. Die Eingabe bleibt unverändert.
 */
export function assignManualToStories<T extends Zuordenbar>(items: T[], embeddings: number[][], threshold: number): T[] {
  return items.map((item, i) => {
    const eigenes = embeddings[i]
    if (!istHandmarkierung(item) || !eigenes || eigenes.length === 0) return item

    let besteStory: string | null = null
    let besteAehnlichkeit = -Infinity
    items.forEach((kandidat, j) => {
      const story = bundleKeyOf(kandidat.metadata)
      const emb = embeddings[j]
      if (!story || kandidat.bundle_type !== item.bundle_type || !emb || emb.length !== eigenes.length) return
      const sim = cosineSimilarity(eigenes, emb)
      if (sim > besteAehnlichkeit) {
        besteAehnlichkeit = sim
        besteStory = story
      }
    })

    if (besteStory === null || besteAehnlichkeit < threshold) return item
    return { ...item, metadata: { ...(item.metadata ?? {}), techmeme_story: besteStory } }
  })
}

type Embedder = (texts: string[]) => Promise<number[][]>

/**
 * Best-effort-Hülle: Embeddings nur, wenn es neben einer Handmarkierung auch
 * eine Story desselben Labels gibt (sonst kein Aufruf, keine Kosten). Scheitern
 * die Embeddings, bleibt alles, wie es ist — die Handmarkierungen bilden dann
 * ihren eigenen Abschnitt, die Artikel-Erzeugung läuft weiter.
 */
export async function attachManualToStories<T extends Zuordenbar>(
  items: T[],
  opts: { embed?: Embedder; threshold?: number } = {},
): Promise<T[]> {
  const labelsMitStory = new Set(items.filter((i) => i.bundle_type && bundleKeyOf(i.metadata)).map((i) => i.bundle_type))
  const kandidaten = items.filter((i) => istHandmarkierung(i) && labelsMitStory.has(i.bundle_type))
  if (kandidaten.length === 0) return items

  const relevant = items.filter((i) => i.bundle_type && labelsMitStory.has(i.bundle_type))
  const embed: Embedder = opts.embed ?? (async (texts) => {
    const { generateEmbeddings } = await import('@/lib/embeddings/generator')
    return generateEmbeddings(texts, { batchSize: 16 })
  })

  let embeddings: number[][]
  try {
    embeddings = await embed(relevant.map((i) => prepareTextForEmbedding(i.title, i.content ?? '')))
  } catch (err) {
    console.error('[BundleAttach] Embeddings fehlgeschlagen, Handmarkierungen bleiben eigener Abschnitt:', err instanceof Error ? err.message : err)
    return items
  }

  const zugeordnet = assignManualToStories(relevant, embeddings, opts.threshold ?? DEFAULT_DEDUP_THRESHOLD)
  const byId = new Map(zugeordnet.map((i) => [i.id, i]))
  for (const k of kandidaten) {
    const story = bundleKeyOf(byId.get(k.id)?.metadata)
    console.log(`[BundleAttach] "${k.title.slice(0, 50)}" (${k.bundle_type}) → ${story ?? 'eigener Abschnitt'}`)
  }
  return items.map((i) => byId.get(i.id) ?? i)
}
