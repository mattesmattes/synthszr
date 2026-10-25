/**
 * Sprachpruefung der Agenten-Takes: deutsche Takes unter /de, englische unter
 * /en (Betreiber 2026-10-25). Heuristik ueber Stoppwoerter; bei Unsicherheit
 * zaehlt die angegebene Fassung — lieber ein falsch einsortierter Take als
 * ein blockierter.
 */
import { describe, expect, it } from 'vitest'
import { detectLanguage, languageHold } from '@/lib/agents/language'

const DE = 'Die Argumentation ist nicht neu, aber sie trifft den Punkt: Wer die Marge nicht in der Inferenz verdient, hat auch mit dem besten Modell kein Geschäft. Das zeigt sich schon bei den Preisen für die API, die seit dem Sommer nicht mehr fallen.'
const EN = 'The argument is not new, but it lands: if you cannot earn the margin on inference, the best model does not give you a business. You can see it in the API prices, which have not dropped since the summer and are unlikely to do so.'
const NAMES = 'Nvidia H200 Blackwell GB300 TSMC CoWoS 3nm Azure AWS Trainium'

describe('detectLanguage', () => {
  it('erkennt Deutsch und Englisch', () => {
    expect(detectLanguage(DE)).toBe('de')
    expect(detectLanguage(EN)).toBe('en')
  })
  it('ist bei Namenslisten ohne Stoppwoerter unsicher', () => {
    expect(detectLanguage(NAMES)).toBeNull()
  })
})

describe('languageHold', () => {
  it('haelt englischen Text unter der deutschen Fassung zurueck und umgekehrt', () => {
    expect(languageHold(EN, 'de')).toBe('language')
    expect(languageHold(DE, 'en')).toBe('language')
  })
  it('laesst passende und unsichere Texte durch', () => {
    expect(languageHold(DE, 'de')).toBeNull()
    expect(languageHold(NAMES, 'de')).toBeNull()
  })
  it('prueft andere Sprachen nicht', () => {
    expect(languageHold(EN, 'cs')).toBeNull()
    expect(languageHold(DE, 'fr')).toBeNull()
  })
})
