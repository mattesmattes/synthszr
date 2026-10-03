/**
 * Datencache der Company-Seiten (Egress-Befund 2026-10-03).
 *
 * Jede nicht-deutsche Company-Seite lud den VOLLEN übersetzten Inhalt aller
 * Posts, die die Firma erwähnen — gemessen OpenAI/en 8,0 MB, Nvidia/en 5,3 MB,
 * Adobe/en 1,0 MB pro Render, bei ~2.400 Crawler-Aufrufen am Tag. Gebraucht
 * werden nur Überschrift und Anriss je Artikel. Die teure Einheit (Post ×
 * Sprache) wird deshalb einzeln gecacht und zwischen allen Firmen geteilt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { konfiguriert, antworten } = vi.hoisted(() => ({
  konfiguriert: [] as Array<{ keys: string[]; opts: { revalidate?: number; tags?: string[] } }>,
  antworten: new Map<string, { data: unknown; error: { message: string } | null }>(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keys: string[], opts: { revalidate?: number; tags?: string[] }) => {
    konfiguriert.push({ keys, opts })
    return fn
  },
  revalidateTag: vi.fn(),
}))

// Supabase-Stub: Antwort je Post-ID (content_translations) bzw. je Tabelle.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const state: { postId?: string } = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => { if (col === 'generated_post_id') state.postId = val; return chain },
        ilike: () => chain,
        order: async () => antworten.get(table) ?? { data: [], error: null },
        maybeSingle: async () => antworten.get(`${table}:${state.postId}`) ?? { data: null, error: null },
      }
      return chain
    },
  }),
}))

import {
  extractArticlesFromContent,
  getCompanyMentions,
  getTranslatedArticlesByPost,
} from '@/lib/companies/company-page-data'

const doc = (...nodes: unknown[]) => ({ type: 'doc', content: nodes })
const h2 = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

beforeEach(() => antworten.clear())

describe('extractArticlesFromContent', () => {
  it('liefert Überschrift und Anriss je H2-Artikel und überspringt Synthszr Take', () => {
    const a = extractArticlesFromContent(doc(h2('Erste Meldung'), p('Text eins.'), h2('Synthszr Take'), p('Meinung'), h2('Zweite'), p('Text zwei.')))
    expect(a.map((x) => x.headline)).toEqual(['Erste Meldung', 'Zweite'])
    expect(a[0].excerpt).toContain('Text eins.')
  })

  it('kommt mit leerem oder fremdem Inhalt zurecht', () => {
    expect(extractArticlesFromContent(null)).toEqual([])
    expect(extractArticlesFromContent({ foo: 1 })).toEqual([])
  })
})

describe('getTranslatedArticlesByPost', () => {
  it('liefert je Post die extrahierten Artikel und überspringt fehlende Übersetzungen', async () => {
    antworten.set('content_translations:p1', { data: { content: doc(h2('Headline EN'), p('Body')) }, error: null })
    antworten.set('content_translations:p2', { data: null, error: null })
    const map = await getTranslatedArticlesByPost(['p1', 'p2'], 'en')
    expect(map.get('p1')?.[0].headline).toBe('Headline EN')
    expect(map.has('p2')).toBe(false)
  })

  it('lässt einen fehlerhaften Post aus, statt die Seite scheitern zu lassen', async () => {
    antworten.set('content_translations:p1', { data: null, error: { message: 'timeout' } })
    antworten.set('content_translations:p2', { data: { content: doc(h2('Zwei'), p('x')) }, error: null })
    const map = await getTranslatedArticlesByPost(['p1', 'p2'], 'en')
    expect([...map.keys()]).toEqual(['p2'])
  })

  it('verarbeitet auch sehr viele Posts vollständig', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `p${i}`)
    for (const id of ids) antworten.set(`content_translations:${id}`, { data: { content: doc(h2(id), p('x')) }, error: null })
    const map = await getTranslatedArticlesByPost(ids, 'en')
    expect(map.size).toBe(60)
  })
})

describe('getCompanyMentions', () => {
  it('wirft bei einem Datenbankfehler, damit keine leere Liste 24 h im Cache landet', async () => {
    antworten.set('post_company_mentions', { data: null, error: { message: 'kaputt' } })
    await expect(getCompanyMentions('openai')).rejects.toThrow(/kaputt/)
  })

  it('liefert die Zeilen der Abfrage', async () => {
    antworten.set('post_company_mentions', { data: [{ company_name: 'OpenAI' }], error: null })
    expect(await getCompanyMentions('openai')).toEqual([{ company_name: 'OpenAI' }])
  })
})

describe('Cache-Konfiguration', () => {
  const finde = (key: string) => konfiguriert.find((k) => k.keys.includes(key))

  it('cacht Erwähnungen je Firma 24 h, invalidiert über company-mentions', () => {
    const c = finde('company-mentions-v1')
    expect(c?.opts.revalidate).toBe(86400)
    expect(c?.opts.tags).toContain('company-mentions')
  })

  it('cacht übersetzte Artikel je Post und Sprache 24 h, invalidiert über content-translations', () => {
    const c = finde('company-translated-articles-v1')
    expect(c?.opts.revalidate).toBe(86400)
    expect(c?.opts.tags).toContain('content-translations')
  })
})
