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

// Known public companies for Synthszr Vote
const KNOWN_COMPANIES: Record<string, string> = {
  'Apple': 'apple',
  'Microsoft': 'microsoft',
  'Google': 'google',
  'Alphabet': 'alphabet',
  'Amazon': 'amazon',
  'Meta': 'meta',
  'Facebook': 'facebook',
  'Nvidia': 'nvidia',
  'Tesla': 'tesla',
  'Netflix': 'netflix',
  'Salesforce': 'salesforce',
  'Snowflake': 'snowflake',
  'Palantir': 'palantir',
  'CrowdStrike': 'crowdstrike',
  'Uber': 'uber',
  'Airbnb': 'airbnb',
  'Spotify': 'spotify',
  'AMD': 'amd',
  'Intel': 'intel',
  'Oracle': 'oracle',
  'IBM': 'ibm',
  'SAP': 'sap',
  'Shopify': 'shopify',
  'PayPal': 'paypal',
  'Block': 'block',
  'Square': 'square',
  'Coinbase': 'coinbase',
  'Robinhood': 'robinhood',
  'Zoom': 'zoom',
  'DocuSign': 'docusign',
  'Datadog': 'datadog',
  'MongoDB': 'mongodb',
  'Cloudflare': 'cloudflare',
  'Twilio': 'twilio',
  'ServiceNow': 'servicenow',
  'Workday': 'workday',
  'Atlassian': 'atlassian',
  'Adobe': 'adobe',
  'Autodesk': 'autodesk',
  'Intuit': 'intuit',
  'Electronic Arts': 'electronic-arts',
  'EA': 'electronic-arts',
  'Activision': 'activision',
  'Unity': 'unity',
  'Roblox': 'roblox',
  'DoorDash': 'doordash',
  'Instacart': 'instacart',
  'Pinterest': 'pinterest',
  'Snap': 'snap',
  'Twitter': 'twitter',
  'Reddit': 'reddit',
  'Rivian': 'rivian',
  'Lucid': 'lucid',
  'NIO': 'nio',
  'BYD': 'byd',
  'Xiaomi': 'xiaomi',
  'Alibaba': 'alibaba',
  'Tencent': 'tencent',
  'Baidu': 'baidu',
  'JD.com': 'jd',
  'Samsung': 'samsung',
}

// Known premarket companies (pre-IPO / private)
const KNOWN_PREMARKET_COMPANIES: Record<string, string> = {
  'Hugging Face': 'Hugging Face',
  'Dataiku': 'Dataiku',
  'DataRobot': 'DataRobot',
  'Anyscale': 'Anyscale',
  'Lambda': 'Lambda',
  'Replicate': 'Replicate',
  'Together AI': 'Together AI',
  'SambaNova Systems': 'SambaNova Systems',
  'Pinecone': 'Pinecone',
  'Lovable': 'Lovable',
  'Anthropic': 'Anthropic',
  'OpenAI': 'OpenAI',
  'Mistral AI': 'Mistral AI',
  'Cohere': 'Cohere',
  'Perplexity': 'Perplexity',
  'Jasper': 'Jasper',
  'Midjourney': 'Midjourney',
  'Runway': 'Runway',
  'Stability AI': 'Stability AI',
  'Character.AI': 'Character.AI',
  'Inflection AI': 'Inflection AI',
  'Adept': 'Adept',
  'Scale AI': 'Scale AI',
  'Weights & Biases': 'Weights & Biases',
  'Cerebras': 'Cerebras',
  'Groq': 'Groq',
  'xAI': 'xAI',
  'Stripe': 'Stripe',
  'SpaceX': 'SpaceX',
  'Databricks': 'Databricks',
  'Canva': 'Canva',
  'Discord': 'Discord',
  'Figma': 'Figma',
  'Notion': 'Notion',
  'Airtable': 'Airtable',
  'Miro': 'Miro',
  'Vercel': 'Vercel',
  'Supabase': 'Supabase',
  'Retool': 'Retool',
  'Webflow': 'Webflow',
  'Linear': 'Linear',
  'Loom': 'Loom',
  'Calendly': 'Calendly',
  'Grammarly': 'Grammarly',
  'Deel': 'Deel',
  'Rippling': 'Rippling',
  'Gusto': 'Gusto',
  'Plaid': 'Plaid',
  'Chime': 'Chime',
  'Klarna': 'Klarna',
  'Revolut': 'Revolut',
  'Checkout.com': 'Checkout.com',
  'Flexport': 'Flexport',
  'Bolt': 'Bolt',
  'Faire': 'Faire',
  'Rappi': 'Rappi',
  'Shein': 'Shein',
  'ByteDance': 'ByteDance',
  'Epic Games': 'Epic Games',
}

