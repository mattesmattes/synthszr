/**
 * Story-Schluessel fuer den Tages-Pool (Task 5): jedem Item eine Cluster-ID
 * zuordnen, unter der Scout (Task 6), Archivar (Task 7) und Redakteur
 * (Task 8) dieselbe Nachricht wiedererkennen.
 *
 * Reihenfolge der Anfuehrer-Kandidaten (Vertrag 3.4): Hand-Items zuerst
 * (total_score absteigend), dann die Anfuehrer der Techmeme-Stories, dann
 * der Rest (total_score absteigend). WARUM diese Reihenfolge: clusterByEmbedding
 * ist ein GREEDY-Algorithmus — das erste Item in `ordered` gewinnt den Cluster.
 * Ein Hand-Item ist eine Betreiber-Entscheidung und muss daher auch dann
 * fuehren, wenn ein Pipeline-Item einen hoeheren total_score hat (Test 1).
 * Techmeme-Stories sind bereits redaktionell vorgeclustert (Techmeme selbst
 * fasst Quellen zusammen) und ziehen daher VOR dem restlichen Pool, damit ein
 * Pipeline-Item, das dieselbe Nachricht meldet, an ihrem Anfuehrer haengt statt
 * umgekehrt einen Techmeme-Anfuehrer an sich zu binden.
 */
