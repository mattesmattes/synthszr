/**
 * describeError — Fehlertext fuer die Ranking-Extraktion.
 *
 * PROD-BEFUND 2026-09-26: "[RankingJobs] extract item failed … [object Object]".
 * resolveProduct wirft rohe Supabase-Fehlerobjekte ({ message, code, details }),
 * keine Error-Instanzen; String(err) machte daraus "[object Object]" — im Log
 * UND in daily_repo.product_processing_error. Das Item "YouTube adds AI" wurde
 * nach drei Versuchen aussortiert, ohne dass der Grund irgendwo stand.
 */
import { describe, expect, it } from 'vitest'
import { describeError } from '@/lib/rankings/describe-error'

describe('describeError', () => {
  it('liefert die message einer Error-Instanz', () => {
    expect(describeError(new Error('extract: timeout'))).toBe('extract: timeout')
  })

  it('macht ein Supabase-Fehlerobjekt lesbar, samt code und details', () => {
    const pgErr = {
      message: 'duplicate key value violates unique constraint "products_slug_key"',
      code: '23505',
      details: 'Key (slug)=(youtube-ai) already exists.',
      hint: null,
    }
    const text = describeError(pgErr)
    expect(text).toContain('duplicate key value violates unique constraint "products_slug_key"')
    expect(text).toContain('23505')
    expect(text).toContain('Key (slug)=(youtube-ai) already exists.')
    expect(text).not.toContain('[object Object]')
  })

  it('faellt fuer sonstige Objekte auf JSON zurueck statt auf [object Object]', () => {
    expect(describeError({ foo: 1 })).toBe('{"foo":1}')
  })

  it('reicht Strings unveraendert durch', () => {
    expect(describeError('kaputt')).toBe('kaputt')
  })
})
