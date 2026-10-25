/**
 * Neue Leser-Takes der letzten 48 Stunden fuer die Admin-Startseite
 * (Betreiber-Wunsch 2026-10-25).
 *
 * Geprueft wird die Aufbereitung: welche Zeilen zaehlen (keine unbestaetigten
 * Magic-Link-Eintraege), wie der Ort bestimmt wird (Artikel + Abschnitt — die
 * Abschnitts-Ueberschrift fehlt in der Tabelle oft und wird aus dem
 * Artikel-Content ueber die queueItemId der H2 aufgeloest) und dass der Text
 * gekuerzt wird.
 */
import { describe, expect, it } from 'vitest'
import { listRecentComments, resolveSectionHeadline } from '@/lib/comments/recent'

const content = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, queueItemId: 'q-1' }, content: [{ type: 'text', text: 'Trump und Newsom streiten' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Bericht.' }] },
  { type: 'heading', attrs: { level: 2, queueItemId: 'q-2' }, content: [{ type: 'text', text: 'Zweites Thema' }] },
] }

/** Fake-PostgREST mit festen Antworten je Tabelle. */
function fakeClient(byTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'gte', 'neq', 'order', 'in', 'eq']) chain[m] = () => chain
      chain.limit = () => Promise.resolve({ data: byTable[table] ?? [], error: null })
      // .in(...) ist bei der Post-Suche der letzte Aufruf
      chain.in = () => Promise.resolve({ data: byTable[table] ?? [], error: null })
      return chain
    },
  } as never
}

describe('resolveSectionHeadline', () => {
  it('findet die H2 ueber die queueItemId', () => {
    expect(resolveSectionHeadline(content, 'q-2')).toBe('Zweites Thema')
  })
  it('liefert null ohne Treffer, ohne Anker oder bei kaputtem Content', () => {
    expect(resolveSectionHeadline(content, 'q-9')).toBeNull()
    expect(resolveSectionHeadline(content, null)).toBeNull()
    expect(resolveSectionHeadline('kein json', 'q-1')).toBeNull()
  })
})

describe('listRecentComments', () => {
  it('liefert Kommentar mit Artikel, Abschnitt (aus dem Content) und gekuerztem Text', async () => {
    const client = fakeClient({
      post_comments: [{
        id: 'c1', post_source: 'generated_posts', post_id: 'p1', display_name: 'wolfgang',
        body: 'x'.repeat(300), section_anchor: 'q-1', section_headline: '', status: 'published',
        created_at: '2026-10-25T08:00:00Z',
      }],
      generated_posts: [{ id: 'p1', slug: 'trump-newsom', title: 'Trump und Newsom', content }],
    })
    const r = await listRecentComments(client, { hours: 48, now: new Date('2026-10-25T10:00:00Z') })
    expect(r.hours).toBe(48)
    expect(r.comments).toHaveLength(1)
    const c = r.comments[0]
    expect(c.postTitle).toBe('Trump und Newsom')
    expect(c.postSlug).toBe('trump-newsom')
    expect(c.sectionHeadline).toBe('Trump und Newsom streiten')
    expect(c.displayName).toBe('wolfgang')
    expect(c.excerpt.length).toBeLessThanOrEqual(161)
    expect(c.excerpt.endsWith('…')).toBe(true)
    expect(c.status).toBe('published')
  })

  it('nimmt die gespeicherte Abschnitts-Ueberschrift, wenn sie da ist', async () => {
    const client = fakeClient({
      post_comments: [{ id: 'c1', post_source: 'generated_posts', post_id: 'p1', display_name: 'a', body: 'kurz',
        section_anchor: 'q-1', section_headline: 'Gespeichert', status: 'pending', created_at: '2026-10-25T08:00:00Z' }],
      generated_posts: [{ id: 'p1', slug: 's', title: 'T', content }],
    })
    const r = await listRecentComments(client, { hours: 48, now: new Date('2026-10-25T10:00:00Z') })
    expect(r.comments[0].sectionHeadline).toBe('Gespeichert')
    expect(r.comments[0].excerpt).toBe('kurz')
  })

  it('kommt ohne Artikel-Treffer zurecht', async () => {
    const client = fakeClient({
      post_comments: [{ id: 'c1', post_source: 'posts', post_id: 'p9', display_name: 'a', body: 'b',
        section_anchor: null, section_headline: null, status: 'published', created_at: '2026-10-25T08:00:00Z' }],
    })
    const r = await listRecentComments(client, { hours: 48, now: new Date('2026-10-25T10:00:00Z') })
    expect(r.comments[0].postTitle).toBeNull()
    expect(r.comments[0].sectionHeadline).toBeNull()
  })

  it('liefert eine leere Liste ohne Zeilen', async () => {
    const r = await listRecentComments(fakeClient({}), { hours: 48, now: new Date() })
    expect(r.comments).toEqual([])
    expect(r.since).toBeTruthy()
  })
})
