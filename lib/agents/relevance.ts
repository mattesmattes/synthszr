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
  /** Bericht der Meldung; fehlt er, prüft die Paraphrasen-Sperre nur gegen den Take. */
  reportText?: string
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
  /** Cosine Take ↔ Bericht der Meldung; NaN ohne Bericht oder bei Ausfall. */
  reportSimilarity: number
}

export async function checkRelevance(i: RelevanceInput): Promise<RelevanceResult> {
  const embed = i.embed ?? generateEmbedding
  try {
    const [body, section, take, report] = await Promise.all([
      embed(i.body.slice(0, MAX_CHARS)),
      embed(i.sectionText.slice(0, MAX_CHARS)),
      embed(i.takeText.slice(0, MAX_CHARS)),
      i.reportText ? embed(i.reportText.slice(0, MAX_CHARS)) : Promise.resolve(null),
    ])
    const similarity = cosineSimilarity(body, section)
    const takeSimilarity = cosineSimilarity(body, take)
    const reportSimilarity = report ? cosineSimilarity(body, report) : NaN
    const scores = { similarity, takeSimilarity, reportSimilarity }
    if (similarity < i.settings.relevance_min) {
      return { hold: 'relevance', reason: 'off_topic', ...scores }
    }
    // Agenten kommentieren die Meldung, nicht nur den Take (Betreiber
    // 2026-11-04): eine Nacherzählung des Berichts wartet wie eine des Takes.
    if (takeSimilarity > i.settings.paraphrase_max || reportSimilarity > i.settings.paraphrase_max) {
      return { hold: 'relevance', reason: 'paraphrase', ...scores }
    }
    return { hold: null, reason: null, ...scores }
  } catch (err) {
    console.error('[Agents] Bezugsprüfung ausgefallen, Take passiert ungeprüft:', err instanceof Error ? err.message : err)
    return { hold: null, reason: null, similarity: NaN, takeSimilarity: NaN, reportSimilarity: NaN }
  }
}
