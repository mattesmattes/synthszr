// Pure helper (no DB import) so it's safe in both client and server render paths.

/**
 * Replace the word "TODAY" in a podcast promo headline with the episode's
 * publish date, e.g. "SYNTHSZR PODCAST TODAY" → "SYNTHSZR PODCAST Saturday, June 6".
 * Headline CSS uppercases it. No-op if the headline has no "today" or no date.
 */
export function applyEpisodeDateToHeadline(headline: string, episodeDate: string | null): string {
  if (!episodeDate || !/today/i.test(headline)) return headline
  const d = new Date(episodeDate)
  if (isNaN(d.getTime())) return headline
  const formatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return headline.replace(/today/i, formatted)
}
