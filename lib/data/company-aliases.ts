/**
 * Company name aliases - maps alternative names to canonical company names
 *
 * This file is NOT auto-generated and can be edited manually.
 * Use this to map product names to their parent companies.
 */

export interface CompanyAlias {
  canonical: string
  type: 'public' | 'premarket'
}

/**
 * Alias mappings: { 'Product/Alternative Name': { canonical: 'Company Name', type: 'public' | 'premarket' } }
 */
export const COMPANY_ALIASES: Record<string, CompanyAlias> = {
  'Cursor': { canonical: 'Anysphere', type: 'premarket' },
}

/**
 * Resolve an alias to its canonical company name and type
 */
export function resolveAlias(name: string): CompanyAlias | undefined {
  return COMPANY_ALIASES[name]
}
