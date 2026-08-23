/**
 * Tages-Fetchstand fuer das Banner im Admin.
 *
 * PROD-BEFUND 2026-08-23 (Sonntag): Der Newsletter-Abruf lief um 03:46 und
 * sammelte NULL Artikel — was der Scheduler als Erfolg verbuchte
 * (`if (fetchResult.success) markTaskRun(...)`; 0 Artikel ist kein Fehler).
 * Danach sperrte hasRunToday jeden weiteren Versuch fuer den restlichen Tag.
 * Ohne Quellmaterial scheiterte die Tagesanalyse, und weil die Post-Erzeugung
 * an ihr haengt ("skipped_dependency_failed"), entstand kein Artikel. Sichtbar
 * war davon nirgends etwas.
 *
 * Das Banner macht genau diese Zahl sichtbar. Entscheidend ist, dass NULL
 * Artikel als Warnung gelten und nicht als unauffaellige Null.
 */
import { describe, expect, it } from 'vitest'
import { buildFetchStatus } from '@/lib/admin/fetch-status'

describe('buildFetchStatus', () => {
  it('warnt, wenn heute nichts gesammelt wurde', () => {
    const s = buildFetchStatus({ articleCount: 0, lastNewsletterFetch: '2026-08-23T01:46:00Z', lastWebcrawl: null })
    expect(s.level).toBe('warn')
    expect(s.articleCount).toBe(0)
  })

  it('meldet ok, sobald Artikel da sind', () => {
    const s = buildFetchStatus({ articleCount: 317, lastNewsletterFetch: '2026-08-23T05:10:00Z', lastWebcrawl: null })
    expect(s.level).toBe('ok')
    expect(s.articleCount).toBe(317)
  })

  it('warnt auch, wenn ueberhaupt noch kein Abruf lief', () => {
    // Kein Lauf und keine Artikel — der Tag hat noch nicht begonnen ODER der
    // Cron kommt nicht durch. Beides will der Betreiber sehen.
    const s = buildFetchStatus({ articleCount: 0, lastNewsletterFetch: null, lastWebcrawl: null })
    expect(s.level).toBe('warn')
    expect(s.lastFetchLabel).toBe('noch kein Abruf heute')
  })

  it('nennt die Uhrzeit des letzten Abrufs, wenn er heute war', () => {
    const s = buildFetchStatus({
      articleCount: 5,
      lastNewsletterFetch: '2026-08-23T05:10:00Z',
      lastWebcrawl: null,
      now: new Date('2026-08-23T06:00:00Z'),
    })
    expect(s.lastFetchLabel).toMatch(/\d{2}:\d{2}/)
  })

  it('kennzeichnet einen Abruf von gestern als nicht-heute', () => {
    const s = buildFetchStatus({
      articleCount: 0,
      lastNewsletterFetch: '2026-08-22T03:46:00Z',
      lastWebcrawl: null,
      now: new Date('2026-08-23T06:00:00Z'),
    })
    expect(s.lastFetchLabel).toBe('noch kein Abruf heute')
    expect(s.level).toBe('warn')
  })
})
