/**
 * Task 9: Illustrationen über die bestehende Dither-Pipeline.
 *
 * Mock-Strategie: getModelForUseCase (Modellauflösung) und der OpenAI-SDK-
 * Provider sind gemockt — kein Netzwerk, kein echtes Bildmodell. Die
 * eigentliche Dither-Pipeline (sharp: Scale-to-cover, Tonkurve, Floyd-
 * Steinberg, whiteToTransparent) läuft dagegen ECHT auf einem synthetischen
 * PNG-Fixture, exakt wie im Cover-Pfad — ein Test, der nur Mock-Rückgaben
 * prüft, würde eine echte Pipeline-Regression nicht bemerken.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { getModelForUseCase } from '@/lib/ai/model-config'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), put: vi.fn() }))

vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: vi.fn(async () => 'openai/gpt-image-2'),
}))

vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.generate }
  },
}))

vi.mock('@vercel/blob', () => ({ put: mocks.put }))

/** Baut ein valides PNG-Fixture als Stand-in für eine Provider-Antwort.
 *  Kein 1×1-Pixel: die Pipeline resized/CLAHE't auf Arbeitsauflösung,
 *  das braucht eine sinnvolle Ausgangsfläche. */
async function fixtureImageBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
  }).png().toBuffer()
  return buf.toString('base64')
}

beforeEach(() => {
  mocks.generate.mockReset()
  mocks.put.mockReset()
  vi.mocked(getModelForUseCase).mockReset().mockResolvedValue('openai/gpt-image-2')
  process.env.OPENAI_API_KEY = 'test-key'
})

describe('buildGlossaryImagePrompt', () => {
  it('nutzt einen erklärenden Prompt, nicht das Satire-Template', async () => {
    const { buildGlossaryImagePrompt } = await import('@/lib/gemini/image-generator')
    const p = buildGlossaryImagePrompt('Mixture of Experts', 'Ein Ansatz, bei dem …')
    expect(p).toContain('Mixture of Experts')
    expect(p.toLowerCase()).not.toContain('satir')
  })

  it('fordert TONWERTE an, damit das Dithering überhaupt etwas zu rastern hat', async () => {
    // Befund D (2026-08-04): die Illustrationen sahen nicht gedithert aus. Ursache
    // war NICHT ditheringCoarseness (die 1 ist durch einen visuellen Test belegt,
    // s. Kommentar an generateGlossaryIllustration), sondern dieser Prompt: er
    // forderte "high-contrast black ink on white" an. Floyd-Steinberg wandelt
    // TONWERTE in Punktmuster — eine reine Schwarz-Weiß-Linienzeichnung hat keine,
    // also entsteht kein Raster, egal wie grob es eingestellt ist.
    const { buildGlossaryImagePrompt } = await import('@/lib/gemini/image-generator')
    const p = buildGlossaryImagePrompt('Inferenz', 'Wenn ein Modell antwortet.').toLowerCase()
    expect(p).toMatch(/grayscale|greyscale|mid-tone|midtone/)
    // Und die Gegenprobe: die Formulierung, die tonfreie Grafiken erzwang, ist weg.
    expect(p).not.toContain('black ink on white')
  })

  it('kürzt das Summary auf 400 Zeichen', async () => {
    const { buildGlossaryImagePrompt } = await import('@/lib/gemini/image-generator')
    const longSummary = 'a'.repeat(500)
    const p = buildGlossaryImagePrompt('Foo', longSummary)
    expect(p).toContain('a'.repeat(400))
    expect(p).not.toContain('a'.repeat(401))
  })

  it('funktioniert mit leerem Summary, ohne "undefined" in den Prompt zu schreiben', async () => {
    const { buildGlossaryImagePrompt } = await import('@/lib/gemini/image-generator')
    const p = buildGlossaryImagePrompt('Compliance', '')
    expect(p).toContain('Compliance')
    expect(p).not.toContain('undefined')
  })
})

