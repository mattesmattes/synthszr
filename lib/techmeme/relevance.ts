/**
 * Trennt AI-relevante Techmeme-Stories von reiner Consumer-Elektronik.
 *
 * Techmeme deckt die ganze Tech-Branche ab — neue Telefone, Gaming-Hardware,
 * Streaming-Deals. Für Synthszr zählt davon nur, was mit KI zu tun hat.
 *
 * EIN AUFRUF FÜR ALLE STORIES, nicht einer je Story: Die Entscheidung fällt
 * leichter im Vergleich („welche dieser zwanzig gehören dazu?") als isoliert,
 * und sie kostet ein Zwanzigstel.
 *
 * Fällt der Aufruf aus, gelten ALLE Stories als relevant. Ein Filter, der bei
 * Störung alles verwirft, ließe den Job stillschweigend leerlaufen — die
 * Bewertung in der Queue sortiert später ohnehin nach Relevanz.
 */
import { z } from 'zod'

const VerdictSchema = z.object({
  keep: z.array(z.number().int()),
})

const RELEVANCE_TOOL = {
  name: 'report_relevant',
  description: 'Meldet die Nummern der KI-relevanten Meldungen',
  input_schema: {
    type: 'object' as const,
    properties: {
      keep: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Nummern der Meldungen, die ins KI-Ressort gehören',
      },
    },
    required: ['keep'],
  },
}

export function buildRelevancePrompt(headlines: string[]): string {
  return `Hier sind Schlagzeilen eines Tech-Nachrichtenaggregators. Welche gehören in ein Ressort, das über KÜNSTLICHE INTELLIGENZ berichtet?

AUFNEHMEN:
- Modelle, Training, Forschung, Benchmarks
- KI-Infrastruktur: Rechenzentren, Beschleuniger, Chips für KI-Lasten, Energie dafür
- KI-Wirtschaft: Finanzierungen, Übernahmen, Umsätze, Personal von KI-Anbietern
- KI-Regulierung, Urheberrecht an Trainingsdaten, Sicherheit
- Agenten, Entwicklerwerkzeuge mit KI-Kern
- Anwendungen, bei denen die KI der Kern der Meldung ist

NICHT AUFNEHMEN:
- Reine Consumer-Elektronik ohne KI-Substanz: neue Telefone, Uhren, Kopfhörer,
  Gaming-Hardware, Fernseher
- Streaming-, Abo- und Vertriebsmeldungen ohne KI-Bezug
- Firmenpolitik, Prozesse, Aktienkurse ohne KI-Bezug
- Krypto, sofern es nicht um KI geht

GRENZFALL — so entscheiden: Ein Consumer-Gerät gehört DANN dazu, wenn die
KI-Funktion die Meldung TRÄGT (etwa ein neuer Chip für Modelle auf dem Gerät,
ein Sprachassistent auf neuer Modellbasis). Geht es dagegen um Preis, Design,
Kamera oder Verfügbarkeit, gehört es nicht dazu — auch wenn "AI" im Text steht.

Im Zweifel AUFNEHMEN.

MELDUNGEN:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Antworte via Tool mit keep: den Nummern der aufzunehmenden Meldungen.`
}

export interface RelevanceResult {
  /** Indizes (0-basiert) der relevanten Stories. */
  keepIndices: number[]
  /** Lief die Prüfung tatsächlich, oder gilt der Rückfall „alles behalten"? */
  filtered: boolean
}

export async function filterRelevantStories(headlines: string[]): Promise<RelevanceResult> {
  const alle = headlines.map((_, i) => i)
  if (headlines.length === 0) return { keepIndices: [], filtered: true }
  if (!process.env.ANTHROPIC_API_KEY) return { keepIndices: alle, filtered: false }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('glossary_candidate_identification')

    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [RELEVANCE_TOOL],
      tool_choice: { type: 'tool', name: RELEVANCE_TOOL.name },
      messages: [{ role: 'user', content: buildRelevancePrompt(headlines) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const parsed = VerdictSchema.safeParse(block && 'input' in block ? block.input : null)
    if (!parsed.success) return { keepIndices: alle, filtered: false }

    // 1-basierte Nummern aus dem Prompt zurück auf Indizes, Ausreißer verwerfen.
    const keep = parsed.data.keep
      .map((n) => n - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < headlines.length)
    return { keepIndices: [...new Set(keep)].sort((a, b) => a - b), filtered: true }
  } catch (err) {
    console.error('[TechmemeRelevance] Pruefung fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { keepIndices: alle, filtered: false }
  }
}
