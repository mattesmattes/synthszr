/**
 * Zweite Instanz über die Kandidatenliste.
 *
 * BETREIBER-BEFUND 2026-08-12 (zweite Meldung derselben Klasse): Von 62
 * gesammelten Kandidaten war rund die Hälfte ungültig — Allgemeinwörter wie
 * „Vorstandschef", „Übernahme", „Testumgebung", „Umschreiben", dazu Firmennamen
 * wie „Claude" und „HuggingFace", die der Extraktions-Prompt ausdrücklich
 * ausschließt. Einzelne Wörter nachzutragen skaliert nicht; deshalb ein Prüfschritt,
 * der die Liste OHNE Artikelkontext bewertet.
 *
 * Die Tests sichern vor allem das Verhalten im Fehlerfall: ein Filter, der bei
 * Störung Kandidaten verwirft, wäre schlimmer als keiner.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))
vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: async () => 'test-model',
}))

function toolAntwort(reject: Array<{ name: string; reason: string }>) {
  return { content: [{ type: 'tool_use', input: { reject } }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('filterCandidates', () => {
  it('verwirft, was das Modell als Allgemeinwort meldet', async () => {
    mocks.create.mockResolvedValue(toolAntwort([
      { name: 'Vorstandschef', reason: 'allgemeinwort' },
      { name: 'Übernahme', reason: 'allgemeinwort' },
    ]))
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Vorstandschef', 'Riemann-Hypothese', 'Übernahme'])
    expect(r.keep).toEqual(['Riemann-Hypothese'])
    expect(r.rejected.map((x) => x.name).sort()).toEqual(['Vorstandschef', 'Übernahme'])
  })

  it('sperrt die harte Liste OHNE das Modell zu fragen', async () => {
    mocks.create.mockResolvedValue(toolAntwort([]))
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Anbieter', 'Kubernetes'])
    expect(r.keep).toEqual(['Kubernetes'])
    expect(r.rejected).toEqual([{ name: 'Anbieter', reason: 'gesperrt' }])
    // Der Betreiber-Entscheid steht nicht zur Abstimmung: das Modell sah nur „Kubernetes".
    const prompt = mocks.create.mock.calls[0][0].messages[0].content as string
    expect(prompt).not.toContain('- Anbieter')
  })

  it('verwirft NICHTS, wenn der Aufruf scheitert', async () => {
    mocks.create.mockRejectedValue(new Error('Modell überlastet'))
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Vorstandschef', 'Riemann-Hypothese'])
    expect(r.keep).toEqual(['Vorstandschef', 'Riemann-Hypothese'])
    expect(r.rejected).toEqual([])
  })

  it('verwirft NICHTS bei unbrauchbarer Antwort', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'kaputt' }] })
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Vorstandschef'])
    expect(r.keep).toEqual(['Vorstandschef'])
  })

  it('ignoriert Namen, die gar nicht in der Liste standen', async () => {
    // Ein Modell, das den Namen umformuliert, darf keinen gültigen Kandidaten
    // mitreissen — nur exakte Treffer zaehlen.
    mocks.create.mockResolvedValue(toolAntwort([{ name: 'Riemann Hypothese', reason: 'allgemeinwort' }]))
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Riemann-Hypothese'])
    expect(r.keep).toEqual(['Riemann-Hypothese'])
  })

  it('kommt ohne API-Key durch, ohne etwas zu verwerfen', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { filterCandidates } = await import('@/lib/glossary/candidate-filter')
    const r = await filterCandidates(['Vorstandschef'])
    expect(r.keep).toEqual(['Vorstandschef'])
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
