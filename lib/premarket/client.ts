import type { PremarketApiResponse, FetchPremarketOptions } from './types'

/**
 * Base URL for the Stocks API
 * Uses STOCKS_API_BASE_URL env var or defaults to glitch.green
 */
const STOCKS_API_BASE =
  process.env.STOCKS_API_BASE_URL || 'https://glitch.green'

/**
 * Fetches premarket syntheses from the stocks.app API
 *
 * @param options - Query parameters for filtering results
 * @returns API response with premarket items and pagination
 * @throws Error if API key is not configured
 *
 * @example
 * // Fetch all items with synthesis
 * const result = await fetchPremarketSyntheses({ withSynthesis: true })
 *
 * @example
 * // Search for a specific company
 * const result = await fetchPremarketSyntheses({ search: 'OpenAI' })
 */
export async function fetchPremarketSyntheses(
  options?: FetchPremarketOptions
): Promise<PremarketApiResponse> {
  const apiKey = process.env.STOCKS_PREMARKET_API_KEY

  if (!apiKey) {
    console.error('[premarket] STOCKS_PREMARKET_API_KEY ist nicht konfiguriert')
    return {
      ok: false,
      error: 'API-Schlüssel nicht konfiguriert',
    }
  }

  const params = new URLSearchParams()

  if (options?.search) {
    params.set('search', options.search)
  }
  if (options?.isin) {
    params.set('isin', options.isin)
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit))
  }
  if (options?.offset !== undefined) {
    params.set('offset', String(options.offset))
  }
  if (options?.withSynthesis) {
    params.set('withSynthesis', 'true')
  }

  const queryString = params.toString()
  const url = `${STOCKS_API_BASE}/api/public/premarket-syntheses${queryString ? `?${queryString}` : ''}`

  try {
    console.log(`[premarket] Fetching from ${url}`)

    // Add timeout to prevent hanging on unresponsive API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      signal: controller.signal,
      // Cache for 1 hour in Next.js
      next: { revalidate: 3600 },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[premarket] API error ${response.status}:`, errorText)

      if (response.status === 401) {
        return {
          ok: false,
          error: 'Ungültiger API-Schlüssel',
        }
      }

      return {
        ok: false,
        error: `API-Fehler: ${response.status}`,
      }
    }

    const data: PremarketApiResponse = await response.json()
    console.log(
      `[premarket] Fetched ${data.data?.length ?? 0} items (total: ${data.pagination?.total ?? 'unknown'})`
    )

    return data
  } catch (error) {
    console.error('[premarket] Fetch error:', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Netzwerkfehler',
    }
  }
}

/**
 * Fetches a single premarket item by ISIN
 *
 * @param isin - The ISIN identifier
 * @returns The premarket item or null if not found
 */
export async function fetchPremarketByIsin(isin: string) {
  const result = await fetchPremarketSyntheses({ isin })

  if (!result.ok || !result.data || result.data.length === 0) {
    return null
  }

  return result.data[0]
}

/**
 * Fetches all premarket items with synthesis data
 * Paginates through all results automatically
 *
 * @param limit - Items per page (max 500)
 * @returns All premarket items with synthesis
 */
export async function fetchAllPremarketWithSynthesis(limit = 100) {
  const allItems: PremarketApiResponse['data'] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const result = await fetchPremarketSyntheses({
      withSynthesis: true,
      limit,
      offset,
    })

    if (!result.ok || !result.data) {
      console.error('[premarket] Failed to fetch all items:', result.error)
      break
    }

    allItems.push(...result.data)
    hasMore = result.pagination?.hasMore ?? false
    offset += limit
  }

  return allItems
}
