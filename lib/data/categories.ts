/**
 * Category badges for news sections
 *
 * Each news section (H2) gets assigned one category during the planning phase.
 * The badge displays the English label above each section heading.
 */

export const LATIN_CATEGORIES: Record<string, string> = {
  'UX': 'UX',
  'AI Tech': 'AI Tech',
  'Politik': 'Politics',
  'Philosophie': 'Philosophy',
  'Gesellschaft': 'Society',
  'Gossip': 'Gossip',
  'Robotik': 'Robotics',
  'Informatik': 'Tech',
}

/** Sort order for categories in the blog post (index = priority, lower = higher) */
export const CATEGORY_ORDER: string[] = [
  'AI Tech',
  'Gossip',
  'Politik',
  'UX',
  'Informatik',
  'Robotik',
  'Gesellschaft',
  'Philosophie',
]

export const VALID_CATEGORIES = Object.keys(LATIN_CATEGORIES)