// Rating badge styles (email-safe inline styles)
const RATING_STYLES = {
  BUY: 'background-color: #39FF14; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  HOLD: 'background-color: #9CA3AF; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  SELL: 'background-color: #FF6600; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
}

interface RatingData {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  type: 'public' | 'premarket'
  isin?: string
}

/**
 * Fetch ratings for companies from APIs
 */
async function fetchRatings(
  publicCompanies: string[],
  premarketCompanies: string[],
  baseUrl: string
): Promise<Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>> {
  const ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()

  try {
    const [publicResponse, premarketResponse] = await Promise.all([
      publicCompanies.length > 0
        ? fetch(`${baseUrl}/api/stock-synthszr/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: publicCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
      premarketCompanies.length > 0
        ? fetch(`${baseUrl}/api/premarket/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: premarketCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
    ])

    // Process public ratings
    if (publicResponse.ok && publicResponse.ratings) {
      for (const r of publicResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'public' })
        }
      }
    }

    // Process premarket ratings
    if (premarketResponse.ok && premarketResponse.ratings) {
      for (const r of premarketResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'premarket', isin: r.isin })
        }
      }
    }
  } catch (error) {
    console.error('[tiptap-to-html] Failed to fetch ratings:', error)
  }

  return ratingsMap
}

/**
 * Find companies mentioned in text
 * Supports: natural mentions, possessive forms, compound words, and explicit {Company} tags
 */
function findCompaniesInText(text: string): { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> } {
  const publicCompanies: Array<{ apiName: string; displayName: string }> = []
  const premarketCompanies: Array<{ apiName: string; displayName: string }> = []

  // Find public companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
    const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      publicCompanies.push({ apiName, displayName })
    }
  }

  // Find premarket companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      premarketCompanies.push({ apiName, displayName })
    }
  }

  return { public: publicCompanies, premarket: premarketCompanies }
}

/**
 * Remove {Company} explicit tags from text
 */
