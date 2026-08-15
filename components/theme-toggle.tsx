'use client'

import { useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme/script'

/**
 * Die beiden Theme-Schalter der Kopfleiste.
 *
 * BETREIBER-VORGABE 2026-08-15: Der Hell-Schalter steht LINKS neben „Language",
 * der Dunkel-Schalter RECHTS neben „Search". Zwei getrennte Schalter an zwei
 * Stellen, kein Umschalter in der Mitte — deshalb nimmt die Komponente die
 * gewünschte Seite als Eigenschaft entgegen und rendert genau einen Knopf.
 *
 * „System" hat KEINEN sichtbaren Schalter, ist aber die Voreinstellung: Wer
 * nichts wählt, bekommt, was sein Betriebssystem sagt. Sichtbar wird das nur
 * daran, welcher der beiden Knöpfe gerade als aktiv gilt.
 */
export function ThemeToggle({ mode }: { mode: 'light' | 'dark' }) {
  const [aktiv, setAktiv] = useState<boolean | null>(null)

  useEffect(() => {
    // Nach dem Hydrieren den TATSÄCHLICHEN Zustand vom Dokument ablesen, nicht
    // aus dem Speicher: Bei „system" steht dort nichts, die Klasse ist aber
    // längst gesetzt (s. lib/theme/script.ts). Der Speicher allein wüsste nicht,
    // was das Betriebssystem gerade sagt.
    const lesen = () => setAktiv(document.documentElement.classList.contains('dark') === (mode === 'dark'))
    lesen()

    // Ändert der Nutzer seine Systemeinstellung, während die Seite offen ist,
    // soll die Anzeige folgen — aber nur, solange er nicht selbst gewählt hat.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return
      document.documentElement.classList.toggle('dark', mq.matches)
      document.documentElement.style.colorScheme = mq.matches ? 'dark' : 'light'
      lesen()
    }
    mq.addEventListener('change', onSystem)
    window.addEventListener('synthszr-theme-changed', lesen)
    return () => {
      mq.removeEventListener('change', onSystem)
      window.removeEventListener('synthszr-theme-changed', lesen)
    }
  }, [mode])

  function waehlen() {
    const t: Theme = mode
    try { localStorage.setItem(THEME_STORAGE_KEY, t) } catch { /* Privatmodus */ }
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.style.colorScheme = mode
    // Der jeweils andere Knopf muss seinen Zustand mitbekommen — er steht in
    // einer eigenen Instanz am anderen Ende der Leiste.
    window.dispatchEvent(new Event('synthszr-theme-changed'))
  }

  const label = mode === 'light' ? 'Light' : 'Dark'

  return (
    <button
      type="button"
      onClick={waehlen}
      aria-label={mode === 'light' ? 'Helle Darstellung' : 'Dunkle Darstellung'}
      aria-pressed={aktiv ?? false}
      title={label}
      // Vor dem Hydrieren ist `aktiv` null — dann sieht der Knopf neutral aus.
      // Ein geratener Anfangszustand würde bei „system" die Hälfte der Besucher
      // kurz falsch anzeigen.
      className={`text-xs font-mono uppercase tracking-wider transition-opacity cursor-pointer ${
        aktiv === null ? 'opacity-60' : aktiv ? 'opacity-100 underline underline-offset-4' : 'opacity-50 hover:opacity-80'
      }`}
    >
      {label}
    </button>
  )
}
