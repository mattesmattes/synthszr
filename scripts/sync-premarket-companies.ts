#!/usr/bin/env npx tsx
/**
 * Sync Premarket Companies from glitch.green API
 *
 * This script fetches all premarket companies from the glitch.green API
 * and generates a TypeScript file with company dictionaries.
 *
 * Also reads discovered_companies from Supabase (auto-discovered at runtime)
 * and merges them into the generated file.
 *
 * Run manually: npx tsx scripts/sync-premarket-companies.ts
 * Or automatically via: npm run prebuild
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

const STOCKS_API_BASE = process.env.STOCKS_API_BASE_URL || 'https://glitch.green'
const STOCKS_PREMARKET_API_KEY = process.env.STOCKS_PREMARKET_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const OUTPUT_FILE = path.join(__dirname, '..', 'lib', 'data', 'companies.ts')

// Public companies (manually curated) - these have stock tickers
const KNOWN_PUBLIC_COMPANIES: Record<string, string> = {
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
  'Cloudflare': 'cloudflare',
  'Intel': 'intel',
  'AMD': 'amd',
  'Qualcomm': 'qualcomm',
  'Broadcom': 'broadcom',
  'TSMC': 'tsmc',
  'ASML': 'asml',
  'ARM': 'arm',
  'Snap': 'snap',
  'Pinterest': 'pinterest',
  'Spotify': 'spotify',
  'Disney': 'disney',
  'Shopify': 'shopify',
  'PayPal': 'paypal',
  'Square': 'square',
  'Block': 'block',
  'Oracle': 'oracle',
  'SAP': 'sap',
  'IBM': 'ibm',
  'Adobe': 'adobe',
  'ServiceNow': 'servicenow',
  'Workday': 'workday',
  'Zoom': 'zoom',
  'Atlassian': 'atlassian',
  'Twilio': 'twilio',
  'DocuSign': 'docusign',
  'Volkswagen': 'volkswagen',
  'BMW': 'bmw',
  'Mercedes': 'mercedes',
  'Porsche': 'porsche',
  'Ford': 'ford',
  'Rivian': 'rivian',
  'Lucid': 'lucid',
  'JPMorgan': 'jpmorgan',
  'Visa': 'visa',
  'Mastercard': 'mastercard',
  'Coinbase': 'coinbase',
  'Siemens': 'siemens',
  'Schneider Electric': 'schneider-electric',
  'Allianz': 'allianz',
  'Bayer': 'bayer',
  'BASF': 'basf',
  'Accenture': 'accenture',
  'Adidas': 'adidas',
  'Zalando': 'zalando',
  'Uber': 'uber',
  'Airbnb': 'airbnb',
  'DoorDash': 'doordash',
  'Roblox': 'roblox',
  'Unity': 'unity',
  'Robinhood': 'robinhood',
  'Samsung': 'samsung',
  'Alibaba': 'alibaba',
  'Charter Communications': 'charter-communications',
  'Comcast': 'comcast',
  'Ferrari': 'ferrari',
  'Figma': 'figma',
  'GitLab': 'gitlab',
  'GitHub': 'github',
  'Global Payments': 'global-payments',
  'HP': 'hp',
  'Match Group': 'match-group',
  'Reddit': 'reddit',
  'Stripe': 'stripe',
  'SpaceX': 'spacex',
  'Databricks': 'databricks',
  'Tencent': 'tencent',
  'Tinder': 'tinder',
  'Hinge': 'hinge',
  'Viatris': 'viatris',
  'Warner Music': 'warner-music',
}

interface DiscoveredCompanyRow {
  display_name: string
  slug: string
  type: 'public' | 'premarket'
  ticker?: string | null
}

interface PremarketItem {
  instrument: {
    name: string | null
  }
}

interface PremarketApiResponse {
  ok: boolean
  data?: PremarketItem[]
  pagination?: {
    total: number
    hasMore: boolean
  }
}

/**
 * Fetch auto-discovered companies from Supabase discovered_companies table.
 * Returns { publicCompanies, premarketCompanies } to merge into the generated file.
 */
async function fetchDiscoveredCompanies(): Promise<{
  publicCompanies: Record<string, string>
  premarketCompanies: string[]
}> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Supabase credentials not set — skipping discovered_companies')
    return { publicCompanies: {}, premarketCompanies: [] }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await supabase
      .from('discovered_companies')
      .select('display_name, slug, type, ticker')

    if (error) {
      console.warn('Could not fetch discovered_companies:', error.message)
      return { publicCompanies: {}, premarketCompanies: [] }
    }

    const rows = (data ?? []) as DiscoveredCompanyRow[]
    const publicCompanies: Record<string, string> = {}
    const premarketCompanies: string[] = []

    for (const row of rows) {
      if (row.type === 'public') {
        publicCompanies[row.display_name] = row.slug
      } else if (row.type === 'premarket') {
        premarketCompanies.push(row.display_name)
      }
    }

    console.log(
      `Discovered companies: ${Object.keys(publicCompanies).length} public, ${premarketCompanies.length} premarket`
    )
    return { publicCompanies, premarketCompanies }
  } catch (err) {
    console.warn('Error fetching discovered_companies:', err)
    return { publicCompanies: {}, premarketCompanies: [] }
  }
}

