import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Client für die Evaluation-Modalität des Vercel AI Gateways (System-One-
 * Modell Jev von TypeSafe). Kein LLM: State + typisierte Fragen rein,
 * kalibrierte Wahrscheinlichkeiten raus — Grundlage der News-Taste-Features
 * (Spec 2026-09-29).
 *
 * Bewusst plain fetch statt @typesafe-ai/sdk oder ai@7: das Repo bleibt auf
 * ai@6, und die Gateway-Doku empfiehlt für Neucode ohnehin /v1/evaluate.
 * Es gibt genau EIN Evaluation-Modell, darum Konstante statt
 * getModelForUseCase (die Admin-Model-Config kennt nur LLMs).
 */
export const JEV_MODEL = 'typesafe-ai/jev'
const EVALUATE_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const DEFAULT_MAX_RETRIES = 4

export type EvaluateQuestion =
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }

export interface BooleanAnswer { type: 'boolean'; probability: number }
export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
// score liegt live (2026-09-29 gegen /v1/evaluate geprueft) interpoliert auf dem
// Stufenindex des criteria-Arrays (0..N-1, nicht 0..1 und nicht 1..N), und
// probabilities kommt als Record mit dem Stufenindex als String-Key ("0".."N-1"),
// kein Array. Task 3 (answersToVector) baut auf genau dieser Form auf.
export interface ScoreAnswer { type: 'score'; score: number; probabilities?: number[] | Record<string, number>; confidence?: number }
export type EvaluateAnswer = BooleanAnswer | ChoiceAnswer | ScoreAnswer

export interface EvaluateResult {
  answers: Record<string, EvaluateAnswer>
  usage: { inputTokens: number; outputTokens: number }
  costUsd: number | null
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function evaluateState(
  state: string,
  questions: Record<string, EvaluateQuestion>,
  opts: { useCase?: string; maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<EvaluateResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY fehlt in der Umgebung')
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const sleep = opts.sleep ?? defaultSleep

  let lastError = ''
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(EVALUATE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    })
    if (res.ok) {
      const body = (await res.json()) as {
        answers: Record<string, EvaluateAnswer>
        usage?: { inputTokens?: number; outputTokens?: number }
        providerMetadata?: { gateway?: { cost?: string } }
      }
      const usage = {
        inputTokens: body.usage?.inputTokens ?? 0,
        outputTokens: body.usage?.outputTokens ?? 0,
      }
      const rawCost = body.providerMetadata?.gateway?.cost
      const costUsd = rawCost !== undefined && Number.isFinite(Number(rawCost)) ? Number(rawCost) : null
      scheduleUsageLog(opts.useCase ?? 'news_taste_features', usage, costUsd)
      return { answers: body.answers, usage, costUsd }
    }
    const text = (await res.text()).slice(0, 300)
    lastError = `Gateway ${res.status}: ${text}`
    // Nur Überlast/Serverfehler sind retrybar; 4xx (außer 429) ist ein
    // Request-Problem und wird durch Wiederholen nicht besser.
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt === maxRetries) throw new Error(lastError)
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt
    await sleep(waitMs)
  }
  throw new Error(lastError) // unerreichbar, beruhigt TS
}

/**
 * Kostenzeile nach llm_usage — mit den ECHTEN Gateway-Kosten aus der Antwort
 * statt computeCostUsd (Jev steht nicht in model-pricing.ts, und die
 * Gateway-Zahl ist die tatsächlich abgerechnete). FAIL-OPEN + after()-Muster
 * wie lib/ai/usage-log.ts: fehlende Buchungszeile schlägt nie den Aufruf.
 */
function scheduleUsageLog(useCase: string, usage: { inputTokens: number; outputTokens: number }, costUsd: number | null): void {
  const write = async () => {
    try {
      const { error } = await createAdminClient().from('llm_usage').insert({
        use_case: useCase,
        model: JEV_MODEL,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cost_usd: costUsd,
      })
      if (error) console.warn('[JevUsage] Protokoll nicht geschrieben:', error.message)
    } catch (err) {
      console.warn('[JevUsage] Protokoll nicht geschrieben:', err instanceof Error ? err.message : err)
    }
  }
  try {
    after(write)
  } catch {
    void write()
  }
}
