/**
 * Der Stuck-Timeout muss LAENGER sein als das Zeitfenster des Laufs, der ihn
 * benutzt. Sonst raeumt der naechste Tick einen Eintrag ab, der noch bearbeitet
 * wird — der Lauf laeuft weiter, ein zweiter startet dasselbe Stueck erneut,
 * `attempts` steigt, und von aussen sieht es aus, als haenge die Uebersetzung.
 *
 * Befund 29.08.2026: `STUCK_TIMEOUT_MS = 6 min` war fuer die Admin-Route
 * bemessen (maxDuration 300s, der Kommentar dort sagt "slightly > 300s").
 * Dieselbe Zahl steht aber in lib/i18n/translation-queue.ts, und die benutzt
 * der Scheduler mit maxDuration=800. Laeufe ueber 360s wurden deshalb mitten
 * in der Arbeit zurueckgesetzt.
 *
 * Warum das erst jetzt auffiel: Vor dem Retry-Commit 96b781e (21.08.) lag die
 * Median-Dauer bei 132s, weit unter 360s. Mit bis zu drei Versuchen je Chunk
 * stieg sie auf 226s, mit Ausreissern bis 408s (gemessen ueber alle vier
 * Sprachen). Erst dadurch wurde die Fehlbemessung wirksam.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function lies(datei: string): string {
  return readFileSync(join(process.cwd(), datei), 'utf8')
}

function maxDuration(src: string): number {
  const m = src.match(/export const maxDuration\s*=\s*(\d+)/)
  if (!m) throw new Error('maxDuration nicht gefunden')
  return Number(m[1])
}

function stuckTimeoutSekunden(src: string): number {
  // Formen wie `6 * 60 * 1000` oder `900_000`
  // Kein '/' im Zeichensatz — sonst frisst der Ausdruck den Zeilenkommentar mit.
  const m = src.match(/STUCK_TIMEOUT_MS\s*=\s*([0-9_][0-9_ *]*)/)
  if (!m) throw new Error('STUCK_TIMEOUT_MS nicht gefunden')
  const ms = Function(`"use strict"; return (${m[1].replace(/_/g, '')})`)() as number
  return ms / 1000
}

describe('Stuck-Timeout gegen Zeitfenster', () => {
  it('der Scheduler-Pfad raeumt nicht ab, was noch laufen darf', () => {
    const fenster = maxDuration(lies('app/api/cron/scheduled-tasks/route.ts'))
    const timeout = stuckTimeoutSekunden(lies('lib/i18n/translation-queue.ts'))
    expect(timeout).toBeGreaterThan(fenster)
  })

  it('die Admin-Route ebenso', () => {
    const src = lies('app/api/admin/translations/process-queue/route.ts')
    expect(stuckTimeoutSekunden(src)).toBeGreaterThan(maxDuration(src))
  })
})
