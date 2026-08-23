/**
 * Tages-Ampel fuer den News-Nachschub im Admin.
 *
 * PROD-BEFUND 2026-08-23: Der Newsletter-Abruf lief um 03:46 ins Leere (die
 * Newsletter kamen erst gegen 07:00), galt aber als erledigt — null Artikel
 * sind formal kein Fehler. Ohne Quellmaterial fiel die Tagesanalyse aus und mit
 * ihr der Artikel. Sichtbar war davon nirgends etwas.
 *
 * SCHWELLEN, gemessen ueber 11 Tage (news_queue je Tag):
 *   normale Werktage 573-844 (Median 699)
 *   Sonntag 16.08.   297      <- ruhig, aber voellig in Ordnung
 *   22.08.            81      <- der Tag, an dem der Abruf ausfiel
 *   0                          <- gar kein Abruf
 * Daraus: gruen ab 250 (deckt auch ruhige Sonntage ab, ohne Fehlalarm),
 * gelb ab 50 (auffaellig wenig — der 22.08. faellt hierhin), darunter rot.
 */
import { describe, expect, it } from 'vitest'
import { buildFetchStatus } from '@/lib/admin/fetch-status'

const base = { lastNewsletterFetch: '2026-08-23T05:10:00Z', lastWebcrawl: null, articleCount: 700 }

describe('buildFetchStatus — Ampel nach verarbeiteten News', () => {
  it('gruen an einem normalen Tag', () => {
    expect(buildFetchStatus({ ...base, processedCount: 699 }).level).toBe('gruen')
  })

  it('gruen auch an einem ruhigen Sonntag — kein Fehlalarm', () => {
    // 297 war Sonntag, der 16.08., und voellig normal.
    expect(buildFetchStatus({ ...base, processedCount: 297 }).level).toBe('gruen')
  })

  it('gelb, wenn auffaellig wenig ankam', () => {
    // 81 = der 22.08., an dem der Abruf ausfiel.
    expect(buildFetchStatus({ ...base, processedCount: 81 }).level).toBe('gelb')
  })

  it('rot, wenn praktisch nichts verarbeitet wurde', () => {
    expect(buildFetchStatus({ ...base, processedCount: 0 }).level).toBe('rot')
    expect(buildFetchStatus({ ...base, processedCount: 12 }).level).toBe('rot')
  })

  it('rot, wenn gar nichts eingesammelt wurde — unabhaengig vom Rest', () => {
    // Genau der 2026-08-23: ohne Quellmaterial ist der Tagesartikel in Gefahr.
    expect(buildFetchStatus({ ...base, articleCount: 0, processedCount: 0 }).level).toBe('rot')
  })

  it('nennt beide Zahlen, gefetcht und verarbeitet', () => {
    const s = buildFetchStatus({ ...base, articleCount: 681, processedCount: 367 })
    expect(s.articleCount).toBe(681)
    expect(s.processedCount).toBe(367)
  })

  it('kennzeichnet einen Abruf von gestern als nicht-heute', () => {
    const s = buildFetchStatus({
      ...base, articleCount: 0, processedCount: 0,
      lastNewsletterFetch: '2026-08-22T03:46:00Z',
      now: new Date('2026-08-23T06:00:00Z'),
    })
    expect(s.lastFetchLabel).toBe('noch kein Abruf heute')
  })

  it('nennt die Uhrzeit, wenn der Abruf heute lief', () => {
    const s = buildFetchStatus({ ...base, processedCount: 400, now: new Date('2026-08-23T06:00:00Z') })
    expect(s.lastFetchLabel).toMatch(/\d{2}:\d{2}/)
  })
})
