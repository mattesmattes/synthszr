/**
 * Modellaufrufe der Morgenkonferenz (Phase 1). WARUM eigene Schicht statt
 * createToolCall (lib/claude/tool-call.ts): die Chefredaktion braucht 24k
 * Output-Tokens — ohne Streaming lehnt SDK 0.71 ab 21.333 Tokens ab (BEFUND
 * 2026-10-14, messages.js:20-24) —, und bei Modellen mit Thinking ist erzwungenes
 * tool_choice ein 400 (Opus 5.5, Sonnet 5.5, Fable 5.1; API-Referenz 2026-09-25).
 * Hier: Streaming ab 16k, tool_choice auto + Anweisung bei Thinking, strict auf
 * dem Tool, ein Retry ohne tool_use, Refusal als Fehler.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { MODEL_PRICING } from '@/lib/ai/model-pricing'
import { computeCostUsd, extractUsage, type UsageTokens } from '@/lib/ai/usage-cost'
import { withUsageLogging } from '@/lib/ai/usage-log'
import type { UseCase } from '@/lib/ai/use-cases'
import type { RunMode } from '@/lib/curation/types'

export interface CallToolInput<T> {
  useCase: UseCase
  system: string                 // volatiler System-Teil (Tagesblock) — NICHT gecacht
  cachedPrefix?: string          // stabiler System-Teil (Rollen, Regeln, Brief-Prefix) — cache_control ephemeral
  user: string
  tool: Anthropic.Tool           // mit input_schema; strict wird von callTool gesetzt
  maxTokens: number
  effort?: 'low' | 'medium' | 'high'
  thinking?: boolean             // Default: true, wenn das Modell adaptiveThinking kann; Haiku: false
  validate: (input: unknown) => T | null
}

export interface CallToolResult<T> {
  result: T
  model: string
  tokens: UsageTokens
  costUsd: number
  retried: boolean
  strictDropped: boolean
}

export type CallToolFn = <T>(input: CallToolInput<T>) => Promise<CallToolResult<T>>

export class CallRefusedError extends Error {
  constructor(useCase: string, public readonly category: string | null) {
    super(`${useCase}: Modell hat abgelehnt (${category ?? 'ohne Kategorie'})`)
    this.name = 'CallRefusedError'
  }
}

/** Nach dem Retry (s. callTool) immer noch kein tool_use-Block oder validate() === null. */
export class CallInvalidError extends Error {
  constructor(useCase: string) {
    super(`${useCase}: keine gueltige Tool-Antwort nach Retry`)
    this.name = 'CallInvalidError'
  }
}

/** Fallback-Preis, wenn ein Modell nicht in MODEL_PRICING steht — bewusst teuer
 *  (Opus-5-Niveau), damit ein unbekanntes Modell das Budget eher zu knapp als
 *  zu großzügig reserviert (fail-closed nach oben, s. estimateUsd). */
const FALLBACK_PRICING = { input: 5, output: 25 }

/** Ab hier lehnt das SDK einen Aufruf ohne Streaming ab (s. Modul-Kommentar
 *  oben, BEFUND 2026-10-14: Limit liegt bei 21.333 Tokens) — 16k Puffer davor. */
const STREAM_FROM_TOKENS = 16_384

/** Grobe Zeichen-zu-Token-Schätzung für estimateUsd (kein Tokenizer-Aufruf). */
const CHARS_PER_TOKEN = 3.5

/** Schaetzung fuer die Reservierung: Zeichen/3.5 als Input-Tokens, maxTokens als
 *  Output. Unbekanntes Modell → FALLBACK_PRICING. */
export function estimateUsd(model: string, inputChars: number, maxTokens: number): number {
  const pricing = MODEL_PRICING[model]?.pricing ?? FALLBACK_PRICING
  const inputTokens = inputChars / CHARS_PER_TOKEN
  return (inputTokens / 1e6) * pricing.input + (maxTokens / 1e6) * pricing.output
}

export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
    stream(params: Anthropic.MessageCreateParamsNonStreaming): { finalMessage(): Promise<Anthropic.Message> }
  }
}

export interface CallerOptions {
  runId: string
  mode: RunMode
  /** Default: withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), useCase, { runId, mode }) */
  clientFactory?: (useCase: UseCase) => AnthropicLike
  /** Default: getModelForUseCase */
  modelFor?: (useCase: UseCase) => Promise<string>
  onCost?: (useCase: UseCase, costUsd: number) => void
}

