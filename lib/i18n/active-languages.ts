import { cache } from 'react'
import { createAnonClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'

/**
 * Nur die Felder, die ein Sprachumschalter braucht. Bewusst NICHT das ganze
 * Language-Objekt: /api/languages liefert select('*'), also gingen llm_model
 * und backfill_from_date bisher an jeden Browser, ohne dort einen Zweck zu
 * haben.
 */
export interface ActiveLanguage {
  code: LanguageCode
  name: string
  native_name: string | null
  is_default: boolean
}

/**
 * Aktive Sprachen serverseitig, statt sie clientseitig aus /api/languages zu
 * holen. Der Grund ist gemessen, nicht vermutet: der Client-Fetch lief zweimal
 * je Seitenaufruf (Kopfzeile und Footer, unabhängig voneinander), brauchte
 * 550–820 ms, kam mit `cache-control: max-age=0, must-revalidate` und war
 * damit bei JEDEM Aufruf ein Cache-MISS — für eine Liste, die sich fast nie
 * ändert und die der Server beim Rendern schon kennt. Er konkurrierte dabei
 * mit dem LCP-Bild um Bandbreite (Priorität High) und erzeugte den
 * Layout-Sprung, weil beide Umschalter bis zur Antwort einen Ersatzzustand
 * rendern.
 *
 * createAnonClient statt createClient aus lib/supabase/server: letzterer liest
 * cookies(), und ein cookies()-Aufruf im Renderpfad macht die Route dynamisch
 * — das würde ISR auf Lexikon-, Artikel- und Ranking-Seiten abschalten und den
 * TTFB verschlechtern, also genau das Gegenteil erreichen. Anon-Rechte
 * genügen: /api/languages lief bisher ebenfalls mit dem Anon-Key.
 *
 * cache() dedupliziert innerhalb eines Renderdurchlaufs — Kopfzeile und Footer
 * fragen beide, die Abfrage läuft einmal.
 */
export const getActiveLanguages = cache(async (): Promise<ActiveLanguage[]> => {
  const supabase = createAnonClient()

  // Sortierung wie in app/api/languages/route.ts, damit die Reihenfolge im
  // Umschalter dieselbe bleibt: Standardsprache zuerst, dann alphabetisch.
  const { data, error } = await supabase
    .from('languages')
    .select('code, name, native_name, is_default')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) {
    // Leere Liste statt Fehler: beide Umschalter behandeln „höchstens eine
    // Sprache" schon als gültigen Zustand und blenden sich aus. Genau so
    // verhielt sich auch der bisherige fetch im Fehlerfall.
    console.error('[i18n] Aktive Sprachen nicht ladbar:', error)
    return []
  }

  return (data ?? []) as ActiveLanguage[]
})
