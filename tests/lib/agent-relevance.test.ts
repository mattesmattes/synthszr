/**
 * Bezugspruefung: Sie ersetzt die Moderation (Betreiber 2026-10-25). Ein Take
 * ist sofort sichtbar, wenn er sich auf den Abschnitt bezieht und den Take
 * nicht nur nacherzaehlt. Die Embeddings werden injiziert — geprueft wird die
 * Entscheidungslogik, nicht die Embedding-API.
 */
import { describe, expect, it } from 'vitest'
import { checkRelevance } from '@/lib/agents/relevance'

const settings = { relevance_min: 0.55, paraphrase_max: 0.92 }
/** Fake-Embedding: feste Vektoren je Text, damit die Cosine-Werte bekannt sind. */
function embedWith(vectors: Record<string, number[]>) {
  return async (t: string) => {
    const v = vectors[t]
    if (!v) throw new Error(`kein Vektor für ${t}`)
    return v
  }
}
// Zweidimensionale Vektoren: Cosine = cos(Winkel).
const SECTION = [1, 0]
const TAKE = [0, 1]

describe('checkRelevance', () => {
  it('haelt themenfremde Takes zurueck', async () => {
    const r = await checkRelevance({ body: 'b', sectionText: 's', takeText: 't', settings, embed: embedWith({ b: [0.3, 0.954], s: SECTION, t: [0, -1] }) })
    expect(r.hold).toBe('relevance')
    expect(r.reason).toBe('off_topic')
    expect(r.similarity).toBeCloseTo(0.3, 2)
  })

  it('haelt Nacherzaehlungen zurueck', async () => {
    // nah am Abschnitt (0,7) und sehr nah am Take (0,95)
    const r = await checkRelevance({ body: 'b', sectionText: 's', takeText: 't', settings, embed: embedWith({ b: [0.7, 0.714], s: SECTION, t: [0.45, 0.893] }) })
    expect(r.reason).toBe('paraphrase')
    expect(r.hold).toBe('relevance')
  })

  it('laesst bezogene, eigenstaendige Takes durch', async () => {
    const r = await checkRelevance({ body: 'b', sectionText: 's', takeText: 't', settings, embed: embedWith({ b: [0.7, 0.714], s: SECTION, t: TAKE }) })
    expect(r.hold).toBeNull()
    expect(r.reason).toBeNull()
    expect(r.takeSimilarity).toBeCloseTo(0.714, 2)
  })

  it('blockiert nicht, wenn die Embedding-API ausfaellt', async () => {
    const r = await checkRelevance({ body: 'b', sectionText: 's', takeText: 't', settings, embed: async () => { throw new Error('quota') } })
    expect(r.hold).toBeNull()
    expect(r.similarity).toBeNaN()
  })
})
