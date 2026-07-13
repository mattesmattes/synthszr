import { describe, expect, it, vi } from 'vitest'
import { enforceTakeEnding, hasWerEnding } from '@/lib/claude/take-ending'

const SUMMARY = `## OpenAI senkt die Preise\n\nOpenAI hat die API-Preise um 40 Prozent gesenkt. {OpenAI} → [The Information](https://example.com)`

function section(take: string, marker = 'Synthszr Take:'): string {
  return `${SUMMARY}\n\n${marker} ${take}`
}

describe('hasWerEnding', () => {
  it('erkennt die "Wer …"-Figur im letzten Satz des Takes', () => {
    const s = section('Die Marge wandert zur Infrastruktur. Wer jetzt noch auf reine Modelle setzt, verliert.')
    expect(hasWerEnding(s)).toBe(true)
  })

  it('erkennt die Figur auch im vorletzten Satz', () => {
    const s = section('Wer heute noch GPU-Einheiten zählt, rechnet falsch. Der Engpass sitzt in der Speicherfabrik.')
    expect(hasWerEnding(s)).toBe(true)
  })

  it('schlägt nicht an, wenn "Wer" nur mitten im Take steht', () => {
    const s = section(
      'Wer die Zahlen liest, ahnt es längst. Die Preise fallen weiter. Am Ende zählt die Anwendung, die auf dem Modell läuft. Die Marge wandert zur Infrastruktur.',
    )
    expect(hasWerEnding(s)).toBe(false)
  })

  it('ignoriert Sections ohne Take-Marker', () => {
    expect(hasWerEnding(SUMMARY)).toBe(false)
  })
})

describe('enforceTakeEnding', () => {
  it('lässt saubere Takes unangetastet und ruft den Callback nicht', async () => {
    const s = section('Die Preise fallen. Die Marge wandert zur Infrastruktur.')
    const rewrite = vi.fn()
    expect(await enforceTakeEnding(s, rewrite)).toBe(s)
    expect(rewrite).not.toHaveBeenCalled()
  })

  it('ersetzt den Take durch die umgeformte Fassung', async () => {
    const s = section('Die Preise fallen. Wer jetzt noch selbst trainiert, zahlt drauf.')
    const rewrite = vi.fn(async () => 'Die Preise fallen. Selbst zu trainieren kostet ab jetzt drauf.')
    const out = await enforceTakeEnding(s, rewrite)
    expect(out).toContain('Selbst zu trainieren kostet ab jetzt drauf.')
    expect(out).not.toContain('Wer jetzt noch selbst trainiert')
    expect(out.startsWith(SUMMARY)).toBe(true)
  })

  it('behält das Original, wenn der Rewrite die Figur nicht loswird', async () => {
    const s = section('Die Preise fallen. Wer jetzt noch selbst trainiert, zahlt drauf.')
    const rewrite = vi.fn(async () => 'Die Preise fallen. Wer weiter selbst trainiert, zahlt eben drauf.')
    expect(await enforceTakeEnding(s, rewrite)).toBe(s)
  })

  it('behält das Original bei leerem Ergebnis oder Callback-Fehler', async () => {
    const s = section('Die Preise fallen. Wer jetzt noch selbst trainiert, zahlt drauf.')
    expect(await enforceTakeEnding(s, async () => '')).toBe(s)
    expect(
      await enforceTakeEnding(s, async () => {
        throw new Error('API down')
      }),
    ).toBe(s)
  })

  it('erkennt auch den fett markierten Take-Marker', async () => {
    const s = section('Wer heute noch wartet, verliert.', '**Synthszr Take:**')
    const rewrite = vi.fn(async () => 'Warten kostet ab heute Marktanteile.')
    const out = await enforceTakeEnding(s, rewrite)
    expect(out).toContain('**Synthszr Take:**')
    expect(out).toContain('Warten kostet ab heute Marktanteile.')
  })
})
