import { z } from 'zod'

/**
 * Kontextbasierte Erwähnungs-QS für Lexikon-Verlinkungen.
 *
 * BETREIBER-BEFUND 2026-09-14: "Environment" (Alias von "Trainingsumgebung",
 * ein RL-Begriff) traf im Firmennamen "Environmental Protection Network" —
 * ein Allgemeinwort-Alias, das im konkreten Satz nichts mit dem Lexikon-
 * Konzept zu tun hat. Eine kuratierte Ausnahmeliste (WHOLE_WORD_ONLY) wäre
 * hier falsch: "Environment" IST im RL-Kontext ein legitimer Treffer, nur
 * diese eine Erwähnung nicht — eine globale Sperre würde auch die richtigen
 * Fälle blockieren. Betreiber-Vorgabe: JEDE Erwähnung wird einzeln anhand
 * ihres Kontexts geprüft, nicht der Begriffsname als Ganzes.
 *
 * Gleiches Muster wie lib/rankings/product-validity-qa.ts (Tool-Call,
 * konservativer Default „im Zweifel relevant"), aber andere Granularität:
 * dort wird ein PRODUKT einmalig global geprüft, hier wird jede TEXTSTELLE
 * einzeln geprüft — derselbe Begriff kann in einem Artikel korrekt und im
 * nächsten falsch sein.
 */

const LLM_TIMEOUT_MS = 20_000
const EXCLUDE_CONFIDENCE = 0.8
/** Wie viele Prüfungen gleichzeitig laufen — begrenzt Vercel-Function-Last
 *  und Anthropic-Rate-Limits bei einem Artikel mit vielen Fundstellen. */
const CONCURRENCY = 5

export interface MentionContextCandidate {
  slug: string
  name: string
  /** Kurzbeschreibung des Lexikon-Konzepts (glossary_terms.summary). */
  summary: string
  /** Der Satz/Absatz, in dem der Begriff im Artikel vorkommt. */
  excerpt: string
}

/** Pure: baut den Prüf-Prompt. Konservativ — im Zweifel „ist relevant". */
export function buildMentionContextPrompt(c: MentionContextCandidate): string {
  return `In einem Artikel soll der Begriff "${c.name}" auf einen Lexikoneintrag verlinkt werden, der Folgendes erklärt:

BEGRIFFS-DEFINITION: ${c.summary}

TEXTSTELLE (wo "${c.name}" im Artikel vorkommt):
„…${c.excerpt}…"

Manche Begriffsnamen sind zugleich Allgemeinwörter oder stecken zufällig in einem längeren Wort oder Eigennamen (z.B. "State" in "Statement", "Environment" in "Environmental Protection Network") und haben dort NICHTS mit der Begriffs-Definition oben zu tun.

Prüfe: Bezieht sich die Textstelle wirklich auf das oben definierte Konzept, oder ist "${c.name}" dort nur zufällig gleich geschrieben (anderes Wort, Namensbestandteil, andere Bedeutung)?

Antworte via Tool:
- is_relevant: true, wenn die Textstelle tatsächlich das definierte Konzept meint; false, wenn es eine zufällige Kollision ist.
- confidence: 0..1 (wie sicher).
- reasoning: ein kurzer Satz.

WICHTIG: Im Zweifel is_relevant=true. Nur bei eindeutiger Fehlbedeutung false.`
}

const DecisionSchema = z.object({
  is_relevant: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export interface MentionContextDecision { isRelevant: boolean; confidence: number; reasoning: string }

/** Pure: validiert die Tool-Antwort. Ungültig ⇒ null. */
export function parseMentionContextDecision(raw: unknown): MentionContextDecision | null {
  const p = DecisionSchema.safeParse(raw)
  if (!p.success) return null
  return { isRelevant: p.data.is_relevant, confidence: p.data.confidence, reasoning: p.data.reasoning }
}

async function decideOne(c: MentionContextCandidate): Promise<boolean> {
  // Fail-open: ohne funktionierende Prüfung lieber verlinken (bisheriges
  // Verhalten) als stumm alles zu sperren.
  if (!process.env.ANTHROPIC_API_KEY) return true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const tool = {
      name: 'judge_relevance',
      description: 'Entscheiden, ob eine Textstelle wirklich das Lexikon-Konzept meint',
      input_schema: {
        type: 'object' as const,
        properties: {
          is_relevant: { type: 'boolean' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['is_relevant', 'confidence', 'reasoning'],
      },
    }
    const model = await getModelForUseCase('glossary_mention_context_qa')
    const resp = await client.messages.create({
      model, max_tokens: 300, tools: [tool],
      tool_choice: { type: 'tool', name: 'judge_relevance' },
      messages: [{ role: 'user', content: buildMentionContextPrompt(c) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const decision = parseMentionContextDecision(block && 'input' in block ? block.input : null)
    if (!decision) return true
    if (!decision.isRelevant && decision.confidence >= EXCLUDE_CONFIDENCE) return false
    return true
  } catch {
    return true
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Prüft mehrere Kandidaten parallel (begrenzt durch CONCURRENCY) und liefert
 * die Slugs zurück, deren Fundstelle das Lexikon-Konzept tatsächlich meint.
 */
export async function filterMentionsByContext(
  candidates: MentionContextCandidate[],
): Promise<Set<string>> {
  const approved = new Set<string>()
  let i = 0
  async function worker(): Promise<void> {
    while (i < candidates.length) {
      const idx = i++
      const c = candidates[idx]
      if (await decideOne(c)) approved.add(c.slug)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker))
  return approved
}
