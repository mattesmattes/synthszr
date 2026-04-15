import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'span', 'small',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]

/**
 * Sanitize admin-authored HTML (e.g. ad-promo body rich text) before it
 * reaches dangerouslySetInnerHTML or the email renderer. Blocks <script>,
 * event handlers (onclick/onerror/…), javascript: URLs, and anything
 * outside the small allowlist above.
 *
 * Uses sanitize-html (pure JS) rather than DOMPurify/jsdom to stay
 * compatible with Next.js Turbopack, which can't bundle node:worker_threads.
 */
export function sanitizeAdminHtml(html: string): string {
  if (!html) return ''
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      '*': ['style', 'class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href'],
    disallowedTagsMode: 'discard',
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
          target: attribs.target === '_blank' ? '_blank' : '_self',
        },
      }),
    },
  })
}
