import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { evaluateState, JEV_MODEL } from '@/lib/ai/evaluate'

// Usage-Logging weg-mocken: der Client protokolliert nach Supabase, das ist
// hier nicht Testgegenstand und darf keinen Netzwerkzugriff auslösen.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))

const okBody = {
  answers: { is_event: { type: 'boolean', probability: 0.93 } },
  usage: { inputTokens: 300, outputTokens: 12 },
  providerMetadata: { gateway: { cost: '0.0000126' } },
}

describe('evaluateState', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // Echten AI_GATEWAY_API_KEY aus .env.local NICHT in Unit-Tests durchreichen
    // (siehe tests/setup.ts-Vorbild fuer Redis): sonst haengt das Testverhalten
    // vom Inhalt der lokalen Datei ab statt von den Mocks hier.
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('mappt Antwort, Usage und Gateway-Kosten', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    )
    const res = await evaluateState('some article', {
      is_event: { type: 'boolean', instructions: 'Is this a news event?' },
    })
    expect(res.answers.is_event).toEqual({ type: 'boolean', probability: 0.93 })
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 12 })
    expect(res.costUsd).toBeCloseTo(0.0000126, 10)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(JSON.parse((init as RequestInit).body as string).model).toBe(JEV_MODEL)
  })

  it('honoriert retry-after bei 429 und liefert danach die Antwort', async () => {
    const waits: number[] = []
    ;(fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(okBody), { status: 200 }))
    const res = await evaluateState('x', { is_event: { type: 'boolean', instructions: 'q' } }, {
      sleep: async (ms) => { waits.push(ms) },
    })
    expect(res.answers.is_event.type).toBe('boolean')
    expect(waits).toEqual([2000])
  })

  it('wirft bei 400 sofort (nicht retrybar) mit Body-Ausschnitt', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{"error":"bad question"}', { status: 400 }),
    )
    // [\s\S]* statt .*  mit /s-Flag: Letzteres braucht ES2018+, das tsconfig-Target
    // hier ist ES6 (tsc --noEmit schlaegt sonst mit TS1501 fehl).
    await expect(evaluateState('x', { q: { type: 'boolean', instructions: 'q' } })).rejects.toThrow(/400[\s\S]*bad question/)
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('gibt nach maxRetries erschöpften 5xx auf', async () => {
    // mockResolvedValue (statt -Once) liefert dasselbe Response-Objekt fuer
    // jeden Call zurueck; der zweite res.text() wirft dann "Body already
    // used". mockImplementation erzeugt bei jedem Call eine frische Response.
    ;(fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response('boom', { status: 503 }))
    await expect(
      evaluateState('x', { q: { type: 'boolean', instructions: 'q' } }, { maxRetries: 2, sleep: async () => {} }),
    ).rejects.toThrow(/503/)
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3) // 1 + 2 Retries
  })

  it('wirft mit Hinweis auf AI_GATEWAY_API_KEY, wenn die Umgebungsvariable fehlt', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '')
    await expect(
      evaluateState('x', { q: { type: 'boolean', instructions: 'q' } }),
    ).rejects.toThrow(/AI_GATEWAY_API_KEY/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
