// DOM processor: Add Synthszr rating links to Take/Synthese sections

import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { COMPANY_ALIASES } from '@/lib/data/company-aliases'
import { isExcludedCompanyName } from '@/lib/data/company-exclusions'

export interface BatchQuoteResult {
  company: string
  displayName: string
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
}

export interface PremarketRatingResult {
  company: string
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  isin?: string
}

export interface PublicPortal {
  element: HTMLElement
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  ticker?: string
  changePercent?: number
  direction?: 'up' | 'down' | 'neutral'
  isFirst: boolean
}

export interface PremarketPortal {
  element: HTMLElement
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  isFirst: boolean
  isin?: string
}

export interface CompanyLinkEntry {
  displayName: string
  apiName: string
  type: 'public' | 'premarket'
}

export type CompanyLinkData = Map<string, CompanyLinkEntry> // key: displayName.toLowerCase()

export interface RatingLinksResult {
  publicPortals: PublicPortal[]
  premarketPortals: PremarketPortal[]
  companyLinkData: CompanyLinkData
}

/**
 * Add Synthszr rating links at the end of each Synthszr Take section.
 *
 * Scans for company mentions (both natural and {Company} tags) near Synthszr Take markers,
 * fetches batch ratings from APIs, and creates placeholder elements for React portals.
 *
 * @param container - The root container element
 * @param originalContent - Optional original German content for company detection in translations
 * @param generationTriggeredRef - Ref tracking companies already triggered for generation
 * @param onRefreshNeeded - Callback to re-run processing after background generation completes
 */