async function fetchPremarketCompanies(): Promise<string[] | null> {
  console.log('Fetching premarket companies from glitch.green API...')

  if (!STOCKS_PREMARKET_API_KEY) {
    console.warn('Warning: STOCKS_PREMARKET_API_KEY not set, skipping sync (keeping existing file)')
    return null // Return null to signal "skip sync"
  }

  const allCompanies: string[] = []
  let offset = 0
  const limit = 500

  // Paginate through all results
  while (true) {
    const url = `${STOCKS_API_BASE}/api/public/premarket-syntheses?limit=${limit}&offset=${offset}`
    console.log(`Fetching from: ${url}`)

    const response = await fetch(url, {
      headers: {
        'X-API-Key': STOCKS_PREMARKET_API_KEY,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json() as PremarketApiResponse

    if (!result.ok || !result.data) {
      throw new Error('API returned error or no data')
    }

    const companies = result.data
      .map(item => item.instrument?.name)
      .filter((name): name is string => Boolean(name))

    allCompanies.push(...companies)
    console.log(`  Fetched ${companies.length} companies (total: ${allCompanies.length})`)

    if (!result.pagination?.hasMore) {
      break
    }
    offset += limit
  }

  // Sort and deduplicate
  const uniqueCompanies = [...new Set(allCompanies)].sort()
  console.log(`Total: ${uniqueCompanies.length} unique premarket companies`)

  return uniqueCompanies
}

function generateTypeScriptFile(
  premarketCompanies: string[],
  discoveredPublic: Record<string, string> = {},
  discoveredPremarket: string[] = []
): string {
  // Merge discovered public companies into the manually curated list
  const allPublicCompanies = { ...KNOWN_PUBLIC_COMPANIES, ...discoveredPublic }

  // Merge and deduplicate premarket companies
  const allPremarketSet = new Set([...premarketCompanies, ...discoveredPremarket])
  const allPremarketCompanies = [...allPremarketSet].sort()

  const premarketEntries = allPremarketCompanies
    .map(name => `  '${name.replace(/'/g, "\\'")}': '${name.replace(/'/g, "\\'")}'`)
    .join(',\n')

  const publicEntries = Object.entries(allPublicCompanies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, slug]) => `  '${name}': '${slug}'`)
    .join(',\n')

  // Handle empty entries (no trailing comma when empty)
  const premarketBlock = premarketEntries ? `${premarketEntries},` : ''
  const publicBlock = publicEntries ? `${publicEntries},` : ''

  const timestamp = new Date().toISOString()
  const discoveredNote =
    Object.keys(discoveredPublic).length > 0 || discoveredPremarket.length > 0
      ? ` (+${Object.keys(discoveredPublic).length} auto-discovered public, +${discoveredPremarket.length} auto-discovered premarket)`
      : ''

  return `/**
 * Company Data - Auto-generated file
 *
 * DO NOT EDIT MANUALLY!
 * This file is generated by scripts/sync-premarket-companies.ts
 *
 * To update, run: npx tsx scripts/sync-premarket-companies.ts
 * Last synced: ${timestamp}
 */

/**
 * Known public companies with stock tickers${discoveredNote}
 * Format: { 'Display Name': 'slug-for-api' }
 */
export const KNOWN_COMPANIES: Record<string, string> = {
${publicBlock}
}

/**
 * Known premarket companies from glitch.green API
 * Format: { 'Company Name': 'API Name' }
 * Total: ${allPremarketCompanies.length} companies
 */
export const KNOWN_PREMARKET_COMPANIES: Record<string, string> = {
${premarketBlock}
}

/**
 * Check if a company name is a known public company
 */
export function isPublicCompany(name: string): boolean {
  return name in KNOWN_COMPANIES
}

/**
 * Check if a company name is a known premarket company
 */
export function isPremarketCompany(name: string): boolean {
  return name in KNOWN_PREMARKET_COMPANIES
}

/**
 * Get the slug/API name for a company
 */
export function getCompanySlug(name: string): string | undefined {
  return KNOWN_COMPANIES[name] || KNOWN_PREMARKET_COMPANIES[name]
}

/**
 * Check if a company name is known (public or premarket)
 */
export function isKnownCompany(name: string): boolean {
  return isPublicCompany(name) || isPremarketCompany(name)
}
`
}

async function main() {
  try {
    // Fetch from API
    const premarketCompanies = await fetchPremarketCompanies()

    // If null, API key was missing - skip sync and keep existing file
    if (premarketCompanies === null) {
      console.log('Sync skipped - existing companies.ts file preserved')
      return
    }

    // Fetch auto-discovered companies from Supabase
    const { publicCompanies: discoveredPublic, premarketCompanies: discoveredPremarket } =
      await fetchDiscoveredCompanies()

    // Generate TypeScript file (merges glitch.green + Supabase discovered)
    const content = generateTypeScriptFile(premarketCompanies, discoveredPublic, discoveredPremarket)

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Write file
    fs.writeFileSync(OUTPUT_FILE, content, 'utf-8')
    console.log(`Generated ${OUTPUT_FILE}`)
    console.log(`  - ${Object.keys(KNOWN_PUBLIC_COMPANIES).length + Object.keys(discoveredPublic).length} public companies (${Object.keys(discoveredPublic).length} auto-discovered)`)
    console.log(`  - ${premarketCompanies.length + discoveredPremarket.length} premarket companies (${discoveredPremarket.length} auto-discovered)`)

  } catch (error) {
    console.error('Error syncing companies:', error)
    // Don't exit with error - allow build to continue with existing file
    console.log('Sync failed - existing companies.ts file preserved')
  }
}

main()
