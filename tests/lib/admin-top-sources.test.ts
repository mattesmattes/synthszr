/**
 * Top sources (Betreiber 2026-11-12): Ranking der Quellen-Domains, auf die
 * die veröffentlichten Posts verlinken.
 */
import { describe, expect, it } from 'vitest'
import { linkHrefs, rankSources, sourceHost } from '@/lib/admin/top-sources'

const link = (href: string, text = 'Quelle') => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
const doc = (...hrefs: string[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: hrefs.map((h) => link(h)) }] })

describe('linkHrefs', () => {
  it('findet Links in verschachtelten Knoten und in JSON-Strings', () => {
    const d = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [link('https://a.com/x'), { type: 'text', text: 'ohne Link' }] }] }] }] }
    expect(linkHrefs(d)).toEqual(['https://a.com/x'])
    expect(linkHrefs(JSON.stringify(doc('https://b.com/y')))).toEqual(['https://b.com/y'])
    expect(linkHrefs('kein json')).toEqual([])
    expect(linkHrefs(null)).toEqual([])
  })
})

describe('sourceHost', () => {
  it('Domain ohne www, Subdomains bleiben', () => {
    expect(sourceHost('https://www.theverge.com/ai/1')).toBe('theverge.com')
    expect(sourceHost('https://TechCrunch.com/2026/x')).toBe('techcrunch.com')
    expect(sourceHost('https://autor.substack.com/p/x')).toBe('autor.substack.com')
  })
  it('interne, relative und Nicht-Web-Links zählen nicht', () => {
    expect(sourceHost('https://www.synthszr.com/de/glossary/x')).toBeNull()
    expect(sourceHost('/de/companies/nvidia')).toBeNull()
    expect(sourceHost('mailto:hi@example.com')).toBeNull()
  })
})

describe('rankSources', () => {
  const posts = [
    { id: 'p1', created_at: '2026-11-10T05:00:00Z', content: doc('https://techcrunch.com/a', 'https://techcrunch.com/a', 'https://techcrunch.com/b', 'https://www.theverge.com/x') },
    { id: 'p2', created_at: '2026-11-11T05:00:00Z', content: doc('https://theverge.com/y', 'https://wsj.com/z') },
  ]

  it('zählt jede URL einmal je Post und rankt nach Links', () => {
    const r = rankSources(posts)
    // Beide 2 Links; theverge steht in zwei Posts und liegt deshalb vorn.
    expect(r.map((s) => s.host)).toEqual(['theverge.com', 'techcrunch.com', 'wsj.com'])
    expect(r[0]).toMatchObject({ links: 2, posts: 2, lastUsed: '2026-11-11T05:00:00Z' })
    expect(r[1]).toMatchObject({ links: 2, posts: 1, lastUsed: '2026-11-10T05:00:00Z' })
  })

  it('bei Gleichstand der Links entscheidet die Zahl der Posts, dann der Name', () => {
    const r = rankSources([
      { id: 'p1', created_at: '2026-11-10T05:00:00Z', content: doc('https://b.com/1', 'https://b.com/2', 'https://a.com/1') },
      { id: 'p2', created_at: '2026-11-11T05:00:00Z', content: doc('https://a.com/2', 'https://c.com/1', 'https://d.com/1') },
    ])
    expect(r.map((s) => s.host)).toEqual(['a.com', 'b.com', 'c.com', 'd.com'])
  })

  it('begrenzt auf limit', () => {
    expect(rankSources(posts, 1)).toHaveLength(1)
  })
})
