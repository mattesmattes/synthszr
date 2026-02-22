/**
 * Company Discovery - Automatic classification of unknown company tags
 *
 * When the Ghostwriter adds {CompanyName} tags for companies not yet in
 * KNOWN_COMPANIES or KNOWN_PREMARKET_COMPANIES, this module:
 *   1. Checks glitch.green premarket API for exact name match
 *   2. Falls back to Yahoo Finance search for public stock lookup
 *   3. Persists classified companies in discovered_companies Supabase table
 *
 * On the next build, sync-premarket-companies.ts reads this table and
 * regenerates companies.ts with the newly discovered entries.
 */

import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { createAdminClient } from '@/lib/supabase/admin'

const STOCKS_API_BASE = process.env.STOCKS_API_BASE_URL || 'https://glitch.green'
const STOCKS_PREMARKET_API_KEY = process.env.STOCKS_PREMARKET_API_KEY || ''
const EODHD_API_KEY = process.env.EODHD_API_KEY || ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredCompany {
  display_name: string
  slug: string
  type: 'public' | 'premarket'
  ticker?: string
}

interface GlitchGreenItem {
  instrument?: {
    name?: string | null
  }
}

interface GlitchGreenResponse {
  ok: boolean
  data?: GlitchGreenItem[]
}

interface EODHDSearchResult {
  Code?: string
  Exchange?: string
  Name?: string
  Type?: string
}

// ─── Tag Extraction ───────────────────────────────────────────────────────────

/**
 * Extract {CompanyName} tags from TipTap content that are NOT already known.
 *
 * Only scans explicit {Tag} patterns — not natural text mentions.
 * These are reliable signals because the Ghostwriter AI placed them intentionally.
 */
// Case-insensitive lookup set built once at module load time
const knownNamesLower = new Set([
  ...Object.keys(KNOWN_COMPANIES).map(k => k.toLowerCase()),
  ...Object.keys(KNOWN_PREMARKET_COMPANIES).map(k => k.toLowerCase()),
])

export function extractUnknownCompanyTags(content: unknown): string[] {
  const text = extractTextFromContent(content)
  if (!text) return []

  // Find all {Name} patterns
  const tagPattern = /\{([^}]+)\}/g
  const found = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(text)) !== null) {
    const name = match[1].trim()
    if (!name) continue

    // Skip if already known — case-insensitive to catch {openai} vs "OpenAI"
    if (knownNamesLower.has(name.toLowerCase())) continue

    // Skip multi-company tags like {Google, YouTube} — not parseable
    if (name.includes(',')) continue

    found.add(name)
  }

  return [...found]
}

function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  return extractTextFromNode(content as { text?: string; content?: unknown[] })
}

function extractTextFromNode(node: { text?: string; content?: unknown[] }): string {
  if (node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(n => extractTextFromNode(n as { text?: string; content?: unknown[] })).join(' ')
  }
  return ''
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Check glitch.green premarket API for an exact company name match.
 * Returns the matched name (as-is from API) or null.
 */
async function checkGlitchGreen(name: string): Promise<string | null> {
  if (!STOCKS_PREMARKET_API_KEY) return null

  try {
    const url = `${STOCKS_API_BASE}/api/public/premarket-syntheses?search=${encodeURIComponent(name)}&limit=10`
    const response = await fetch(url, {
      headers: {
        'X-API-Key': STOCKS_PREMARKET_API_KEY,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null

    const result = (await response.json()) as GlitchGreenResponse
    if (!result.ok || !result.data) return null

    // Exact case-insensitive match against instrument.name
    const lowerName = name.toLowerCase()
    const match = result.data.find(
      item => item.instrument?.name?.toLowerCase() === lowerName
    )

    return match?.instrument?.name ?? null
  } catch {
    return null
  }
}

/**
 * Check EODHD for a publicly traded company.
 * Returns { ticker, exchange } or null if not found.
 *
 * Uses the EODHD search API — requires EODHD_API_KEY.
 * Docs: https://eodhistoricaldata.com/financial-apis/search-api-for-stocks-etfs-mutual-funds-and-indices/
 */
async function checkEODHD(name: string): Promise<{ ticker: string; exchange: string } | null> {
  if (!EODHD_API_KEY) return null

  try {
    const url = `https://eodhistoricaldata.com/api/search/${encodeURIComponent(name)}?api_token=${EODHD_API_KEY}&limit=5&type=stock&fmt=json`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null

    const results = (await response.json()) as EODHDSearchResult[]
    if (!Array.isArray(results) || results.length === 0) return null

    // Take the first Common Stock result that name-matches
    const searchName = name.toLowerCase()
    const match = results.find(r => {
      if (!r.Code || r.Type !== 'Common Stock') return false
      const resultName = (r.Name || '').toLowerCase()
      // Result name should contain search term or vice versa
      return resultName.includes(searchName) || searchName.includes(resultName.split(' ')[0])
    })

    if (!match?.Code || !match.Exchange) return null

    return { ticker: match.Code, exchange: match.Exchange }
  } catch {
    return null
  }
}

/**
 * Generate a URL-safe slug from a company display name.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ─── Main Discovery ───────────────────────────────────────────────────────────

/**
 * Discover and classify unknown company names.
 *
 * Checks glitch.green → Yahoo Finance → skips if neither matches.
 * Persists results in discovered_companies table (upsert by slug).
 *
 * Called asynchronously after post save — does not block the save operation.
 */
export async function discoverAndClassifyCompanies(names: string[]): Promise<void> {
  if (names.length === 0) return

  console.log(`[company-discovery] Checking ${names.length} unknown companies:`, names)

  const supabase = createAdminClient()

  // Load already-discovered slugs to avoid re-checking
  const slugs = names.map(toSlug)
  const { data: existing } = await supabase
    .from('discovered_companies')
    .select('slug')
    .in('slug', slugs)

  const existingSlugs = new Set((existing ?? []).map((r: { slug: string }) => r.slug))

  const toInsert: DiscoveredCompany[] = []

  for (const name of names) {
    const slug = toSlug(name)

    // Skip if already in database
    if (existingSlugs.has(slug)) {
      console.log(`[company-discovery] Already known: ${name}`)
      continue
    }

    // 1. Check glitch.green (premarket)
    const glitchMatch = await checkGlitchGreen(name)
    if (glitchMatch) {
      console.log(`[company-discovery] ${name} → premarket (glitch.green match: "${glitchMatch}")`)
      toInsert.push({
        display_name: glitchMatch,
        slug,
        type: 'premarket',
      })
      continue
    }

    // 2. Check EODHD (public stock)
    const eohdMatch = await checkEODHD(name)
    if (eohdMatch) {
      console.log(`[company-discovery] ${name} → public (EODHD: ${eohdMatch.ticker}.${eohdMatch.exchange})`)
      toInsert.push({
        display_name: name,
        slug,
        type: 'public',
        ticker: `${eohdMatch.ticker}.${eohdMatch.exchange}`,
      })
      continue
    }

    // 3. Neither matched → private company, skip
    console.log(`[company-discovery] ${name} → skipped (no match found)`)
  }

  if (toInsert.length === 0) return

  const { error } = await supabase
    .from('discovered_companies')
    .upsert(toInsert, { onConflict: 'slug' })

  if (error) {
    console.error('[company-discovery] Failed to save discovered companies:', error)
  } else {
    console.log(`[company-discovery] Saved ${toInsert.length} new companies`)
  }
}
