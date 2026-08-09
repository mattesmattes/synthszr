/**
 * KI-Vorprüfung der Kommentare.
 *
 * Die eine Regel, an der hier alles hängt (Design 2026-08-09):
 * FAIL-OPEN GEHT IMMER NACH 'review', NIE NACH 'publish'. Fällt die Moderation
 * aus — API weg, Timeout, kaputte Antwort —, wird nichts ungeprüft sichtbar,
 * sondern landet in der Admin-Queue. Kommentare sind der zweite öffentlich
 * beschreibbare Pfad des Projekts überhaupt; ein Moderations-Ausfall darf kein
 * Veröffentlichungs-Freifahrtschein sein.
 *
 * Das SDK ist gemockt — Lehre aus dem markdownToTiptap-Fall (2026-08-09):
 * gemockt wird hier das VERHALTEN des Modells (Verdicts, Fehler), nicht die
 * Lauffähigkeit der Umgebung. Die ist bei einem reinen API-Call gegeben.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

function toolResponse(input: unknown) {
  return { content: [{ type: 'tool_use', name: 'report_moderation', input }], stop_reason: 'tool_use' }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
})

describe('moderateComment', () => {
  it('reicht ein sauberes Verdict durch', async () => {
    mocks.create.mockResolvedValue(toolResponse({ verdict: 'publish', reason: 'unauffällig' }))
    const { moderateComment } = await import('@/lib/comments/moderation')
    const r = await moderateComment('Guter Punkt, sehe ich ähnlich.', 'Artikel-Titel')
    expect(r.verdict).toBe('publish')
  })

  it('reicht reject durch', async () => {
    mocks.create.mockResolvedValue(toolResponse({ verdict: 'reject', reason: 'Spam' }))
    const { moderateComment } = await import('@/lib/comments/moderation')
    expect((await moderateComment('KAUFT JETZT!!!', 'T')).verdict).toBe('reject')
  })

  it('faellt bei API-Fehler auf review — nie auf publish', async () => {
    mocks.create.mockRejectedValue(new Error('529 overloaded'))
    const { moderateComment } = await import('@/lib/comments/moderation')
    const r = await moderateComment('Text', 'T')
    expect(r.verdict).toBe('review')
    expect(r.reason).toContain('Moderation nicht verfügbar')
  })

  it('faellt bei fehlendem Tool-Block auf review', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'kein tool' }], stop_reason: 'end_turn' })
    const { moderateComment } = await import('@/lib/comments/moderation')
    expect((await moderateComment('Text', 'T')).verdict).toBe('review')
  })

  it('faellt bei unbekanntem Verdict auf review', async () => {
    // Ein Modell, das 'approve' statt 'publish' sagt, darf nicht als publish
    // durchrutschen — Enum-Validierung ist Teil der Fail-Safe-Regel.
    mocks.create.mockResolvedValue(toolResponse({ verdict: 'approve', reason: 'x' }))
    const { moderateComment } = await import('@/lib/comments/moderation')
    expect((await moderateComment('Text', 'T')).verdict).toBe('review')
  })

  it('faellt ohne API-Key auf review statt zu werfen', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const { moderateComment } = await import('@/lib/comments/moderation')
    expect((await moderateComment('Text', 'T')).verdict).toBe('review')
  })
})
