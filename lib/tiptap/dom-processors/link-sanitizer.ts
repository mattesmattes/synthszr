// DOM processor: Sanitize all outbound link hrefs

import { sanitizeUrl } from '@/lib/utils/url-sanitizer'

/**
 * Sanitize all outbound link hrefs in the container.
 * Removes tracking params, subscriber IDs, etc.
 */
export function sanitizeAllLinks(container: HTMLElement): void {
  const allLinks = container.querySelectorAll('a[href]')
  allLinks.forEach((a: Element) => {
    const href = a.getAttribute('href')
    if (href && href.startsWith('http')) {
      const clean = sanitizeUrl(href)
      if (clean && clean !== href) {
        a.setAttribute('href', clean)
      }
    }
  })
}
