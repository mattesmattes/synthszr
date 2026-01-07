/**
 * Convert TipTap JSON content to email-friendly HTML
 * Shared module for newsletter email generation
 */

export interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  attrs?: Record<string, string | number>
}

export interface TiptapDoc {
  type: string
  content?: TiptapNode[]
}

/**
 * Convert post content to email-friendly HTML
 * Handles both TipTap JSON objects and JSON strings
 */
export function generateEmailContent(post: { content?: unknown; excerpt?: string }): string {
  const rawContent = post.content

  // If content is a JSON string, parse it first
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return convertTiptapToHtml(parsed as TiptapDoc)
      }
    } catch {
      // Not JSON, might be HTML string - use as is
      return rawContent
    }
    // If we couldn't parse it and it's a string, return as is
    return rawContent
  }

  // If content is TipTap JSON object, convert to basic HTML
  if (rawContent && typeof rawContent === 'object') {
    return convertTiptapToHtml(rawContent as TiptapDoc)
  }

  // Fallback to excerpt
  return post.excerpt || ''
}

/**
 * Convert TipTap document to HTML
 */
export function convertTiptapToHtml(doc: TiptapDoc): string {
  if (!doc.content) return ''

  return doc.content.map((node: TiptapNode) => {
    switch (node.type) {
      case 'paragraph':
        return `<p>${renderContent(node.content)}</p>`
      case 'heading': {
        const level = node.attrs?.level || 2
        return `<h${level}>${renderContent(node.content)}</h${level}>`
      }
      case 'bulletList':
        return `<ul>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ul>`
      case 'orderedList':
        return `<ol>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ol>`
      case 'blockquote':
        return `<blockquote>${renderContent(node.content)}</blockquote>`
      case 'horizontalRule':
        return '<hr />'
      default:
        return renderContent(node.content)
    }
  }).join('\n')
}

/**
 * Render TipTap node content with marks (bold, italic, links)
 * Includes special styling for "Synthszr Take:" sections
 */
function renderContent(content?: TiptapNode[]): string {
  if (!content) return ''

  return content.map(node => {
    if (node.type === 'text') {
      let text = node.text || ''

      // Check if text contains "Synthszr Take:" and style it
      const synthszrPattern = /(Synthszr Take:?)/gi
      const hasBoldMark = node.marks?.some(m => m.type === 'bold')

      // If "Synthszr Take:" is not already bold, wrap it with styling
      if (!hasBoldMark && synthszrPattern.test(text)) {
        text = text.replace(synthszrPattern, '<strong style="background-color: #CCFF00; padding: 2px 6px;">$1</strong>')
      }

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              // Check if this is "Synthszr Take:" - add background styling
              if (/synthszr take:?/i.test(text)) {
                text = `<strong style="background-color: #CCFF00; padding: 2px 6px;">${text}</strong>`
              } else {
                text = `<strong>${text}</strong>`
              }
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'link':
              text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
              break
          }
        }
      }

      return text
    }

    return ''
  }).join('')
}
