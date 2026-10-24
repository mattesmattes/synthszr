import { describe, it, expect, vi, beforeEach } from 'vitest'

// Die tägliche Analyse läuft über die AI-SDK-Google-Anbindung. Seit dem
// Key-Wechsel am 2026-10-24 (neues Google-Projekt) weist Google die 2.5-Modelle
// mit 404 „no longer available to new users“ ab — die Analyse muss
// gemini-3.8-flash aufrufen.

const googleMock = vi.fn((modelId: string) => ({ modelId }))
const streamTextMock = vi.fn(() => ({
  textStream: (async function* () {
    yield 'Teil 1'
    yield 'Teil 2'
  })(),
}))

vi.mock('@ai-sdk/google', () => ({ google: googleMock }))
vi.mock('ai', () => ({ streamText: streamTextMock }))

describe('streamAnalysis – Modellwahl', () => {
  beforeEach(() => {
    googleMock.mockClear()
    streamTextMock.mockClear()
  })

  it('ruft gemini-3.8-flash auf und reicht den Stream durch', async () => {
    const { streamAnalysis } = await import('@/lib/claude/client')

    const chunks: string[] = []
    for await (const chunk of streamAnalysis('Inhalt', 'Prompt')) chunks.push(chunk)

    expect(googleMock).toHaveBeenCalledTimes(1)
    expect(googleMock).toHaveBeenCalledWith('gemini-3.8-flash')
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: { modelId: 'gemini-3.8-flash' } })
    )
    expect(chunks).toEqual(['Teil 1', 'Teil 2'])
  })
})