export async function processSynthszrRatingLinks(
  container: HTMLElement,
  originalContent: Record<string, unknown> | undefined,
  generationTriggeredRef: React.RefObject<Set<string>>,
  onRefreshNeeded: () => void,
): Promise<RatingLinksResult> {
  const emptyResult: RatingLinksResult = { publicPortals: [], premarketPortals: [], companyLinkData: new Map() }

  // Find all Synthszr Take / Mattes Synthese markers
  const syntheszrMarkers = container.querySelectorAll('.mattes-synthese, .mattes-synthese-heading')
  if (syntheszrMarkers.length === 0) return emptyResult

  // Pre-extract {Company} tags from each section of the original content
  const originalSectionTags: string[] = []
  if (originalContent) {
    const extractSectionsWithTags = (doc: unknown): string[] => {
      if (!doc || typeof doc !== 'object') return []
      const d = doc as Record<string, unknown>
      if (!Array.isArray(d.content)) return []

      const sections: string[] = []
      let currentSectionTags = ''

      const extractTagsFromNode = (node: unknown): string => {
        if (!node || typeof node !== 'object') return ''
        const n = node as Record<string, unknown>
        if (n.type === 'text' && typeof n.text === 'string') {
          const matches = n.text.match(/\{[A-Za-z0-9.\-\s]+\}/g)
          return matches ? matches.join(' ') : ''
        }
        if (Array.isArray(n.content)) {
          return n.content.map(extractTagsFromNode).join(' ')
        }
        return ''
      }

      const getNodeText = (node: unknown): string => {
        if (!node || typeof node !== 'object') return ''
        const n = node as Record<string, unknown>
        if (n.type === 'text' && typeof n.text === 'string') return n.text
        if (Array.isArray(n.content)) {
          return n.content.map(getNodeText).join('')
        }
        return ''
      }

      const isSynthszrTakeNode = (node: unknown): boolean => {
        const text = getNodeText(node).toLowerCase()
        return text.includes('synthszr take') ||
               text.includes('synthszr contra') ||
               text.includes('mattes synthese') ||
               text.includes('synthszr vote') ||
               text.includes('synthszr meent') ||    // NDS
               text.includes('pohled synthszr')      // Czech
      }

      for (const node of d.content as unknown[]) {
        const n = node as Record<string, unknown>
        if (n.type === 'paragraph' && isSynthszrTakeNode(node)) {
          currentSectionTags += ' ' + extractTagsFromNode(node)
          sections.push(currentSectionTags.trim())
          currentSectionTags = ''
        } else {
          currentSectionTags += ' ' + extractTagsFromNode(node)
        }
      }
      if (currentSectionTags.trim()) {
        sections.push(currentSectionTags.trim())
      }

      return sections
    }

    originalSectionTags.push(...extractSectionsWithTags(originalContent))
  }

  // For each marker, find the containing paragraph/section and extract companies
  const sectionsToProcess: Array<{
    element: Element
    companies: Array<{ apiName: string; displayName: string }>
    premarketCompanies: Array<{ apiName: string; displayName: string }>
  }> = []

  let sectionIndex = 0
  syntheszrMarkers.forEach((marker) => {
    // Find the paragraph containing this marker
    let markerContainer: Element | null = marker
    while (markerContainer && markerContainer.tagName !== 'P' && markerContainer !== container) {
      markerContainer = markerContainer.parentElement
    }
    if (!markerContainer || markerContainer === container) return

    // Skip if already processed
    if (markerContainer.classList.contains('synthszr-ratings-processed')) return

    // Collect text from the news paragraph(s) BEFORE the Synthszr Take
    // NOTE: Use innerText instead of textContent to preserve whitespace from <br> tags
    let textToSearch = ''
    let prevElement = markerContainer.previousElementSibling
    while (prevElement) {
      const prevText = (prevElement as HTMLElement).innerText || prevElement.textContent || ''
      if (prevElement.tagName.match(/^H[1-6]$/)) {
        // Include heading text (company names often only appear in section headings)
        textToSearch = prevText + ' ' + textToSearch
        break
      }
      if (prevText.toLowerCase().includes('synthszr take') ||
          prevText.toLowerCase().includes('synthszr contra') ||
          prevText.toLowerCase().includes('mattes synthese')) break
      if (prevElement.tagName === 'P') {
        textToSearch = prevText + ' ' + textToSearch
      }
      prevElement = prevElement.previousElementSibling
    }

    // Also include the Synthszr Take paragraph itself
    textToSearch += ' ' + ((markerContainer as HTMLElement).innerText || markerContainer.textContent || '')

    // For translated content, use section-specific {Company} tags from original German content
    const explicitCompanyTags = originalSectionTags[sectionIndex] || ''
    sectionIndex++

    // Find all mentioned public companies
    const companies: Array<{ apiName: string; displayName: string }> = []
    for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
      if (isExcludedCompanyName(displayName)) continue

      const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
      const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
      if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
        companies.push({ apiName, displayName })
      }
    }

    // Find all mentioned premarket companies
    const premarketCompanies: Array<{ apiName: string; displayName: string }> = []
    for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
      if (isExcludedCompanyName(displayName)) continue

      const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
      const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
      if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
        premarketCompanies.push({ apiName, displayName })
      }
    }

    // Check for company aliases (e.g., "Cursor" -> "Anysphere")
    for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
      const escapedAlias = aliasName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`\\b${escapedAlias}s?\\b`, 'gi')
      const explicitRegex = new RegExp(`\\{${escapedAlias}\\}`, 'gi')
      if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
        const apiName = aliasInfo.canonical.toLowerCase()
        if (aliasInfo.type === 'public') {
          if (!companies.find(c => c.apiName === apiName)) {
            companies.push({ apiName, displayName: aliasInfo.canonical })
          }
        } else {
          if (!premarketCompanies.find(c => c.apiName === apiName)) {
            premarketCompanies.push({ apiName, displayName: aliasInfo.canonical })
          }
        }
      }
    }

    if (companies.length > 0 || premarketCompanies.length > 0) {
      sectionsToProcess.push({ element: markerContainer, companies, premarketCompanies })
    }
  })

  // ALSO scan the ENTIRE document for explicit {Company} tags
  const explicitTagPattern = /\{([^}]+)\}/g
  const fullText = (container as HTMLElement).innerText || container.textContent || ''

  // For translated content, also scan originalContent for {Company} tags
  let originalText = ''
  if (originalContent) {
    const extractText = (node: unknown): string => {
      if (!node || typeof node !== 'object') return ''
      const n = node as Record<string, unknown>
      if (n.type === 'text' && typeof n.text === 'string') return n.text
      if (Array.isArray(n.content)) {
        return n.content.map(extractText).join(' ')
      }
      return ''
    }
    originalText = extractText(originalContent)
  }

  const combinedText = fullText + ' ' + originalText
  const explicitMatches = [...combinedText.matchAll(explicitTagPattern)]

  if (explicitMatches.length > 0) {
    const explicitCompanies: Array<{ apiName: string; displayName: string }> = []
    const explicitPremarketCompanies: Array<{ apiName: string; displayName: string }> = []

    for (const match of explicitMatches) {
      const taggedName = match[1].trim()

      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        if (displayName.toLowerCase() === taggedName.toLowerCase()) {
          if (!explicitCompanies.find(c => c.apiName === apiName)) {
            explicitCompanies.push({ apiName, displayName })
          }
          break
        }
      }

      for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
        if (displayName.toLowerCase() === taggedName.toLowerCase()) {
          if (!explicitPremarketCompanies.find(c => c.apiName === apiName)) {
            explicitPremarketCompanies.push({ apiName, displayName })
          }
          break
        }
      }

      for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
        if (aliasName.toLowerCase() === taggedName.toLowerCase()) {
          const apiName = aliasInfo.canonical.toLowerCase()
          if (aliasInfo.type === 'public') {
            if (!explicitCompanies.find(c => c.apiName === apiName)) {
              explicitCompanies.push({ apiName, displayName: aliasInfo.canonical })
            }
          } else {
            if (!explicitPremarketCompanies.find(c => c.apiName === apiName)) {
              explicitPremarketCompanies.push({ apiName, displayName: aliasInfo.canonical })
            }
          }
          break
        }
      }
    }

    if (explicitCompanies.length > 0 || explicitPremarketCompanies.length > 0) {
      const lastParagraph = container.querySelector('p:last-of-type')
      if (lastParagraph && !lastParagraph.classList.contains('synthszr-ratings-processed')) {
        const existingApiNames = new Set(sectionsToProcess.flatMap(s =>
          [...s.companies.map(c => c.apiName), ...s.premarketCompanies.map(c => c.apiName)]
        ))
        const newCompanies = explicitCompanies.filter(c => !existingApiNames.has(c.apiName))
        const newPremarketCompanies = explicitPremarketCompanies.filter(c => !existingApiNames.has(c.apiName))

        if (newCompanies.length > 0 || newPremarketCompanies.length > 0) {
          sectionsToProcess.push({
            element: lastParagraph,
            companies: newCompanies,
            premarketCompanies: newPremarketCompanies
          })
        }
      }
    }
  }

  if (sectionsToProcess.length === 0) return emptyResult

  // Collect all unique companies for batch API calls
  const allPublicCompanies = [...new Set(sectionsToProcess.flatMap(s => s.companies.map(c => c.apiName)))]
  const allPremarketCompanies = [...new Set(sectionsToProcess.flatMap(s => s.premarketCompanies.map(c => c.apiName)))]

  try {
    const [publicResponse, premarketResponse] = await Promise.all([
      allPublicCompanies.length > 0
        ? fetch('/api/stock-synthszr/batch-quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: allPublicCompanies }),
          }).then(r => r.json())
        : Promise.resolve({ ok: true, quotes: [] }),
      allPremarketCompanies.length > 0
        ? fetch('/api/premarket/batch-ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: allPremarketCompanies }),
          }).then(r => r.json())
        : Promise.resolve({ ok: true, ratings: [] }),
    ])

    // Identify companies WITHOUT cached ratings - trigger generation in background
    const companiesWithoutRatings = (publicResponse.ok && publicResponse.quotes || [])
      .filter((r: BatchQuoteResult) => r.rating === null)
      .map((r: BatchQuoteResult) => r.company)
      .filter((company: string) => !generationTriggeredRef.current!.has(company.toLowerCase()))

    if (companiesWithoutRatings.length > 0) {
      console.log(`[TiptapRenderer] Triggering rating generation for ${companiesWithoutRatings.length} companies:`, companiesWithoutRatings)

      companiesWithoutRatings.forEach((company: string) => {
        generationTriggeredRef.current!.add(company.toLowerCase())
      })

      // Fire-and-forget: Generate ratings in background, then call onRefreshNeeded
      Promise.all(
        companiesWithoutRatings.map((company: string) =>
          fetch('/api/stock-synthszr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company }),
          }).catch(err => console.error(`[TiptapRenderer] Rating generation failed for ${company}:`, err))
        )
      ).then(() => {
        console.log('[TiptapRenderer] Rating generation complete, refreshing...')
        setTimeout(() => {
          // Clear processed markers to allow re-processing
          container.querySelectorAll('.synthszr-ratings-processed').forEach(el => {
            el.classList.remove('synthszr-ratings-processed')
            el.querySelectorAll('.synthszr-ratings-container').forEach(c => c.remove())
          })
          onRefreshNeeded()
        }, 500)
      })
    }

    // Build quotes map for public companies
    const publicQuotesMap = new Map<string, BatchQuoteResult>(
      (publicResponse.ok && publicResponse.quotes || [])
        .filter((r: BatchQuoteResult) => r.rating !== null)
        .map((r: BatchQuoteResult) => [r.company.toLowerCase(), r])
    )

    const premarketRatingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; isin?: string }>(
      (premarketResponse.ok && premarketResponse.ratings || [])
        .filter((r: PremarketRatingResult) => r.rating !== null)
        .map((r: PremarketRatingResult) => [r.company.toLowerCase(), { rating: r.rating as 'BUY' | 'HOLD' | 'SELL', isin: r.isin }])
    )

    const publicPortals: PublicPortal[] = []
    const premarketPortals: PremarketPortal[] = []

    // Add rating links to each section
    for (const section of sectionsToProcess) {
      const publicCompaniesWithRatings = section.companies.filter(c =>
        publicQuotesMap.has(c.apiName.toLowerCase())
      )
      const premarketCompaniesWithRatings = section.premarketCompanies.filter(c =>
        premarketRatingsMap.has(c.apiName.toLowerCase())
      )

      if (publicCompaniesWithRatings.length === 0 && premarketCompaniesWithRatings.length === 0) continue

      const ratingsContainer = document.createElement('span')
      ratingsContainer.className = 'synthszr-ratings-container'
      ratingsContainer.style.fontSize = '13px'

      publicCompaniesWithRatings.forEach((company, idx) => {
        const quoteData = publicQuotesMap.get(company.apiName.toLowerCase())
        if (!quoteData || !quoteData.rating) return

        const placeholder = document.createElement('span')
        placeholder.className = 'synthszr-rating-placeholder inline-block'
        placeholder.style.fontSize = '13px'
        placeholder.dataset.company = company.apiName
        placeholder.dataset.displayName = company.displayName
        placeholder.dataset.rating = quoteData.rating

        ratingsContainer.appendChild(placeholder)
        publicPortals.push({
          element: placeholder,
          company: company.apiName,
          displayName: company.displayName,
          rating: quoteData.rating,
          ticker: quoteData.ticker ?? undefined,
          changePercent: quoteData.changePercent ?? undefined,
          direction: quoteData.direction ?? undefined,
          isFirst: idx === 0,
        })
      })

      premarketCompaniesWithRatings.forEach((company, idx) => {
        const ratingData = premarketRatingsMap.get(company.apiName.toLowerCase())
        if (!ratingData) return

        const placeholder = document.createElement('span')
        placeholder.className = 'premarket-rating-placeholder inline-block'
        placeholder.style.fontSize = '13px'
        placeholder.dataset.company = company.apiName
        placeholder.dataset.displayName = company.displayName
        placeholder.dataset.rating = ratingData.rating
        if (ratingData.isin) placeholder.dataset.isin = ratingData.isin

        ratingsContainer.appendChild(placeholder)
        premarketPortals.push({
          element: placeholder,
          company: company.apiName,
          displayName: company.displayName,
          rating: ratingData.rating,
          isFirst: publicCompaniesWithRatings.length === 0 && idx === 0,
          isin: ratingData.isin,
        })
      })

      const space = document.createTextNode(' ')
      section.element.appendChild(space)
      section.element.appendChild(ratingsContainer)
      section.element.classList.add('synthszr-ratings-processed')
    }

    // Build companyLinkData for injecting links into paragraph text
    const companyLinkData: CompanyLinkData = new Map()
    const premarketDisplayNamesMap = new Map<string, string>()
    for (const section of sectionsToProcess) {
      for (const c of section.premarketCompanies) {
        premarketDisplayNamesMap.set(c.apiName.toLowerCase(), c.displayName)
      }
    }
    for (const [apiName, data] of publicQuotesMap) {
      if (data.rating) {
        companyLinkData.set(data.displayName.toLowerCase(), {
          displayName: data.displayName,
          apiName,
          type: 'public',
        })
      }
    }
    for (const [apiName] of premarketRatingsMap) {
      const displayName = premarketDisplayNamesMap.get(apiName)
      if (displayName) {
        companyLinkData.set(displayName.toLowerCase(), {
          displayName,
          apiName,
          type: 'premarket',
        })
      }
    }

    return { publicPortals, premarketPortals, companyLinkData }
  } catch (error) {
    console.error('[TiptapRenderer] Failed to fetch Synthszr ratings:', error)
    return emptyResult
  }
}

