import { describe, it, expect, vi } from 'vitest'

// Legacy-Kurznamen des Ghostwriter-Modellwählers: Seit dem Key-Wechsel am
// 2026-10-24 (neues Google-Projekt) sind gemini-2.5-pro und das schon früher
// zurückgezogene gemini-2.0-flash bei Google 404 — beide müssen auf
// gemini-3.8-flash laufen, konkrete andere IDs bleiben unverändert.

vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))
vi.mock('openai', () => ({ default: class {} }))

describe('resolveModel – Gemini-Legacy-Aliase', () => {
  it.each([
    ['gemini-2.5-pro', 'gemini-3.8-flash'],
    ['gemini-2.0-flash', 'gemini-3.8-flash'],
    ['gemini-3.8-flash', 'gemini-3.8-flash'],
  ])('%s → %s', async (input, expected) => {
    const { resolveModel } = await import('@/lib/claude/ghostwriter')
    expect(resolveModel(input)).toEqual({ provider: 'google', modelId: expected })
  })
})
