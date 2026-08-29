/**
 * Lange Artikel werden in Bloecke à 15 zerlegt und chunkweise uebersetzt. Die
 * Chunks sind voneinander UNABHAENGIG: Jeder bekommt seinen eigenen Prompt, der
 * ausser dem Artikeltitel und einem "Chunk 2 von 3" keinen Kontext traegt, und
 * keiner baut auf dem Ergebnis eines anderen auf. Sie duerfen deshalb parallel
 * laufen.
 *
 * Warum das zaehlt (Messung 29.08.2026 ueber 400 abgeschlossene Laeufe): Ein
 * Modellaufruf dauert bei gemini-2.5-pro rund 56 Sekunden. Bei drei Chunks plus
 * Meta-Aufruf ergibt das sequenziell 226s im Median, mit Ausreissern bis 408s —
 * nah am 300s-Fenster der Admin-Route.
 *
 * OBERGRENZE, kein blindes Promise.all: gemini-2.5-pro hat engere Rate Limits,
 * und callGeminiWithRetry federt Ueberlast mit exponentiellem Backoff ab (plus
 * Ausweichen auf Flash). Zu viele gleichzeitige Anfragen loesen genau diese
 * Bremse aus und machen den Lauf langsamer statt schneller.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  gleichzeitig: 0,
  maxGleichzeitig: 0,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mocks.generateContent }
    }
  },
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))
vi.mock('openai', () => ({ default: class {} }))

/** Ein Block, gross genug, dass die 30.000-Zeichen-Schwelle sicher faellt. */
function block(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text: text.padEnd(900, ' Fuelltext') }] }
}

beforeEach(() => {
  mocks.generateContent.mockReset()
  mocks.gleichzeitig = 0
  mocks.maxGleichzeitig = 0

  mocks.generateContent.mockImplementation(async (prompt: string) => {
    mocks.gleichzeitig++
    mocks.maxGleichzeitig = Math.max(mocks.maxGleichzeitig, mocks.gleichzeitig)
    await new Promise((r) => setTimeout(r, 30))
    mocks.gleichzeitig--

    // Meta-Aufruf (Titel/Excerpt) erkennt man am TITLE-Marker.
    if (prompt.includes('TITLE:')) {
      return { response: { text: () => JSON.stringify({ title: 'T', slug: 't', excerpt: 'E' }) } }
    }
    // Chunk-Aufruf: die Blocknummern aus dem Prompt zurueckgeben, damit der
    // Test die REIHENFOLGE im Ergebnis pruefen kann.
    const eingang = JSON.parse(prompt.slice(prompt.indexOf('CONTENT:') + 8).trim()) as Array<Record<string, unknown>>
    const raus = eingang.map((b) => {
      const t = ((b.content as Array<{ text: string }>)[0].text || '').trim().split(' ')[0]
      return { type: 'paragraph', content: [{ type: 'text', text: 'X' + t }] }
    })
    return { response: { text: () => JSON.stringify(raus) } }
  })
})

describe('Chunk-Uebersetzung laeuft parallel', () => {
  it('uebersetzt mehrere Chunks gleichzeitig und behaelt die Reihenfolge', async () => {
    const { translateContent } = await import('@/lib/i18n/translation-service')
    // 45 Bloecke => 3 Chunks à 15
    const blocks = Array.from({ length: 45 }, (_, i) => block('B' + i))

    const res = await translateContent(
      { title: 'Titel', excerpt: 'Auszug', content: { type: 'doc', content: blocks } } as never,
      'fr' as never,
      'gemini-2.5-pro',
    )

    const texte = (res.content as { content: Array<{ content: Array<{ text: string }> }> }).content
      .map((b) => b.content[0].text)

    expect(texte).toHaveLength(45)
    expect(texte[0]).toBe('XB0')
    expect(texte[15]).toBe('XB15') // Anfang von Chunk 2 an der richtigen Stelle
    expect(texte[44]).toBe('XB44')
    expect(mocks.maxGleichzeitig).toBeGreaterThan(1)
  })

  it('ueberschreitet die Obergrenze nicht', async () => {
    const { translateContent } = await import('@/lib/i18n/translation-service')
    // 150 Bloecke => 10 Chunks, deutlich mehr als die Obergrenze
    const blocks = Array.from({ length: 150 }, (_, i) => block('B' + i))

    await translateContent(
      { title: 'Titel', excerpt: 'Auszug', content: { type: 'doc', content: blocks } } as never,
      'fr' as never,
      'gemini-2.5-pro',
    )

    expect(mocks.maxGleichzeitig).toBeLessThanOrEqual(3)
  })
})
