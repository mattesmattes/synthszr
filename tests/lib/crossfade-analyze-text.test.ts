/**
 * Dialog-Analyse des Mixers (lib/audio/crossfade.ts, analyzeText).
 *
 * BEFUND 2026-10-21: Die Analyse strich nur die alten Ein-Wort-Tags
 * ([cheerfully] …). Seit die Skripte freie Sprechanweisungen tragen
 * ([dry, measured] …), zählte die Klammer als Wörter mit — kurze Reaktionen
 * wurden nie erkannt, und der automatische Reaktions-Overlap fiel aus.
 * Trail-off galt nur für drei ASCII-Punkte; die Skripte brechen aber mit
 * „…" oder „—" ab (49 Gedankenstriche, ein „…" pro Folge).
 */
import { describe, expect, it } from 'vitest'
import { analyzeText } from '@/lib/audio/crossfade'

describe('analyzeText', () => {
  it('ignoriert die freie Sprechanweisung am Zeilenanfang', () => {
    const r = analyzeText('[dry, measured, slightly amused] Exactly.')
    expect(r.wordCount).toBe(1)
    expect(r.isShortReaction).toBe(true)
  })

  it('erkennt die Reaktionen aus den Dialogregeln', () => {
    for (const t of ['[quick] Wait, what?', '[flat] No way.', '[soft] Hm.', '[warm] Genau!', '[skeptical] Echt jetzt?']) {
      expect(analyzeText(t).isShortReaction, t).toBe(true)
    }
  })

  it('haelt kurze Sachantworten aus dem Reaktions-Overlap heraus', () => {
    expect(analyzeText('[quick, confident] Federal procurement.').isShortReaction).toBe(false)
  })

  it('wertet drei Punkte, Auslassungspunkte und Gedankenstrich am Ende als Trail-off', () => {
    expect(analyzeText('[curious] Why would a chip maker turn into a bank...').endsWithTrailOff).toBe(true)
    expect(analyzeText('[curious] Warum wird ein Chiphersteller zur Bank…').endsWithTrailOff).toBe(true)
    expect(analyzeText('[thoughtfully] The interesting thing is that—').endsWithTrailOff).toBe(true)
    expect(analyzeText('[calm] That is the whole point.').endsWithTrailOff).toBe(false)
  })

  it('erkennt Fragen und das alte [interrupting]-Tag weiterhin', () => {
    expect(analyzeText('[probing] And if one of those renters goes bust?').isQuestion).toBe(true)
    expect(analyzeText('[interrupting] Hold on, let me finish.').isInterrupting).toBe(true)
  })
})
