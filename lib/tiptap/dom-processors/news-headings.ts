// DOM processor: Process news headings (favicon, source links, thumbnails)

import { sanitizeUrl } from '@/lib/utils/url-sanitizer'

export interface ArticleThumbnail {
  id: string
  article_index: number
  article_queue_item_id: string | null
  image_url: string
  vote_color: string
  generation_status: string
}

export interface ThumbnailPortal {
  element: HTMLElement
  thumbnail: ArticleThumbnail
  h2Element: HTMLElement
}

/**
 * Process news headings: add favicon + link, remove source links from paragraphs, insert thumbnail placeholders.
 *
 * @param container - The root container element
 * @param thumbnails - Available article thumbnails
 * @param queueItemIds - Optional queue item IDs for stable thumbnail matching
 * @returns Array of thumbnail portal descriptors for React portal rendering
 */
export function processNewsHeadings(
  container: HTMLElement,
  thumbnails: ArticleThumbnail[],
  queueItemIds?: string[],
): ThumbnailPortal[] {
  // Find all H2 headings (news headlines)
  const h2s = container.querySelectorAll('h2')
  const newThumbnailPortals: ThumbnailPortal[] = []
  let articleIndex = 0

  h2s.forEach((h2) => {
    // Skip "Mattes Synthese" / "Synthszr Take" headings entirely
    const headingText = h2.textContent?.toLowerCase() || ''
    if (headingText.includes('mattes synthese') || headingText.includes("mattes' synthese") || headingText.includes('synthszr take') || headingText.includes('synthszr contra')) return

    // Get queue item ID for thumbnail matching
    // PRIORITY ORDER:
    // 1. data-queue-item-id from DOM (most stable - survives reordering)
    // 2. queueItemIds array by position (legacy fallback)
    // 3. article_index match (oldest fallback)
    const domQueueItemId = h2.getAttribute('data-queue-item-id')
    const arrayQueueItemId = queueItemIds?.[articleIndex]
    const expectedQueueItemId = domQueueItemId || arrayQueueItemId

    // THUMBNAIL INSERTION: Check separately from main processing
    if (!h2.previousElementSibling?.classList.contains('article-thumbnail-container')) {
      const thumbnail = thumbnails.find(t => {
        if (t.generation_status !== 'completed') return false
        if (expectedQueueItemId && t.article_queue_item_id === expectedQueueItemId) {
          return true
        }
        return t.article_index === articleIndex
      })
      if (thumbnail) {
        // Add separator before thumbnail (except for first article)
        if (articleIndex > 0) {
          const separator = document.createElement('div')
          separator.className = 'article-separator h-8 my-8'
          h2.parentNode?.insertBefore(separator, h2)
        }
        const thumbnailContainer = document.createElement('div')
        thumbnailContainer.className = 'article-thumbnail-container flex justify-center my-4'
        h2.parentNode?.insertBefore(thumbnailContainer, h2)
        newThumbnailPortals.push({ element: thumbnailContainer, thumbnail, h2Element: h2 as HTMLElement })
      }
    }

    // Skip rest of processing if already processed (favicon, links, etc.)
    const alreadyProcessed = h2.classList.contains('news-heading-processed')

    // Add anchor ID for deep linking
    h2.id = `article-${articleIndex}`
    articleIndex++

    if (alreadyProcessed) return

    // Find the next sibling paragraph that contains a source link
    let nextSibling = h2.nextElementSibling
    let sourceUrl: string | null = null
    let sourceLinkElement: Element | null = null

    for (let i = 0; i < 3 && nextSibling; i++) {
      if (nextSibling.tagName.toLowerCase() === 'p') {
        const links = nextSibling.querySelectorAll('a')
        links.forEach((link) => {
          const linkText = link.textContent || ''
          if (linkText.trim().startsWith('\u2192') || linkText.trim().match(/^\u2192\s/)) {
            sourceUrl = link.getAttribute('href')
            sourceLinkElement = link
          }
        })
        if (sourceUrl) break
      }
      if (nextSibling.tagName.toLowerCase().match(/^h[1-6]$/)) break
      nextSibling = nextSibling.nextElementSibling
    }

    if (sourceUrl) {
      try {
        const url = new URL(sourceUrl)
        let faviconDomain = url.hostname

        // Special handling for Substack
        if (faviconDomain === 'substack.com' || faviconDomain === 'www.substack.com') {
          const linkText = (sourceLinkElement as Element | null)?.textContent || ''
          const substackMatch = linkText.match(/([a-z0-9_-]+)\.substack\.com/i)
          if (substackMatch) {
            faviconDomain = `${substackMatch[1]}.substack.com`
          }
        }

        // Create wrapper link for heading content
        const headingContent = h2.innerHTML
        const faviconImg = document.createElement('img')
        faviconImg.src = `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`
        faviconImg.alt = faviconDomain
        faviconImg.className = 'inline-block w-5 h-5 mr-2 align-middle opacity-70'
        faviconImg.style.marginTop = '-2px'

        const linkWrapper = document.createElement('a')
        linkWrapper.href = sanitizeUrl(sourceUrl) || sourceUrl
        linkWrapper.target = '_blank'
        linkWrapper.rel = 'noopener noreferrer'
        linkWrapper.className = 'no-underline hover:opacity-80 transition-opacity'
        linkWrapper.innerHTML = headingContent

        h2.innerHTML = ''
        h2.appendChild(faviconImg)
        h2.appendChild(linkWrapper)
        h2.classList.add('news-heading-processed')

        // Remove the source link from the paragraph
        if (sourceLinkElement) {
          const linkToRemove = sourceLinkElement as Element
          const parent = linkToRemove.parentNode
          if (parent) {
            const prevSibling = linkToRemove.previousSibling
            if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE) {
              const text = prevSibling.textContent || ''
              prevSibling.textContent = text.replace(/\s*$/, '')
            }
            linkToRemove.remove()
            const nextNode = parent.lastChild
            if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
              const text = nextNode.textContent || ''
              if (text.trim() === '.' || text.trim() === '') {
                nextNode.textContent = text.replace(/\.\s*$/, '')
              }
            }
          }
        }
      } catch {
        // Invalid URL, skip favicon
      }
    }
  })

  return newThumbnailPortals
}