function stripExplicitCompanyTags(text: string): string {
  return text.replace(/\{([^}]+)\}/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Generate HTML for vote badges
 * Uses italic style for the text, regular (not-italic) for badges
 */
function generateVoteBadgesHtml(ratings: RatingData[], baseUrl: string, postSlug?: string): string {
  if (ratings.length === 0) return ''

  const badges = ratings.map((r, idx) => {
    const style = RATING_STYLES[r.rating]
    const label = r.rating === 'BUY' ? 'Buy' : r.rating === 'HOLD' ? 'Hold' : 'Sell'
    const prefix = idx === 0 ? 'Synthszr Vote: ' : ', '

    // Link to analysis dialog on the blog post
    const href = postSlug
      ? `${baseUrl}/posts/${postSlug}?${r.type === 'premarket' ? 'premarket' : 'stock'}=${encodeURIComponent(r.displayName)}`
      : '#'

    return `${prefix}<a href="${href}" style="color: inherit; text-decoration: none;">${r.displayName}</a> <a href="${href}" style="${style}">${label}</a>`
  }).join('')

  return `<span style="margin-left: 8px; white-space: nowrap; font-style: italic;"><em>${badges}</em></span>`
}

/**
 * Convert post content to email-friendly HTML (sync version for backwards compatibility)
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
 * Convert post content to email-friendly HTML with Synthszr Vote badges
 * Async version that fetches ratings from APIs
 */
export async function generateEmailContentWithVotes(
  post: { content?: unknown; excerpt?: string; slug?: string },
  baseUrl: string
): Promise<string> {
  const rawContent = post.content
  let doc: TiptapDoc | null = null

  // Parse content
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        doc = parsed as TiptapDoc
      } else {
        return rawContent
      }
    } catch {
      return rawContent
    }
  } else if (rawContent && typeof rawContent === 'object') {
    doc = rawContent as TiptapDoc
  }

  if (!doc || !doc.content) {
    return post.excerpt || ''
  }

  // First pass: find all Synthszr Take paragraphs and collect companies
  const synthszrTakeParagraphs: { index: number; text: string }[] = []

  doc.content.forEach((node, index) => {
    if (node.type === 'paragraph') {
      const text = extractTextFromNode(node)
      if (/synthszr take:?/i.test(text)) {
        // Get text from surrounding paragraphs too (news context)
        let contextText = text
        // Look at previous 3 nodes for context
        for (let i = Math.max(0, index - 3); i < index; i++) {
          contextText = extractTextFromNode(doc!.content![i]) + ' ' + contextText
        }
        synthszrTakeParagraphs.push({ index, text: contextText })
      }
    }
  })

  // Collect all companies mentioned
  const allPublicCompanies = new Set<string>()
  const allPremarketCompanies = new Set<string>()
  const paragraphCompanies = new Map<number, { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> }>()

  for (const para of synthszrTakeParagraphs) {
    const companies = findCompaniesInText(para.text)
    paragraphCompanies.set(para.index, companies)
    companies.public.forEach(c => allPublicCompanies.add(c.apiName))
    companies.premarket.forEach(c => allPremarketCompanies.add(c.apiName))
  }

  // Fetch ratings if any companies found
  let ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()
  if (allPublicCompanies.size > 0 || allPremarketCompanies.size > 0) {
    ratingsMap = await fetchRatings(
      Array.from(allPublicCompanies),
      Array.from(allPremarketCompanies),
      baseUrl
    )
  }

  // Convert to HTML with vote badges
  const htmlParts = doc.content.map((node, index) => {
    const baseHtml = convertNodeToHtml(node)

    // Check if this is a Synthszr Take paragraph
    const companies = paragraphCompanies.get(index)
    if (companies && (companies.public.length > 0 || companies.premarket.length > 0)) {
      // Build ratings for this paragraph
      const ratings: RatingData[] = []

      for (const c of companies.public) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'public',
          })
        }
      }

      for (const c of companies.premarket) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'premarket',
            isin: ratingData.isin,
          })
        }
      }

      if (ratings.length > 0) {
        const voteBadges = generateVoteBadgesHtml(ratings, baseUrl, post.slug)
        // Insert badges before closing </p> tag
        return baseHtml.replace(/<\/p>$/, `${voteBadges}</p>`)
      }
    }

    return baseHtml
  })

  return htmlParts.join('\n')
}

/**
 * Extract plain text from a TipTap node
 */
function extractTextFromNode(node: TiptapNode): string {
  if (node.type === 'text') {
    return node.text || ''
  }
  if (node.content) {
    return node.content.map(extractTextFromNode).join('')
  }
  return ''
}

/**
 * Convert a single TipTap node to HTML
 */
function convertNodeToHtml(node: TiptapNode): string {
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
}

/**
 * Convert TipTap document to HTML (sync version)
 */
export function convertTiptapToHtml(doc: TiptapDoc): string {
  if (!doc.content) return ''
  return doc.content.map(convertNodeToHtml).join('\n')
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

      // Remove {Company} explicit tags from display
      text = stripExplicitCompanyTags(text)

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
