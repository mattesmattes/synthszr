/**
 * „Die letzten N News, in denen das Unternehmen vorkam" — für die Stocks-Seite
 * und den Unternehmens-Block unter einem Artikel.
 *
 * Gegen einen Fake-Client getestet, der die PostgREST-Kette nachbildet. Das prüft
 * genau die Dinge, die hier schiefgehen können und die ein Mock der Rückgabe
 * NICHT bemerken würde: dass nur veröffentlichte Posts gezählt werden, dass der
 * Slug case-insensitiv trifft, dass das Limit greift und dass ein Post, der eine
 * Firma zweimal nennt, nicht zweimal in der Liste steht.
 */
import { describe, expect, it, vi } from 'vitest'
import { getRecentPostsForCompany, getCompanyMentionsForPost } from '@/lib/companies/recent-posts'

type Row = Record<string, unknown>

/** Fake-PostgREST: sammelt die Kette und gibt `rows` zurück. */
function fakeClient(rows: Row[]) {
  const calls: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    ilike: vi.fn((col: string, val: string) => { calls.ilike = [col, val]; return chain }),
    eq: vi.fn((col: string, val: unknown) => { calls[`eq:${col}`] = val; return chain }),
    order: vi.fn((col: string, opts?: unknown) => { calls.order = [col, opts]; return chain }),
    limit: vi.fn((n: number) => { calls.limit = n; return Promise.resolve({ data: rows, error: null }) }),
  }
  return {
    client: { from: vi.fn((t: string) => { calls.from = t; return chain }) },
    calls,
  }
}

function mentionRow(slug: string, title: string, date: string, status = 'published'): Row {
  return { company_name: 'Nvidia', company_slug: 'nvidia', company_type: 'public',
    post: { slug, title, created_at: date, status } }
}

describe('getRecentPostsForCompany', () => {
  it('liefert die Posts einer Firma, neueste zuerst', async () => {
    const { client } = fakeClient([
      mentionRow('post-b', 'Neuer', '2026-08-02'),
      mentionRow('post-a', 'Älter', '2026-08-01'),
    ])
    const posts = await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(posts.map((p) => p.slug)).toEqual(['post-b', 'post-a'])
    expect(posts[0].title).toBe('Neuer')
  })

  it('fragt NUR veröffentlichte Posts ab', async () => {
    // Ein Entwurf im Block wäre ein Link auf eine Seite, die 404 liefert.
    const { client, calls } = fakeClient([])
    await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(calls['eq:post.status']).toBe('published')
  })

  it('trifft den Slug case-insensitiv', async () => {
    // Die Companies-Detailseite tut das ebenfalls: in post_company_mentions
    // stehen Slugs in gemischter Schreibweise.
    const { client, calls } = fakeClient([])
    await getRecentPostsForCompany(client as never, 'NVIDIA', 7)
    expect(calls.ilike).toEqual(['company_slug', 'NVIDIA'])
  })

  it('lädt MEHR Zeilen als angefordert, weil ein Post mehrfach vorkommen kann', async () => {
    // An Prod-Daten gemessen (2026-08-04): für "nvidia" waren 8 Mention-Zeilen nur
    // 5 verschiedene Posts — Sammelartikel führen dieselbe Firma über
    // article_index mehrfach. Mit limit(7) blieben nach der Deduplizierung also
    // regelmäßig 4-5 News übrig statt 7. Der Aufschlag ist bewusst begrenzt und
    // nicht "alles laden": das wäre die Egress-Falle des history-JSONB.
    const { client, calls } = fakeClient([])
    await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(calls.limit).toBeGreaterThan(7)
    expect(calls.limit).toBeLessThanOrEqual(40)
  })

  it('gibt nach der Deduplizierung höchstens `limit` Posts zurück', async () => {
    // Die Kehrseite des Aufschlags: ohne Kürzung stünden bis zu 28 News im Block.
    const rows = Array.from({ length: 12 }, (_, i) =>
      mentionRow(`post-${i}`, `Titel ${i}`, '2026-08-01'))
    const { client } = fakeClient(rows)
    const posts = await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(posts).toHaveLength(7)
  })

  it('führt einen Post nur EINMAL auf, auch wenn er mehrere Mentions hat', async () => {
    // UNIQUE(post_id, company_slug) verhindert Duplikate pro Firma, aber
    // article_index macht mehrere Zeilen pro Post möglich (Sammelartikel).
    const { client } = fakeClient([
      mentionRow('post-a', 'Titel', '2026-08-01'),
      mentionRow('post-a', 'Titel', '2026-08-01'),
    ])
    const posts = await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(posts).toHaveLength(1)
  })

  it('lässt Zeilen ohne verknüpften Post weg, statt einen leeren Link zu bauen', async () => {
    const { client } = fakeClient([
      { company_slug: 'nvidia', post: null },
      mentionRow('post-a', 'Titel', '2026-08-01'),
    ])
    const posts = await getRecentPostsForCompany(client as never, 'nvidia', 7)
    expect(posts.map((p) => p.slug)).toEqual(['post-a'])
  })

  it('gibt bei einem Datenbankfehler eine leere Liste zurück, statt die Seite zu reißen', async () => {
    const chain: Record<string, unknown> = {
      select: () => chain, ilike: () => chain, eq: () => chain, order: () => chain,
      limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    }
    const client = { from: () => chain }
    await expect(getRecentPostsForCompany(client as never, 'nvidia', 7)).resolves.toEqual([])
  })
})

describe('getCompanyMentionsForPost', () => {
  it('liefert public und premarket getrennt unterscheidbar', async () => {
    // Der Block unter dem Artikel verlinkt beide auf /companies/<slug>, aber die
    // Kennzeichnung entscheidet über das Label ("Börsennotiert" vs "Premarket").
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({
        data: [
          { company_name: 'Nvidia', company_slug: 'nvidia', company_type: 'public' },
          { company_name: 'Anthropic', company_slug: 'anthropic', company_type: 'premarket' },
        ],
        error: null,
      }),
    }
    const client = { from: () => chain }
    const rows = await getCompanyMentionsForPost(client as never, 'post-id')
    expect(rows).toEqual([
      { name: 'Nvidia', slug: 'nvidia', type: 'public' },
      { name: 'Anthropic', slug: 'anthropic', type: 'premarket' },
    ])
  })

  it('entfernt Doppelnennungen derselben Firma', async () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({
        data: [
          { company_name: 'Nvidia', company_slug: 'nvidia', company_type: 'public' },
          { company_name: 'NVIDIA', company_slug: 'Nvidia', company_type: 'public' },
        ],
        error: null,
      }),
    }
    const client = { from: () => chain }
    const rows = await getCompanyMentionsForPost(client as never, 'post-id')
    expect(rows).toHaveLength(1)
  })

  it('gibt bei einem Fehler eine leere Liste zurück', async () => {
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain,
      order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    }
    const client = { from: () => chain }
    await expect(getCompanyMentionsForPost(client as never, 'p')).resolves.toEqual([])
  })
})
