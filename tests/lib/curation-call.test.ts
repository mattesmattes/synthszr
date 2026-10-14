import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { createCaller, estimateUsd, CallInvalidError, type AnthropicLike } from '@/lib/ai/call'

function message(content: unknown[], stop = 'tool_use'): Anthropic.Message {
  return { id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message
}
function fakeClient(responses: Array<Anthropic.Message | Error>) {
  const calls: Array<{ via: 'create' | 'stream'; params: Record<string, unknown> }> = []
  const next = () => { const r = responses.shift(); if (r instanceof Error) throw r; return r as Anthropic.Message }
  const client: AnthropicLike = {
    messages: {
      create: async (params) => { calls.push({ via: 'create', params: params as unknown as Record<string, unknown> }); return next() },
      stream: (params) => { calls.push({ via: 'stream', params: params as unknown as Record<string, unknown> }); return { finalMessage: async () => next() } },
    },
  }
  return { client, calls }
}
const TOOL: Anthropic.Tool = { name: 'report', input_schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } }
const validate = (raw: unknown) => (raw && typeof raw === 'object' && 'ok' in raw ? (raw as { ok: boolean }) : null)
const toolUse = { type: 'tool_use', id: 't', name: 'report', input: { ok: true } }

describe('callTool', () => {
  it('Haiku: erzwungenes tool_choice, kein thinking, create, strict', async () => {
    const { client, calls } = fakeClient([message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    const res = await callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 4096, thinking: false, validate })
    expect(res.result).toEqual({ ok: true }); expect(calls[0].via).toBe('create')
    expect(calls[0].params.tool_choice).toEqual({ type: 'tool', name: 'report' }); expect(calls[0].params.thinking).toBeUndefined()
    expect((calls[0].params.tools as Array<{ strict?: boolean }>)[0].strict).toBe(true); expect(res.costUsd).toBeGreaterThan(0)
  })
  it('Opus 5: auto + Anweisungsblock + adaptive + effort + stream ab 24k + gecachter Prefix', async () => {
    const { client, calls } = fakeClient([message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-opus-5' })
    await callTool({ useCase: 'curation_editor', cachedPrefix: 'P', system: 'S', user: 'U', tool: TOOL, maxTokens: 24000, effort: 'medium', validate })
    const p = calls[0].params
    expect(calls[0].via).toBe('stream'); expect(p.tool_choice).toEqual({ type: 'auto' })
    expect(p.thinking).toEqual({ type: 'adaptive' }); expect(p.output_config).toEqual({ effort: 'medium' })
    const system = p.system as Array<{ text: string; cache_control?: unknown }>
    expect(system[0]).toEqual({ type: 'text', text: 'P', cache_control: { type: 'ephemeral' } })
    expect(system[1].text).toBe('S'); expect(system[2].text).toContain('ausschließlich über das Tool „report"')
  })
  it('kein tool_use → genau ein Retry → CallInvalidError', async () => {
    const { client, calls } = fakeClient([message([{ type: 'text', text: 'nö' }], 'end_turn'), message([{ type: 'text', text: 'nö' }], 'end_turn')])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    await expect(callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, thinking: false, validate })).rejects.toBeInstanceOf(CallInvalidError)
    expect(calls).toHaveLength(2)
  })
  it('refusal → CallRefusedError mit Kategorie', async () => {
    const m = message([], 'refusal'); (m as unknown as { stop_details: unknown }).stop_details = { type: 'refusal', category: 'cyber' }
    const { client } = fakeClient([m])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-opus-5' })
    await expect(callTool({ useCase: 'curation_editor', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, validate })).rejects.toMatchObject({ name: 'CallRefusedError', category: 'cyber' })
  })
  it('400 mit „strict" → Retry ohne strict', async () => {
    const err = new Anthropic.BadRequestError(400, { error: { message: 'tools.0.strict: not supported' } }, 'strict not supported', new Headers())
    const { client, calls } = fakeClient([err, message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    const res = await callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, thinking: false, validate })
    expect(res.strictDropped).toBe(true); expect((calls[1].params.tools as Array<{ strict?: boolean }>)[0].strict).toBeUndefined()
  })
  it('estimateUsd: Opus-5-Preise; unbekanntes Modell faellt nach oben', () => {
    expect(estimateUsd('claude-opus-5', 35_000, 24_000)).toBeCloseTo((35_000 / 3.5 / 1e6) * 5 + (24_000 / 1e6) * 25, 4)
    expect(estimateUsd('claude-unbekannt', 3_500, 1_000)).toBeCloseTo((1_000 / 1e6) * 5 + (1_000 / 1e6) * 25, 6)
  })
})
