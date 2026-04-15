import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'span', 'small',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'style', 'class']

/**
 * Sanitize admin-authored HTML (e.g. ad-promo body rich text) before it
 * reaches dangerouslySetInnerHTML or the email renderer. Blocks <script>,
 * event handlers (onclick/onerror/…), javascript: URLs, and anything
 * outside the small allowlist above.
 */
export function sanitizeAdminHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
  })
}