describe('generateRawImage', () => {
  it('löst das Bildmodell über getModelForUseCase auf — wie der Cover-Pfad', async () => {
    mocks.generate.mockResolvedValue({ data: [{ b64_json: await fixtureImageBase64() }] })
    const { generateRawImage } = await import('@/lib/gemini/image-generator')
    const result = await generateRawImage('irgendein Prompt')
    expect(result.success).toBe(true)
    expect(result.model).toBe('openai/gpt-image-2')
    expect(getModelForUseCase).toHaveBeenCalledWith('image_generation')
  })

  it('gibt den Fehler weiter, wenn alle Versuche scheitern', async () => {
    vi.mocked(getModelForUseCase).mockRejectedValue(new Error('boom'))
    const { generateRawImage } = await import('@/lib/gemini/image-generator')
    const result = await generateRawImage('irgendein Prompt')
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})

describe('generateGlossaryIllustration', () => {
  it('gibt das Rohbild an generateAndProcessImage weiter, ohne neu zu generieren', async () => {
    mocks.generate.mockResolvedValue({ data: [{ b64_json: await fixtureImageBase64() }] })

    const { generateGlossaryIllustration } = await import('@/lib/gemini/image-generator')
    const result = await generateGlossaryIllustration('Mixture of Experts', 'Ein Ansatz, bei dem …')

    expect(result.success).toBe(true)
    expect(result.imageBase64).toBeTruthy()

    // Scharfer Test: der Provider darf nur EINMAL aufgerufen worden sein — für
    // das Rohbild in generateRawImage. Würde generateAndProcessImage trotz
    // preloadedRawBase64 nochmal generateSatiricalImage aufrufen (die
    // Regression, die dieser Test verhindern soll), riefe es den Provider ein
    // zweites Mal auf.
    expect(mocks.generate).toHaveBeenCalledTimes(1)

    // Beweist zusätzlich, dass die Dither-Pipeline wirklich auf dem
    // übergebenen Rohbild gelaufen ist (Zielgröße 1024×1024, Transparenz aus
    // whiteToTransparent) — nicht nur, dass irgendein Erfolg zurückkam.
    const meta = await sharp(Buffer.from(result.imageBase64!, 'base64')).metadata()
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(1024)
    expect(meta.hasAlpha).toBe(true)
  })

  it('gibt den Fehler der Rohbild-Generierung weiter, statt ein Ergebnis vorzutäuschen', async () => {
    vi.mocked(getModelForUseCase).mockRejectedValue(new Error('boom'))
    const { generateGlossaryIllustration } = await import('@/lib/gemini/image-generator')
    const result = await generateGlossaryIllustration('Compliance', 'Eine Vorschrift.')
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.imageBase64).toBeUndefined()
  })
})

describe('uploadGlossaryIllustration', () => {
  it('lädt ins glossary/-Präfix desselben Blob-Stores hoch und gibt die URL zurück', async () => {
    mocks.put.mockResolvedValue({
      url: 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/glossary/mixture-of-experts.png',
    })
    const { uploadGlossaryIllustration } = await import('@/lib/gemini/image-generator')
    const url = await uploadGlossaryIllustration('dGVzdA==', 'mixture-of-experts')

    expect(mocks.put).toHaveBeenCalledWith(
      'glossary/mixture-of-experts.png',
      expect.any(Buffer),
      // allowOverwrite ist Teil des Vertrags, nicht Beifang: der Blob-Pfad wird
      // deterministisch aus dem Slug gebildet, ein zweiter Versuch für denselben
      // Begriff trifft also immer denselben Blob. Ohne das Flag wirft Vercel Blob
      // ("This blob already exists") und ein Bild ließe sich nie ersetzen — weder
      // nach einer Revision noch nach einem Fehlversuch.
      { access: 'public', contentType: 'image/png', allowOverwrite: true },
    )
    expect(url).toBe('https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/glossary/mixture-of-experts.png')
  })

  it('gibt einen Upload-Fehler unverändert weiter, statt ihn zu verschlucken', async () => {
    mocks.put.mockRejectedValue(new Error('blob store down'))
    const { uploadGlossaryIllustration } = await import('@/lib/gemini/image-generator')
    await expect(uploadGlossaryIllustration('dGVzdA==', 'foo')).rejects.toThrow('blob store down')
  })
})