import { clusterByEmbedding, DEFAULT_DEDUP_THRESHOLD } from '@/lib/news-queue/semantic-dedup'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import type { ClusterResult, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

/** Untere Schwelle fuer `related`-Paare — ab hier ist zwei Items dasselbe Thema wahrscheinlich, aber nicht sicher genug fuer denselben Cluster. */
const RELATED_MIN = 0.65
/** Harte Obergrenze der `related`-Liste (Vertrag 3.4), damit der Compose-Prompt (Task 8) nicht mit Paaren eines sehr grossen Pools ueberquillt. */
const RELATED_MAX_PAIRS = 40

/**
 * Ordnet jedem Pool-Item einen story_key zu: Hand-Items und Techmeme-Stories
 * fuehren vor Pipeline-Items, Mitglieder einer Techmeme-Story bekommen den
 * Key ihres Anfuehrers OHNE eigenen Embedding-Vergleich (Techmeme hat sie
 * schon als eine Story gruppiert — ein Embedding-Vergleich koennte sie
 * faelschlich wieder auseinanderreissen). Liefert zusaetzlich `related`:
 * Paare knapp UNTER der Cluster-Schwelle, als Hinweis fuer den Redakteur.
 */
export function clusterPool(
  snapshot: PoolSnapshot,
  embeddings: Map<string, number[]>,
  threshold: number = DEFAULT_DEDUP_THRESHOLD,
): ClusterResult {
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))
  const byScoreDesc = (a: PoolSnapshotItem, b: PoolSnapshotItem) => b.total_score - a.total_score

  const storyKeyOf: Record<string, string> = {}
  const clusters: Record<string, string[]> = {}

  // Techmeme-Stories vor-clustern: Key 'tm:<story>', Anfuehrer = Mitglied mit
  // hoechstem total_score. WARUM ohne Embedding-Vergleich: die Gruppierung
  // steht schon fest (snapshot.techmemeStories, aus techmemeStoriesOf) — ein
  // Mitglied ohne eigenes Embedding (Test 2: t1) darf deshalb trotzdem seinen
  // Story-Key bekommen.
  const leaderIdOfStory = new Map<string, string>()
  for (const story of snapshot.techmemeStories) {
    const members = story.member_ids.map((id) => itemById.get(id)).filter((m): m is PoolSnapshotItem => !!m).sort(byScoreDesc)
    if (members.length === 0) continue
    const storyKey = `tm:${story.story}`
    const leader = members[0]
    leaderIdOfStory.set(leader.id, storyKey)
    clusters[storyKey] = members.map((m) => m.id)
    for (const member of members) storyKeyOf[member.id] = storyKey
  }

  // Anfuehrer-Kandidaten in Rangfolge: Hand (ohne schon vergebenen Techmeme-Key) → Techmeme-Anfuehrer → Rest.
  const handLeaders = snapshot.items.filter((item) => item.hand && !storyKeyOf[item.id]).sort(byScoreDesc)
  const techmemeLeaders = snapshot.items.filter((item) => leaderIdOfStory.has(item.id))
  const restItems = snapshot.items.filter((item) => !item.hand && !storyKeyOf[item.id]).sort(byScoreDesc)
  const ordered = [...handLeaders, ...techmemeLeaders, ...restItems]

  // clusterByEmbedding behandelt ein leeres Embedding als „immer behalten,
  // nie Anfuehrer eines anderen" — so werden Items ohne Embedding automatisch
  // ihr eigener Cluster (Test 3: 'c').
  const orderedEmbeddings = ordered.map((item) => embeddings.get(item.id) ?? [])
  const clustered = clusterByEmbedding(ordered, orderedEmbeddings, threshold)

  for (const kept of clustered.kept) {
    // Ein Techmeme-Anfuehrer behaelt seinen 'tm:<story>'-Key, auch wenn er
    // hier als eigener Cluster-Anfuehrer erscheint; alle anderen Anfuehrer
    // fuehren unter ihrer eigenen ID.
    const storyKey = leaderIdOfStory.get(kept.id) ?? kept.id
    storyKeyOf[kept.id] = storyKey
    clusters[storyKey] ??= [kept.id]
  }
  for (const drop of clustered.dropped) {
    // `similarTo` ist die ID des Anfuehrers, an den clusterByEmbedding
    // angehaengt hat (bereits oben mit seinem story_key versehen).
    const storyKey = storyKeyOf[drop.similarTo] ?? drop.similarTo
    storyKeyOf[drop.id] = storyKey
    ;(clusters[storyKey] ??= []).push(drop.id)
  }

  // related: Paare zwischen den KEPT-Anfuehrern, die knapp unter der
  // Cluster-Schwelle liegen (0,65 <= sim < threshold) — ein Hinweis fuer den
  // Redakteur, nicht genug Aehnlichkeit fuer automatisches Zusammenlegen.
  const leaderIds = clustered.kept.map((kept) => kept.id)
  const related: Array<[string, string, number]> = []
  for (let i = 0; i < leaderIds.length; i++) {
    const embeddingA = embeddings.get(leaderIds[i])
    if (!embeddingA?.length) continue
    for (let j = i + 1; j < leaderIds.length; j++) {
      const embeddingB = embeddings.get(leaderIds[j])
      if (!embeddingB?.length) continue
      const similarity = cosineSimilarity(embeddingA, embeddingB)
      if (similarity < RELATED_MIN || similarity >= threshold) continue
      related.push([storyKeyOf[leaderIds[i]], storyKeyOf[leaderIds[j]], Number(similarity.toFixed(3))])
    }
  }
  related.sort((a, b) => b[2] - a[2])

  return { storyKeyOf, clusters, related: related.slice(0, RELATED_MAX_PAIRS) }
}

/**
 * Story-Key → ALLE Member einer Hand-Story, auch Pipeline-Quellen, die an den
 * Hand-Anfuehrer angehaengt haben. WARUM ueber handIds statt ueber ein
 * is_hand-Flag je Member: nur das urspruengliche Hand-Item markiert eine
 * Story als Hand-Story, Pipeline-Mitglieder bleiben Pipeline-Items, die nur
 * zufaellig in derselben Story stecken.
 */
export function handStoriesOf(snapshot: PoolSnapshot, cluster: ClusterResult): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const id of snapshot.handIds) {
    const storyKey = cluster.storyKeyOf[id]
    if (!storyKey || out[storyKey]) continue
    out[storyKey] = cluster.clusters[storyKey] ?? [id]
  }
  return out
}

/** Anfuehrer-ID eines Story-Keys — per Konvention das erste Mitglied im Cluster. */
export function leaderOf(cluster: ClusterResult, storyKey: string): string {
  return cluster.clusters[storyKey]?.[0] ?? storyKey
}
