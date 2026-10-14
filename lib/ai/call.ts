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
  useCase: UseCase; system: string; cachedPrefix?: string; user: string; tool: Anthropic.Tool
  maxTokens: number; effort?: 'low' | 'medium' | 'high'; thinking?: boolean; validate: (input: unknown) => T | null
}
export interface CallToolResult<T> { result: T; model: string; tokens: UsageTokens; costUsd: number; retried: boolean; strictDropped: boolean }
export type CallToolFn = <T>(input: CallToolInput<T>) => Promise<CallToolResult<T>>
export class CallRefusedError extends Error {
  constructor(useCase: string, public readonly category: string | null) { super(`${useCase}: Modell hat abgelehnt (${category ?? 'ohne Kategorie'})`); this.name = 'CallRefusedError' }
}
export class CallInvalidError extends Error { constructor(useCase: string) { super(`${useCase}: keine gueltige Tool-Antwort nach Retry`); this.name = 'CallInvalidError' } }

const FALLBACK_PRICING = { input: 5, output: 25 }, STREAM_FROM_TOKENS = 16_384, CHARS_PER_TOKEN = 3.5
export function estimateUsd(model: string, inputChars: number, maxTokens: number): number {
  const p = MODEL_PRICING[model]?.pricing ?? FALLBACK_PRICING
  return (inputChars / CHARS_PER_TOKEN / 1e6) * p.input + (maxTokens / 1e6) * p.output
}
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
    stream(params: Anthropic.MessageCreateParamsNonStreaming): { finalMessage(): Promise<Anthropic.Message> }
  }
}
export interface CallerOptions {
  runId: string; mode: RunMode
  clientFactory?: (useCase: UseCase) => AnthropicLike
  modelFor?: (useCase: UseCase) => Promise<string>
  onCost?: (useCase: UseCase, costUsd: number) => void
}
export function createCaller(opts: CallerOptions): { callTool: CallToolFn; modelFor: (useCase: UseCase) => Promise<string> } {
  const modelFor = opts.modelFor ?? ((u: UseCase) => getModelForUseCase(u))
  const meta = { runId: opts.runId, mode: opts.mode }
  const clientFor = opts.clientFactory ?? ((u: UseCase) => withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), u, meta) as unknown as AnthropicLike)

  const callTool: CallToolFn = async <T>(input: CallToolInput<T>): Promise<CallToolResult<T>> => {
    const model = await modelFor(input.useCase)
    const caps = getModelCapabilities(model)
    const thinking = input.thinking ?? caps.adaptiveThinking
    const forced = caps.supportsForcedToolChoice && !thinking
    const client = clientFor(input.useCase)
    const buildParams = (strict: boolean): Anthropic.MessageCreateParamsNonStreaming => {
      const system: Anthropic.TextBlockParam[] = []
      if (input.cachedPrefix) system.push({ type: 'text', text: input.cachedPrefix, cache_control: { type: 'ephemeral' } })
      system.push({ type: 'text', text: input.system })
      if (!forced) system.push({ type: 'text', text: `Antworte ausschließlich über das Tool „${input.tool.name}". Kein Fließtext.` })
      const params: Record<string, unknown> = {
        model, max_tokens: input.maxTokens, system, messages: [{ role: 'user', content: input.user }],
        tools: [strict ? { ...input.tool, strict: true } : input.tool],
        tool_choice: forced ? { type: 'tool', name: input.tool.name } : { type: 'auto' },
      }
      if (thinking && caps.adaptiveThinking) { params.thinking = { type: 'adaptive' }; if (input.effort && caps.supportsEffort) params.output_config = { effort: input.effort } }
      return params as unknown as Anthropic.MessageCreateParamsNonStreaming
    }
    const send = (p: Anthropic.MessageCreateParamsNonStreaming) => input.maxTokens > STREAM_FROM_TOKENS ? client.messages.stream(p).finalMessage() : client.messages.create(p)

    let strict = true, strictDropped = false, retried = false, attempt = 0
    let message: Anthropic.Message | undefined, result: T | undefined
    while (attempt < 2 && !message) {
      try {
        const m = await send(buildParams(strict))
        if (m.stop_reason === 'refusal') {
          const details = (m as unknown as { stop_details?: { category?: string | null } }).stop_details
          throw new CallRefusedError(input.useCase, details?.category ?? null)
        }
        const block = m.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === input.tool.name)
        const parsed = block ? input.validate(block.input) : null
        if (parsed !== null) { message = m; result = parsed; break }
        attempt++; retried = true
        if (attempt >= 2) throw new CallInvalidError(input.useCase)
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && strict && /strict/i.test(err.message)) {
          console.warn(`[Curation] ${model}: strict abgelehnt — Retry ohne strict`); strict = false; strictDropped = true; continue
        }
        throw err
      }
    }
    const tokens = extractUsage(message!.usage) ?? ({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 } as unknown as UsageTokens)
    const costUsd = computeCostUsd(model, tokens) ?? estimateUsd(model, input.user.length + input.system.length + (input.cachedPrefix?.length ?? 0), input.maxTokens)
    opts.onCost?.(input.useCase, costUsd)
    return { result: result as T, model, tokens, costUsd, retried, strictDropped }
  }
  return { callTool, modelFor }
}