/**
 * Inject <a> links around company name mentions in paragraph text.
 * Links point to the company page at /{locale}/companies/{slug}.
 * Must be called AFTER hideExplicitCompanyTags() to avoid matching {Company} tags.
 */
export function injectCompanyLinks(container: HTMLElement, linkData: CompanyLinkData): void {
  if (linkData.size === 0) return

  // Extract locale from current URL path
  const pathParts = window.location.pathname.split('/')
  const locale = ['de', 'en', 'cs', 'nds'].includes(pathParts[1]) ? pathParts[1] : 'de'

  const paragraphs = container.querySelectorAll('p')
  for (const para of paragraphs) {
    if (para.classList.contains('synthszr-company-links-processed')) continue
    para.classList.add('synthszr-company-links-processed')

    // Walk only text nodes, skipping those inside <a> or .synthszr-ratings-container
    const textNodes: Text[] = []
    const walker = document.createTreeWalker(
      para,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node) {
          let parent = node.parentNode
          while (parent && parent !== para) {
            if (
              parent.nodeName === 'A' ||
              (parent instanceof Element && parent.classList.contains('synthszr-ratings-container'))
            ) {
              return NodeFilter.FILTER_REJECT
            }
            parent = parent.parentNode
          }
          return NodeFilter.FILTER_ACCEPT
        }
      }
    )

    let node: Node | null
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text)
    }

    for (const tn of textNodes) {
      injectLinksIntoTextNode(tn, linkData, locale)
    }
  }
}

function injectLinksIntoTextNode(textNode: Text, linkData: CompanyLinkData, locale: string): void {
  const text = textNode.textContent || ''
  if (!text.trim()) return

  const matches: Array<{ start: number; end: number; entry: CompanyLinkEntry }> = []

  for (const [, entry] of linkData) {
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi')
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const hasOverlap = matches.some(m => m.start < match!.index + match![0].length && m.end > match!.index)
      if (!hasOverlap) {
        matches.push({ start: match.index, end: match.index + match[0].length, entry })
      }
    }
  }

  if (matches.length === 0) return

  matches.sort((a, b) => a.start - b.start)

  const parent = textNode.parentNode
  if (!parent) return

  const fragment = document.createDocumentFragment()
  let lastIndex = 0

  for (const match of matches) {
    if (match.start > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)))
    }
    const link = document.createElement('a')
    link.href = `/${locale}/companies/${match.entry.apiName}`
    link.textContent = text.slice(match.start, match.end)
    link.className = 'text-foreground underline hover:text-foreground/70'
    fragment.appendChild(link)
    lastIndex = match.end
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
  }

  parent.replaceChild(fragment, textNode)
}
