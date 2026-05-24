/**
 * Convert TipTap JSON content to Markdown
 * For machine-readable view of blog posts
 */

import type { TiptapNode, TiptapDoc } from '@/lib/email/tiptap-to-html'

export interface ConvertOptions {
  /**
   * Keep `{Company}` style explicit tags verbatim in the output.
   * Default is to strip them — the reader view and email rendering
   * don't want them visible. The Editor-in-Chief re-run pipeline
   * (tiptap → markdown → LLM → markdown → tiptap) needs them
   * preserved or the LLM never sees the structural markers that
   * drive the Synthszr Vote badges in the rendered article.
   */
  preserveCompanyTags?: boolean
}

/**
 * Convert a TipTap document to Markdown string
 */
export function convertTiptapToMarkdown(doc: TiptapDoc, options: ConvertOptions = {}): string {
  if (!doc.content) return ''
  return doc.content.map((node, index, arr) => convertNodeToMarkdown(node, index, arr, options)).join('\n\n')
}

/**
 * Convert a single TipTap node to Markdown
 */
function convertNodeToMarkdown(node: TiptapNode, _index: number = 0, _siblings: TiptapNode[] = [], options: ConvertOptions = {}): string {
  switch (node.type) {
    case 'paragraph': {
      const content = renderContent(node.content, options)
      // Empty paragraphs become empty lines
      return content || ''
    }

    case 'heading': {
      const level = Number(node.attrs?.level) || 2
      const prefix = '#'.repeat(level)
      return `${prefix} ${renderContent(node.content, options)}`
    }

    case 'bulletList': {
      return (node.content || [])
        .map(li => `- ${renderListItemContent(li, options)}`)
        .join('\n')
    }

    case 'orderedList': {
      return (node.content || [])
        .map((li, idx) => `${idx + 1}. ${renderListItemContent(li, options)}`)
        .join('\n')
    }

    case 'listItem': {
      return renderListItemContent(node, options)
    }

    case 'blockquote': {
      const content = (node.content || [])
        .map(child => convertNodeToMarkdown(child, 0, [], options))
        .join('\n\n')
      // Prefix each line with >
      return content.split('\n').map(line => `> ${line}`).join('\n')
    }

    case 'codeBlock': {
      const language = node.attrs?.language || ''
      const code = renderContent(node.content, options)
      return `\`\`\`${language}\n${code}\n\`\`\``
    }

    case 'horizontalRule':
      return '---'

    case 'hardBreak':
      return '  \n' // Two spaces + newline for hard break in Markdown

    case 'text':
      return renderTextNode(node, options)

    default:
      // Unknown node types - try to render content or return empty
      return node.content ? renderContent(node.content, options) : ''
  }
}

/**
 * Render list item content (handles nested paragraph structure)
 */
function renderListItemContent(listItem: TiptapNode, options: ConvertOptions): string {
  if (!listItem.content) return ''

  // List items typically contain paragraphs
  return listItem.content
    .map(child => {
      if (child.type === 'paragraph') {
        return renderContent(child.content, options)
      }
      return convertNodeToMarkdown(child, 0, [], options)
    })
    .join('\n')
}

/**
 * Render an array of content nodes to Markdown text
 */
function renderContent(content: TiptapNode[] | undefined, options: ConvertOptions): string {
  if (!content) return ''
  return content.map(n => renderTextNode(n, options)).join('')
}

/**
 * Render a text node with its marks (bold, italic, link, code)
 */
function renderTextNode(node: TiptapNode, options: ConvertOptions): string {
  if (node.type !== 'text') {
    // Non-text node in content array - convert it
    return convertNodeToMarkdown(node, 0, [], options)
  }

  let text = node.text || ''

  // Strip {Company} explicit tags from display unless the caller
  // (EIC re-run pipeline) needs them preserved.
  if (!options.preserveCompanyTags) {
    text = text.replace(/\{([^}]+)\}/g, '')
  }

  if (!text) return ''

  // Apply marks in the correct order (innermost first)
  // Order: code, then bold/italic, then link
  if (!node.marks) return text

  // Collect marks by type
  const hasCode = node.marks.some(m => m.type === 'code')
  const hasBold = node.marks.some(m => m.type === 'bold')
  const hasItalic = node.marks.some(m => m.type === 'italic')
  const linkMark = node.marks.find(m => m.type === 'link')

  // Apply code first (innermost)
  if (hasCode) {
    text = `\`${text}\``
  }

  // Apply bold/italic
  if (hasBold && hasItalic) {
    text = `***${text}***`
  } else if (hasBold) {
    text = `**${text}**`
  } else if (hasItalic) {
    text = `*${text}*`
  }

  // Apply link (outermost)
  if (linkMark) {
    const href = linkMark.attrs?.href || '#'
    text = `[${text}](${href})`
  }

  return text
}

/**
 * Parse TipTap JSON content (handles both string and object)
 */
export function parseTiptapContent(content: unknown): TiptapDoc | null {
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return parsed as TiptapDoc
      }
    } catch {
      return null
    }
  } else if (content && typeof content === 'object' && (content as TiptapDoc).type === 'doc') {
    return content as TiptapDoc
  }
  return null
}

/**
 * Generate Markdown with YAML frontmatter for a post
 */
export function generatePostMarkdown(post: {
  title: string
  slug: string
  excerpt?: string | null
  category?: string | null
  created_at: string
  content: unknown
}): string {
  const doc = parseTiptapContent(post.content)
  if (!doc) {
    return `# ${post.title}\n\n*Content could not be converted*`
  }

  const frontmatter = [
    '---',
    `title: "${post.title.replace(/"/g, '\\"')}"`,
    `slug: "${post.slug}"`,
    `date: "${post.created_at}"`,
  ]

  if (post.category) {
    frontmatter.push(`category: "${post.category}"`)
  }

  if (post.excerpt) {
    frontmatter.push(`excerpt: "${post.excerpt.replace(/"/g, '\\"')}"`)
  }

  frontmatter.push('---')

  const markdown = convertTiptapToMarkdown(doc)

  return `${frontmatter.join('\n')}\n\n${markdown}`
}
