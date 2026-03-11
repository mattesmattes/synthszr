/**
 * Latin category badges for news sections
 *
 * Each news section (H2) gets assigned one category during the planning phase.
 * The badge displays the Latin translation at the end of each section.
 */

export const LATIN_CATEGORIES: Record<string, string> = {
  'UX': 'Usus',
  'AI Tech': 'Intelligentia',
  'Politik': 'Politica',
  'Philosophie': 'Philosophia',
  'Gesellschaft': 'Societas',
  'Gossip': 'Rumor',
  'Robotik': 'Robotica',
  'Informatik': 'Informatica',
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
