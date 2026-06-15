/**
 * Frontmatter parsing for ghostwriter-generated articles.
 *
 * The ghostwriter pipeline emits markdown with a leading frontmatter block:
 *   ---
 *   TITLE: ...
 *   EXCERPT:
 *   • ...
 *   CATEGORY: ...
 *   ---
 *   <body>
 *
 * This module is the single source of truth for turning that raw markdown into
 * { metadata, body }. Both the manual Create-Article flow and the scheduled
 * cron auto-post import it, so the parse can't drift between the two callers.
 *
 * Pure, dependency-free — safe to import in both client and server contexts.
 */

export interface ArticleMetadata {
  title: string
  excerpt: string
  category: string
  slug: string
}

// Generate slug from title (German umlaut transliteration, max 80 chars)
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// Parse frontmatter from generated content
export function parseArticleContent(content: string): { metadata: ArticleMetadata; body: string } {
  const defaultMetadata: ArticleMetadata = {
    title: '',
    excerpt: '',
    category: 'AI & Tech',
    slug: ''
  }

  // Match frontmatter block
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    // No frontmatter, try to extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      defaultMetadata.title = titleMatch[1]
      defaultMetadata.slug = generateSlug(titleMatch[1])
    }
    return { metadata: defaultMetadata, body: content }
  }

  const [, frontmatter, body] = frontmatterMatch
  const metadata = { ...defaultMetadata }

  // Parse frontmatter fields
  const titleMatch = frontmatter.match(/TITLE:\s*(.+)/i)
  const categoryMatch = frontmatter.match(/CATEGORY:\s*(.+)/i)

  // Excerpt can be multi-line (bullet points between EXCERPT: and CATEGORY:)
  const excerptMatch = frontmatter.match(/EXCERPT:\s*\n?([\s\S]*?)(?=\nCATEGORY:)/i)
    || frontmatter.match(/EXCERPT:\s*(.+)/i)

  if (titleMatch) metadata.title = titleMatch[1].trim()
  if (excerptMatch) metadata.excerpt = excerptMatch[1].trim()
  if (categoryMatch) metadata.category = categoryMatch[1].trim()

  metadata.slug = generateSlug(metadata.title)

  // Ensure excerpt has 3 bullet points — fill from article H2 headings if LLM generated fewer
  const existingBullets = metadata.excerpt.split('\n').filter(l => l.trim().startsWith('•'))
  if (existingBullets.length < 3) {
    const h2Matches = body.match(/^##\s+(.+)$/gm) || []
    const h2Titles = h2Matches.map(h => h.replace(/^##\s+/, '').trim())
    const bullets = [...existingBullets]
    for (const h2 of h2Titles) {
      if (bullets.length >= 3) break
      // Skip if this heading is already in a bullet
      if (bullets.some(b => b.includes(h2.slice(0, 20)))) continue
      // Truncate to 65 chars
      const truncated = h2.length > 65 ? h2.slice(0, 62) + '...' : h2
      bullets.push(`• ${truncated}`)
    }
    if (bullets.length >= 3) {
      metadata.excerpt = bullets.join('\n')
    }
  }

  return { metadata, body: body.trim() }
}
