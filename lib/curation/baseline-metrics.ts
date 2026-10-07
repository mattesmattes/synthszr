/**
 * Reine Metriken für die Baseline-Messung der Kuratierung (Phase 0).
 *
 * BEFUND 2026-10-06 (Spec „Evaluation und Gate → Treffer-Währung"): Ein
 * veröffentlichter Abschnitt trägt bis zu fünf Queue-IDs (published_units.
 * member_ids), eine Baseline rankt einzelne Items. Auf ID-Ebene trifft eine
 * Baseline nur, wenn sie exakt eine Member-ID zieht — eine andere Quelle
 * derselben Meldung wäre ein Fehltreffer, und 5-Quellen-Einheiten wären
 * systematisch im Vorteil gegenüber Einzelmeldungen. Deshalb zählt die
 * Story-Ebene: gerankte IDs und Member-IDs werden über dieselbe Clusterung
 * wie die Dedup (clusterByEmbedding, Schwelle 0,8) einem Story-Schlüssel
 * zugeordnet; Treffer = gleicher Schlüssel. Die strenge ID-Variante läuft
 * daneben mit (idRecallAtK), damit die Brücke zu scripts/reranker-baseline.json
 * und gate_comparison bleibt.
 *
 * Betreiber-Vorgabe 2026-10-05 (Spec „Entscheidungsregel"): Shadow → Assist
 * nur bei Unit-Recall@20 ≥ total_score-Top-20 + 0,10 mit gepaartem Bootstrap
 * der Tagesdifferenzen (90-%-Intervall > 0) und Dubletten-Rate 0; Phase 0
 * schätzt aus den Baseline-Tagen Streuung und MDE bei n=20/30. Die Funktionen
 * hier sind die einzige Rechenstelle dafür — ohne Supabase, ohne LLM, damit
 * scripts/measure-curation-baseline.ts (Task 15) nur noch lädt und aufruft.
 *
 * Konventionen: eine ID ohne Eintrag in storyOf ist ihr eigener Schlüssel
 * (Techmeme-Items ohne daily_repo_id haben kein Embedding und landen so als
 * eigener Cluster); keine Daten → NaN (JSON: null), nie 0 — eine 0 sähe im
 * Baseline-JSON wie „Effekt 0, sicher" aus.
 */
import { clusterByEmbedding } from '@/lib/news-queue/semantic-dedup'
import { recallAtK } from '@/lib/news-queue/metrics'

/**
 * Story-Schlüssel je ID über die Dedup-Clusterung. `ids` bestimmt die Reihenfolge
 * (Greedy: das zuerst gelistete Item eines Clusters wird der Schlüssel); eine ID
 * ohne Embedding ist ihr eigener Cluster (clusterByEmbedding behält sie immer).
 */
export function assignStoryKeys(
  ids: string[],
  embeddings: Map<string, number[]>,
  threshold: number
): Map<string, string> {
  // WARUM Dedup: der Aufrufer vereinigt gerankte IDs und Member-IDs, ein direkter
  // ID-Treffer steht also zweimal in der Liste. Das zweite Vorkommen würde gegen
  // die inzwischen größere kept-Menge geclustert (semantic-dedup.ts:98-109 nimmt
  // den ähnlichsten aktuell behaltenen Anführer) und den ersten Schlüssel
  // überschreiben — der Rest des ursprünglichen Clusters bliebe beim alten.
  const uniq = [...new Set(ids)]
  const items = uniq.map(id => ({ id, title: id }))
  const vectors = uniq.map(id => embeddings.get(id) ?? [])
  const { kept, dropped } = clusterByEmbedding(items, vectors, threshold)
  const keys = new Map<string, string>()
  for (const k of kept) keys.set(k.id, k.id)
  // WARUM similarTo: ohne prior-Embeddings ist jeder Drop ein 'batch'-Drop,
  // similarTo ist dann die ID des behaltenen Items (semantic-dedup.ts:109).
  for (const d of dropped) keys.set(d.id, d.similarTo)
  return keys
}

/** Schlüssel einer ID; ohne Cluster-Eintrag ist die ID selbst der Schlüssel. */
function keyOf(id: string, storyOf: Map<string, string>): string {
  return storyOf.get(id) ?? id
}

/**
 * Unit-Recall@K auf Story-Ebene: Anteil der veröffentlichten Einheiten, von
 * denen mindestens ein Member im selben Cluster liegt wie eine der Top-K-IDs.
 * total = alle Einheiten, auch ohne memberIds (Altbestand ohne Marker) — die
 * auf Pool-Abdeckung normierte Variante bildet der Aufrufer aus hits.
 */
export function unitRecallAtK(
  rankedIds: string[],
  k: number,
  units: Array<{ memberIds: string[] }>,
  storyOf: Map<string, string>
): { hits: number; total: number; recall: number } {
  const topKeys = new Set(rankedIds.slice(0, k).map(id => keyOf(id, storyOf)))
  let hits = 0
  for (const unit of units) {
    if (unit.memberIds.some(m => topKeys.has(keyOf(m, storyOf)))) hits++
  }
  const total = units.length
  return { hits, total, recall: total === 0 ? 0 : hits / total }
}

