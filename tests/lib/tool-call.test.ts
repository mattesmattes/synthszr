/**
 * createToolCall: ein Aufruf, der genau ein Tool aufrufen soll — auch auf
 * Modellen, die erzwungenes tool_choice ablehnen (Opus 5.5, Fable 5.1).
 *
 * PROD-BEFUND 2026-09-27: Wochenrueckblick und Lexikon-Lesbarkeits-Check
 * scheiterten auf claude-opus-5-5 mit HTTP 400, weil 22 Aufrufe im Projekt
 * `tool_choice: { type: 'tool' }` fest verdrahtet hatten.
 */
import { describe, expect, it, vi } from 'vitest'
import { createToolCall, ALWAYS_THINKING_MIN_TOKENS } from '@/lib/claude/tool-call'

const TOOL = { name: 'report', description: 'x', input_schema: { type: 'object' as const, properties: {} } }

const toolUse = { type: 'tool_use', id: 't1', name: 'report', input: { ok: true } }
const textOnly = { type: 'text', text: 'Hier ist meine Antwort ohne Tool.' }

function fakeClient(...responses: Array<{ content: unknown[] }>) {
  const create = vi.fn()
  for (const r of responses) create.mockResolvedValueOnce(r)
  return { client: { messages: { create } }, create }
}

describe('createToolCall', () => {
  it('reicht die Parameter bei Modellen mit erzwungenem tool_choice unveraendert durch', async () => {
    const { client, create } = fakeClient({ content: [toolUse] })
    const params = {
      model: 'claude-opus-5', max_tokens: 300, tools: [TOOL],
      tool_choice: { type: 'tool' as const, name: 'report' },
      messages: [{ role: 'user' as const, content: 'hi' }],
    }
    await createToolCall(client as never, params, { signal: undefined })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toBe(params)
    expect(create.mock.calls[0][1]).toEqual({ signal: undefined })
  })

  it('stellt Opus 5.5 auf auto um, steuert das Tool per Systemprompt an und setzt effort low', async () => {
    const { client, create } = fakeClient({ content: [toolUse] })
    await createToolCall(client as never, {
      model: 'claude-opus-5-5', max_tokens: 300, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      system: 'Du bist Moderator.',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const sent = create.mock.calls[0][0]
    expect(sent.tool_choice).toEqual({ type: 'auto' })
    expect(sent.system).toContain('Du bist Moderator.')
    expect(sent.system).toContain('„report“')
    expect(sent.output_config).toEqual({ effort: 'low' })
    // Thinking laeuft immer mit und zaehlt gegen max_tokens — 300 wuerde der
    // Tool-Aufruf nach dem Denken nicht mehr erreichen.
    expect(sent.max_tokens).toBe(ALWAYS_THINKING_MIN_TOKENS)
  })

  it('haengt die Anweisung an einen Block-Systemprompt an, ohne den gecachten Block zu veraendern', async () => {
    const { client, create } = fakeClient({ content: [toolUse] })
    const cached = { type: 'text' as const, text: 'Langer Prompt', cache_control: { type: 'ephemeral' as const } }
    await createToolCall(client as never, {
      model: 'claude-opus-5-5', max_tokens: 8192, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      system: [cached],
      messages: [{ role: 'user', content: 'hi' }],
    })
    const sent = create.mock.calls[0][0]
    expect(sent.system[0]).toBe(cached)
    expect(sent.system).toHaveLength(2)
    expect(sent.system[1].text).toContain('„report“')
    expect(sent.max_tokens).toBe(8192)
  })

  it('laesst ein vom Aufrufer gesetztes effort stehen', async () => {
    const { client, create } = fakeClient({ content: [toolUse] })
    await createToolCall(client as never, {
      model: 'claude-opus-5-5', max_tokens: 8192, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'high' },
    } as never)
    expect(create.mock.calls[0][0].output_config).toEqual({ effort: 'high' })
  })

  it('versucht es einmal erneut, wenn das Modell unter auto kein Tool aufruft', async () => {
    const { client, create } = fakeClient({ content: [textOnly] }, { content: [toolUse] })
    const res = await createToolCall(client as never, {
      model: 'claude-opus-5-5', max_tokens: 300, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(create).toHaveBeenCalledTimes(2)
    expect(res.content).toEqual([toolUse])
  })

  it('wiederholt NICHT bei Modellen mit erzwungenem tool_choice', async () => {
    const { client, create } = fakeClient({ content: [textOnly] })
    await createToolCall(client as never, {
      model: 'claude-opus-5', max_tokens: 300, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