export function createCaller(opts: CallerOptions): { callTool: CallToolFn; modelFor: (useCase: UseCase) => Promise<string> } {
  const modelFor = opts.modelFor ?? ((useCase: UseCase) => getModelForUseCase(useCase))
  const meta = { runId: opts.runId, mode: opts.mode }
  const clientFor = opts.clientFactory ?? ((useCase: UseCase) => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return withUsageLogging(client, useCase, meta) as unknown as AnthropicLike
  })

  const callTool: CallToolFn = async <T>(input: CallToolInput<T>): Promise<CallToolResult<T>> => {
    const model = await modelFor(input.useCase)
    const caps = getModelCapabilities(model)
    const thinking = input.thinking ?? caps.adaptiveThinking

    // WARUM forced vs. auto: erzwungenes tool_choice ({type:'tool'}) ist bei
    // Modellen MIT Thinking ein HTTP 400 (Opus 5.5, Sonnet 5.5, Fable 5.1 — s.
    // Modul-Kommentar oben). Nur wenn das Modell Forced Tool Choice kann UND
    // hier gar nicht denkt (Haiku, oder thinking explizit false), bleibt es
    // bei {type:'tool', name}; sonst {type:'auto'} plus ein dritter
    // System-Block, der das Tool per Anweisung statt per Parameter erzwingt.
    const forced = caps.supportsForcedToolChoice && !thinking
    const client = clientFor(input.useCase)

    const buildParams = (strict: boolean): Anthropic.MessageCreateParamsNonStreaming => {
      const system: Anthropic.TextBlockParam[] = []
      if (input.cachedPrefix) {
        system.push({ type: 'text', text: input.cachedPrefix, cache_control: { type: 'ephemeral' } })
      }
      system.push({ type: 'text', text: input.system })
      if (!forced) {
        system.push({ type: 'text', text: `Antworte ausschließlich über das Tool „${input.tool.name}". Kein Fließtext.` })
      }

      const params: Record<string, unknown> = {
        model,
        max_tokens: input.maxTokens,
        system,
        messages: [{ role: 'user', content: input.user }],
        tools: [strict ? { ...input.tool, strict: true } : input.tool],
        tool_choice: forced ? { type: 'tool', name: input.tool.name } : { type: 'auto' },
      }
      if (thinking && caps.adaptiveThinking) {
        params.thinking = { type: 'adaptive' }
        if (input.effort && caps.supportsEffort) params.output_config = { effort: input.effort }
      }
      return params as unknown as Anthropic.MessageCreateParamsNonStreaming
    }

    // WARUM diese Schwelle: s. STREAM_FROM_TOKENS oben — ohne Streaming lehnt
    // das SDK ab 21.333 Output-Tokens ab, 16k Puffer davor.
    const send = (params: Anthropic.MessageCreateParamsNonStreaming) =>
      input.maxTokens > STREAM_FROM_TOKENS ? client.messages.stream(params).finalMessage() : client.messages.create(params)

    let strict = true
    let strictDropped = false
    let retried = false
    let attempt = 0
    let message: Anthropic.Message | undefined
    let result: T | undefined

    // Invariante: die Schleife endet nur über `break` (message gesetzt) oder
    // einen throw (CallRefusedError, CallInvalidError, oder ein nicht
    // abgefangener Fehler) — danach ist message! unten also immer gesetzt.
    while (attempt < 2 && !message) {
      try {
        const response = await send(buildParams(strict))

        // WARUM vor der tool_use-Suche: eine Refusal-Antwort hat keinen
        // tool_use-Block, der der Suche zur Verfügung stünde — erst prüfen,
        // sonst liefe sie ins CallInvalidError statt ins spezifischere
        // CallRefusedError mit Kategorie.
        if (response.stop_reason === 'refusal') {
          const details = (response as unknown as { stop_details?: { category?: string | null } }).stop_details
          throw new CallRefusedError(input.useCase, details?.category ?? null)
        }

        const block = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === input.tool.name,
        )
        const parsed = block ? input.validate(block.input) : null
        if (parsed !== null) {
          message = response
          result = parsed
          break
        }

        attempt++
        retried = true
        if (attempt >= 2) throw new CallInvalidError(input.useCase)
      } catch (err) {
        // WARUM dieser Retry keinen tool_use-Versuch verbraucht (kein
        // attempt++): die erste Antwort war technisch kein gültiger
        // tool_use-Fehlschlag, sondern ein Parameterproblem (Modell kennt
        // `strict` auf dem Tool-Schema nicht) — der eigentliche
        // Retry-Zähler für „kein brauchbarer tool_use" bleibt unberührt.
        if (err instanceof Anthropic.BadRequestError && strict && /strict/i.test(err.message)) {
          console.warn(`[Curation] ${model}: strict abgelehnt — Retry ohne strict`)
          strict = false
          strictDropped = true
          continue
        }
        throw err
      }
    }

    const tokens = extractUsage(message!.usage) ?? ({
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    } as unknown as UsageTokens)

    // WARUM der Fallback: computeCostUsd liefert null, wenn das Modell nicht
    // in MODEL_PRICING steht (lib/ai/usage-cost.ts) — dann estimateUsd statt
    // einer erfundenen 0, damit die Budget-Reservierung nicht stillschweigend
    // zu niedrig ausfällt.
    const costUsd = computeCostUsd(model, tokens) ??
      estimateUsd(model, input.user.length + input.system.length + (input.cachedPrefix?.length ?? 0), input.maxTokens)

    opts.onCost?.(input.useCase, costUsd)

    return { result: result as T, model, tokens, costUsd, retried, strictDropped }
  }

  return { callTool, modelFor }
}
