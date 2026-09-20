/**
 * Protokollierung jedes Modellaufrufs (Betreiber-Auftrag 2026-09-20).
 *
 * Die wichtigste Eigenschaft ist die Harmlosigkeit: Das Logging hängt an JEDEM
 * Anthropic-Aufruf der Anwendung. Fällt die Tabelle aus, ist der Ghostwriter
 * trotzdem fertig zu schreiben — ein Buchhaltungsproblem darf keinen
 * Produktionsausfall erzeugen.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as any[], insertError: null as unknown, throwOnFrom: false }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (state.throwOnFrom) throw new Error('kein Supabase')
    return {
      from: () => ({
        insert: async (row: any) => { state.rows.push(row); return { error: state.insertError } },
      }),
    }
  },
}))

import { logLlmUsage, withUsageLogging } from '@/lib/ai/usage-log'

const usage = { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 40_000 }

beforeEach(() => {
  state.rows = []
  state.insertError = null
  state.throwOnFrom = false
})

describe('logLlmUsage', () => {
  it('schreibt Tokens, Modell, Use Case und Kosten', async () => {
    await logLlmUsage('ghostwriter', 'claude-opus-5', usage, { jobId: 'j1' })
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({
      use_case: 'ghostwriter',
      model: 'claude-opus-5',
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_tokens: 40_000,
      meta: { jobId: 'j1' },
    })
    expect(state.rows[0].cost_usd).toBeCloseTo(1000 * 5e-6 + 2000 * 25e-6 + 40_000 * 0.5e-6, 9)
  })

  it('schreibt unbekannte Modelle mit cost_usd = null statt sie zu verwerfen', async () => {
    await logLlmUsage('enrich', 'neues-modell-2027', usage)
    expect(state.rows[0]).toMatchObject({ model: 'neues-modell-2027', cost_usd: null, input_tokens: 1000 })
  })

  it('schreibt nichts, wenn die Antwort kein usage enthielt', async () => {
    await logLlmUsage('enrich', 'claude-opus-5', undefined)
    expect(state.rows).toHaveLength(0)
  })

  it('schluckt DB-Fehler', async () => {
    state.insertError = { message: 'relation llm_usage does not exist' }
    await expect(logLlmUsage('enrich', 'claude-opus-5', usage)).resolves.toBeUndefined()
  })

  it('schluckt auch einen kaputten Client', async () => {
    state.throwOnFrom = true
    await expect(logLlmUsage('enrich', 'claude-opus-5', usage)).resolves.toBeUndefined()
  })
})

describe('withUsageLogging', () => {
  function fakeClient(response: unknown) {
    return {
      messages: {
        create: vi.fn(async () => response),
        stream: vi.fn(() => {
          const handlers: Record<string, (m: unknown) => void> = {}
          return {
            on(event: string, cb: (m: unknown) => void) { handlers[event] = cb; return this },
            emitFinal(msg: unknown) { handlers.finalMessage?.(msg) },
          }
        }),
      },
    }
  }

  it('protokolliert messages.create und reicht die Antwort unverändert durch', async () => {
    const response = { content: [{ type: 'text', text: 'hi' }], usage }
    const client = withUsageLogging(fakeClient(response) as any, 'glossary_generation')
    const result = await client.messages.create({ model: 'claude-opus-5' } as any)
    expect(result).toBe(response)
    expect(state.rows[0]).toMatchObject({ use_case: 'glossary_generation', model: 'claude-opus-5', output_tokens: 2000 })
  })

  it('nimmt das Modell aus der Antwort, wenn die Parameter keins nennen', async () => {
    const client = withUsageLogging(fakeClient({ model: 'claude-sonnet-5', usage }) as any, 'proofreading')
    await client.messages.create({} as any)
    expect(state.rows[0]).toMatchObject({ model: 'claude-sonnet-5' })
  })

  it('protokolliert Streams über finalMessage', async () => {
    const client = withUsageLogging(fakeClient(null) as any, 'ghostwriter')
    const stream = client.messages.stream({ model: 'claude-opus-5' } as any) as any
    expect(state.rows).toHaveLength(0)
    stream.emitFinal({ usage })
    await vi.waitFor(() => expect(state.rows).toHaveLength(1))
    expect(state.rows[0]).toMatchObject({ use_case: 'ghostwriter', model: 'claude-opus-5' })
  })

  it('lässt einen Fehler des Modellaufrufs unverändert durch', async () => {
    const client = withUsageLogging({
      messages: { create: vi.fn(async () => { throw new Error('529 overloaded') }) },
    } as any, 'ghostwriter')
    await expect(client.messages.create({} as any)).rejects.toThrow('529 overloaded')
    expect(state.rows).toHaveLength(0)
  })
})
