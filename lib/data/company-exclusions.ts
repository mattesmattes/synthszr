/**
 * Words/phrases that should NEVER be treated as company names
 * These are common words that might accidentally match company detection patterns
 */
export const EXCLUDED_COMPANY_NAMES: Set<string> = new Set([
  // German common nouns that look like company names
  'Insider',       // "Insider" = people inside a company
  'Experte',       // "Experte" = expert
  'Experten',      // plural
  'Analyst',       // "Analyst" = analyst
  'Analysten',     // plural
  'Manager',       // common noun
  'Partner',       // common noun
  'Investor',      // common noun
  'Investoren',    // plural

  // English common nouns
  'Expert',
  'Experts',
  'Analysts',
  'Managers',
  'Partners',
  'Investors',

  // Other false positives
  'Update',
  'Service',
  'Cloud',         // too generic
  'Digital',       // too generic
  'Tech',          // too generic
])

/**
 * Check if a name should be excluded from company detection
 */
export function isExcludedCompanyName(name: string): boolean {
  return EXCLUDED_COMPANY_NAMES.has(name)
}