/** Strenge ID-Variante: Anteil der veröffentlichten Member-IDs in den Top-K (Brücke zu metrics.ts). */
export function idRecallAtK(rankedIds: string[], k: number, publishedIds: Set<string>): number {
  return recallAtK(rankedIds, publishedIds, k)
}

/**
 * Setzlisten-Precision@K = Überlebensquote: Anteil der Top-K-IDs, deren
 * Story-Schlüssel in einer veröffentlichten Einheit vorkommt (Referenz heute
 * 42 %, Spec „Metriken je Tag"). Nenner ist die betrachtete Listenlänge
 * (min(K, Länge)) — die Handauswahl hat 21–38 Items, Nachtlauf-Drafts auch
 * mal 13; eine kürzere Liste darf nicht als Fehltreffer zählen.
 */
export function precisionAtK(
  rankedIds: string[],
  k: number,
  units: Array<{ memberIds: string[] }>,
  storyOf: Map<string, string>
): number {
  const topK = rankedIds.slice(0, k)
  if (topK.length === 0) return 0
  const unitKeys = new Set<string>()
  for (const u of units) for (const m of u.memberIds) unitKeys.add(keyOf(m, storyOf))
  let hits = 0
  for (const id of topK) if (unitKeys.has(keyOf(id, storyOf))) hits++
  return hits / topK.length
}

/**
 * Dubletten-Rate einer Auswahl: Anteil der IDs, deren Story-Schlüssel bereits
 * von einer früheren ID der Liste belegt ist. Gate-Regel (4): für die
 * Setzliste muss sie 0 sein.
 */
export function duplicateRate(ids: string[], storyOf: Map<string, string>): number {
  if (ids.length === 0) return 0
  const distinct = new Set(ids.map(id => keyOf(id, storyOf)))
  return (ids.length - distinct.size) / ids.length
}

/**
 * Seeded PRNG (mulberry32, 32-Bit-Zustand). WARUM kein Math.random: Bootstrap
 * und Zufalls-Baseline müssen bei gleichem Seed dasselbe Baseline-JSON
 * erzeugen, sonst ist jeder Diff in scripts/curation-baseline.json Rauschen.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Quantile mit linearer Interpolation an Position q·(n−1) (R-Typ 7, wie
 * NumPy-Default); q wird auf [0,1] geklemmt. Ohne Daten NaN je q.
 */
export function quantiles(values: number[], qs: number[]): number[] {
  if (values.length === 0) return qs.map(() => NaN)
  const sorted = [...values].sort((a, b) => a - b)
  const last = sorted.length - 1
  return qs.map(q => {
    const pos = Math.min(Math.max(q, 0), 1) * last
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
  })
}

/**
 * Gepaarter Perzentil-Bootstrap der Tagesdifferenzen (z. B. Hand − total_score):
 * `iterations` Resamples mit Zurücklegen, Intervall = Quantile 0,05/0,95 der
 * Resample-Mittelwerte. Gate-Regel (1) verlangt lo90 > 0. Ohne Daten NaN.
 */
export function pairedBootstrap(
  diffs: number[],
  iterations: number = 2000,
  seed: number = 42
): { mean: number; lo90: number; hi90: number } {
  const n = diffs.length
  if (n === 0) return { mean: NaN, lo90: NaN, hi90: NaN }
  const mean = diffs.reduce((sum, d) => sum + d, 0) / n
  const rand = mulberry32(seed)
  const means: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += diffs[Math.floor(rand() * n)]
    means[i] = sum / n
  }
  const [lo90, hi90] = quantiles(means, [0.05, 0.95])
  return { mean, lo90, hi90 }
}

/**
 * Effektschwelle bei n gepaarten Tagen: z·sd/√n. Spec: „weist den minimal
 * nachweisbaren Effekt bei n=20/30 aus".
 *
 * ACHTUNG: Mit dem Default z = 1,645 ist das die Detektionsschwelle bei 50 %
 * Power — die halbe Breite des einseitigen 95-%-Tests, den das Gate
 * (90-%-Intervall > 0) impliziert. Sie deckt nur α ab: ein echter Effekt genau
 * dieser Größe wird nur in jedem zweiten Fall entdeckt. Für den MDE im
 * üblichen Sinn (80 % Power) übergibt der Aufrufer z = 1,645 + 0,8416.
 * WARUM das zählt: die Gate-Schwelle +0,10 wird nach Phase 0 an diesem Wert
 * kalibriert (Spec OE 7); bei sd 0,2 / n 20 meldet der Default 0,074, der
 * 80-%-MDE aber 0,111 — die Aussage über +0,10 kippt. Default bleibt laut
 * Vertrag 2.10; scripts/measure-curation-baseline.ts weist beide Werte aus.
 */
export function mdeAtN(sd: number, n: number, z: number = 1.645): number {
  if (n <= 0) return NaN
  return (z * sd) / Math.sqrt(n)
}
