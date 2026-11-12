/**
 * Top sources (Admin → News & Synthese → Top sources, Betreiber 2026-11-12).
 *
 * Eine „Source“ ist ein Link im veröffentlichten Post, also das, was am Ende
 * des Tages tatsächlich als Quelle hinter den rund zehn Meldungen steht. Gezählt
 * wird je Domain (ohne „www.“, Subdomains wie autor.substack.com bleiben
 * getrennt), jede URL einmal je Post. Interne Links (synthszr.com) und
 * relative Links zählen nicht.
 */

export interface SourcePost {
  id: string
  created_at: string
  content: unknown
}

export interface SourceRank {
  host: string
  /** Verschiedene Links auf diese Domain, je Post einmal gezählt. */
  links: number
  /** Posts, in denen die Domain mindestens einmal vorkommt. */
  posts: number
  /** Jüngster Post mit dieser Domain (ISO). */
  lastUsed: string
}

/** Alle link-hrefs eines TipTap-Dokuments (auch als JSON-String). */
export function linkHrefs(doc: unknown): string[] {
  let root = doc
  if (typeof root === 'string') {
    try { root = JSON.parse(root) } catch { return [] }
  }
  const out: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const n = node as { marks?: unknown; content?: unknown }
    if (Array.isArray(n.marks)) {
      for (const m of n.marks as Array<{ type?: string; attrs?: { href?: unknown } }>) {
        if (m?.type === 'link' && typeof m.attrs?.href === 'string') out.push(m.attrs.href)
      }
    }
    if (n.content) walk(n.content)
  }
  walk(root)
  return out
}

/** Domain einer Quelle, oder null für interne, relative und Nicht-Web-Links. */
export function sourceHost(href: string): string | null {
  let url: URL
  try { url = new URL(href.trim()) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!host || host === 'synthszr.com' || host.endsWith('.synthszr.com')) return null
  return host
}

/** Ranking nach Zahl der Links, bei Gleichstand nach Posts, dann Name. */
export function rankSources(posts: SourcePost[], limit = 50): SourceRank[] {
  const byHost = new Map<string, { links: number; posts: Set<string>; lastUsed: string }>()
  for (const post of posts) {
    const seen = new Set<string>()
    for (const href of linkHrefs(post.content)) {
      const host = sourceHost(href)
      if (!host) continue
      const key = href.trim()
      if (seen.has(key)) continue
      seen.add(key)
      const entry = byHost.get(host) ?? { links: 0, posts: new Set<string>(), lastUsed: post.created_at }
      entry.links += 1
      entry.posts.add(post.id)
      if (post.created_at > entry.lastUsed) entry.lastUsed = post.created_at
      byHost.set(host, entry)
    }
  }
  return [...byHost.entries()]
    .map(([host, e]) => ({ host, links: e.links, posts: e.posts.size, lastUsed: e.lastUsed }))
    .sort((a, b) => b.links - a.links || b.posts - a.posts || a.host.localeCompare(b.host))
    .slice(0, limit)
}
