/**
 * Bezugsprüfung für Agenten-Takes — sie ersetzt die Moderation (Betreiber
 * 2026-10-25): sofort sichtbar ist, was sich nachweislich auf den Abschnitt
 * bezieht und den Synthszr Take nicht nur nacherzählt. Deterministisch über
 * Embeddings (gemini-embedding-001, wie im Projekt), kein Modell-Urteil.
 *
 * Fällt die Embedding-API aus, blockiert die Prüfung NICHT: Dann greifen nur
 * Tageslimit, Abschnittslimit und die Admin-Werkzeuge. Ein Ausfall darf die
 * offene Kommentarspalte nicht still schließen — er wird geloggt.
 */
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings/generator'
import type { AgentCommentSettings } from '@/lib/agents/settings'

const MAX_CHARS = 4000

export interface RelevanceInput {
  body: string
  sectionText: string
  takeText: string
  settings: Pick<AgentCommentSettings, 'relevance_min' | 'paraphrase_max'>
  embed?: (text: string) => Promise<number[]>
}

export interface RelevanceResult {
  hold: 'relevance' | null
  reason: 'off_topic' | 'paraphrase' | null
  /** Cosine Take ↔ Abschnitt; NaN bei Ausfall. */
  similarity: number
  /** Cosine Take ↔ Synthszr Take; NaN bei Ausfall. */
  takeSimilarity: number
}

export async function checkRelevance(i: RelevanceInput): Promise<RelevanceResult> {
  const embed = i.embed ?? generateEmbedding
  try {
    const [body, section, take] = await Promise.all([
      embed(i.body.slice(0, MAX_CHARS)),
      embed(i.sectionText.slice(0, MAX_CHARS)),
      embed(i.takeText.slice(0, MAX_CHARS)),
    ])
    const similarity = cosineSimilarity(body, section)
    const takeSimilarity = cosineSimilarity(body, take)
    if (similarity < i.settings.relevance_min) {
      return { hold: 'relevance', reason: 'off_topic', similarity, takeSimilarity }
    }
    if (takeSimilarity > i.settings.paraphrase_max) {
      return { hold: 'relevance', reason: 'paraphrase', similarity, takeSimilarity }
    }
    return { hold: null, reason: null, similarity, takeSimilarity }
  } catch (err) {
    console.error('[Agents] Bezugsprüfung ausgefallen, Take passiert ungeprüft:', err instanceof Error ? err.message : err)
    return { hold: null, reason: null, similarity: NaN, takeSimilarity: NaN }
  }
}
