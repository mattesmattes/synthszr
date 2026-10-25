/**
 * Sprachprüfung für Agenten-Takes: Deutsch unter /de, Englisch unter /en
 * (Betreiber 2026-10-25). Kleine Stoppwort-Heuristik ohne Abhängigkeit —
 * bei Unsicherheit gilt die angegebene Fassung, andere Sprachen (cs, nds,
 * fr) werden nicht geprüft. Lieber ein falsch einsortierter Take als ein
 * grundlos wartender.
 */
import type { LanguageCode } from '@/lib/types'

// Nur Wörter, die es in der jeweils anderen Sprache nicht gibt.
const DE = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'einer', 'den', 'dem', 'des', 'sich', 'auch', 'aber', 'wenn', 'noch', 'schon', 'nur', 'wie', 'mit', 'bei', 'für', 'über', 'nach', 'aus', 'zum', 'zur', 'wird', 'werden', 'wurde', 'sind', 'hat', 'haben', 'kann', 'keine', 'kein', 'dass', 'oder', 'seit', 'mehr', 'sehr', 'zeigt', 'wer', 'was', 'dann', 'also', 'ihre', 'ihr', 'ihrer', 'seine', 'sein', 'diese', 'dieser', 'dieses', 'zwischen', 'gegen', 'durch', 'ohne', 'vom', 'beim', 'im', 'am', 'ins'])
const EN = new Set(['the', 'and', 'is', 'are', 'not', 'but', 'with', 'for', 'this', 'that', 'from', 'have', 'has', 'does', 'do', 'you', 'your', 'they', 'their', 'which', 'would', 'could', 'should', 'will', 'can', 'cannot', 'if', 'it', 'its', 'on', 'of', 'to', 'into', 'than', 'then', 'there', 'these', 'those', 'because', 'while', 'since', 'about', 'without', 'between', 'against', 'through', 'likely', 'unlikely', 'see', 'give', 'gives', 'been', 'being', 'was', 'were'])

export function detectLanguage(text: string): 'de' | 'en' | null {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? []
  let de = 0
  let en = 0
  for (const w of words) {
    if (DE.has(w)) de++
    else if (EN.has(w)) en++
  }
  if (de >= 6 && de >= 2 * en) return 'de'
  if (en >= 6 && en >= 2 * de) return 'en'
  return null
}

/** `'language'`, wenn der Text erkennbar in der falschen Sprache ist; sonst null. */
export function languageHold(body: string, lang: LanguageCode): 'language' | null {
  if (lang !== 'de' && lang !== 'en') return null
  const detected = detectLanguage(body)
  return detected && detected !== lang ? 'language' : null
}
