import { describe, it, expect, vi, beforeEach } from 'vitest'

// Seit dem Key-Wechsel am 2026-10-24 (neues Google-Projekt) weist Google
// gemini-2.5-flash und gemini-2.5-pro mit 404 „no longer available to new
// users“ ab. Die Auswahlwerte bleiben (sie stehen in `languages.llm_model`),
// der API-Aufruf muss aber auf gemini-3.8-flash laufen.

const mocks = vi.hoisted(() => ({
  getGenerativeModel: vi.fn(),
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(args: unknown) {
      mocks.getGenerativeModel(args)
      return {
        generateContent: async () => ({ response: { text: () => '{"greeting":"Hello"}' } }),
      }
    }
  },
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))
vi.mock('openai', () => ({ default: class {} }))

beforeEach(() => mocks.getGenerativeModel.mockClear())

describe('Übersetzung – Gemini-Modellwahl', () => {
  it.each(['gemini-2.5-pro', 'gemini-2.5-flash'] as const)(
    'ruft für %s das Modell gemini-3.8-flash auf',
    async (choice) => {
      const { translateUIStrings } = await import('@/lib/i18n/translation-service')
      const res = await translateUIStrings({ greeting: 'Hallo' }, 'en' as never, choice)

      expect(res).toEqual({ success: true, translations: { greeting: 'Hello' } })
      expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(1)
      expect(mocks.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-3.8-flash' })
      )
    }
  )
})
